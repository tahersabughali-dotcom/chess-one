import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { GameId } from "@chess-one/live-game";
import {
  createLiveGameDatabase,
  type LiveGameDatabase,
  migrateToLatest,
} from "@chess-one/live-game-persistence";
import { type Kysely, sql } from "kysely";

/**
 * A disposable, migrated schema in the local test database for suites
 * outside this package (the realtime end-to-end tests). The same guards as
 * postgres.db.test.ts: local host, a database named *_test, a generated
 * schema name, and a BLOCKED failure (never a skip) without a database.
 */
export const BLOCKED =
  "BLOCKED by environment: set CHESS_ONE_TEST_DATABASE_URL to a disposable local PostgreSQL 18 test database " +
  "(host localhost, 127.0.0.1, or ::1; database name ending in _test).";

const MIGRATIONS = fileURLToPath(
  new URL("../../../server/live-game-persistence/migrations", import.meta.url),
);
const TEST_DATABASE_NAME = /^[a-z0-9_]+_test$/;
const TEST_SCHEMA_NAME = /^chess_one_it_[0-9a-f]{16}$/;

export function testDatabaseUrl(): string {
  const { CHESS_ONE_TEST_DATABASE_URL: url } = process.env;
  if (url === undefined || url === "") throw new Error(BLOCKED);
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) {
    throw new Error("Refusing a non-local database host for integration tests");
  }
  if (!TEST_DATABASE_NAME.test(parsed.pathname.slice(1))) {
    throw new Error("Refusing a database whose name does not end in _test");
  }
  return url;
}

function connect(
  url: string,
  schema: string | null,
  applicationName: string,
): Kysely<LiveGameDatabase> {
  return createLiveGameDatabase({
    connectionString: url,
    maxConnections: 4,
    applicationName,
    schema,
  });
}

async function assertDisposable(admin: Kysely<LiveGameDatabase>, schema: string): Promise<void> {
  const connected = await sql<{ name: string }>`select current_database() as name`.execute(admin);
  if (!TEST_DATABASE_NAME.test(connected.rows[0]?.name ?? "")) {
    throw new Error("Refusing destructive setup or cleanup outside a database named *_test");
  }
  if (!TEST_SCHEMA_NAME.test(schema)) {
    throw new Error("Refusing destructive setup or cleanup of a schema this suite did not create");
  }
}

export interface StoredCounts {
  readonly sequence: number;
  readonly statusKind: string;
  readonly clockDomainId: string;
  readonly bindings: number;
  readonly outbox: number;
}

export class DisposableSchema {
  readonly #url: string;
  readonly #schema: string;
  readonly #admin: Kysely<LiveGameDatabase>;
  readonly #applicationName: string;
  readonly #pools: Kysely<LiveGameDatabase>[] = [];

  constructor(
    url: string,
    schema: string,
    admin: Kysely<LiveGameDatabase>,
    applicationName: string,
  ) {
    this.#url = url;
    this.#schema = schema;
    this.#admin = admin;
    this.#applicationName = applicationName;
  }

  /** A new connection pool on the schema, as a restarted process would open. */
  pool(): Kysely<LiveGameDatabase> {
    const db = connect(this.#url, this.#schema, this.#applicationName);
    this.#pools.push(db);
    return db;
  }

  async counts(gameId: GameId): Promise<StoredCounts> {
    const db = this.pool();
    const game = await db
      .selectFrom("live_games")
      .select(["sequence", "status_kind", "clock_domain_id"])
      .where("game_id", "=", gameId)
      .executeTakeFirstOrThrow();
    const bindings = await db
      .selectFrom("live_game_command_bindings")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("game_id", "=", gameId)
      .executeTakeFirstOrThrow();
    const outbox = await db
      .selectFrom("outbox_events")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("aggregate_id", "=", gameId)
      .executeTakeFirstOrThrow();
    return {
      sequence: Number(game.sequence),
      statusKind: game.status_kind,
      clockDomainId: game.clock_domain_id,
      bindings: Number(bindings.n),
      outbox: Number(outbox.n),
    };
  }

  /** Makes every game update fail inside PostgreSQL until `allowUpdates`. */
  async rejectUpdates(): Promise<void> {
    const fn = sql.id(this.#schema, "chess_one_it_reject_update");
    await sql`create function ${fn}() returns trigger language plpgsql as $$ begin raise exception 'injected update failure'; end $$`.execute(
      this.#admin,
    );
    await sql`create trigger chess_one_it_reject_update before update on ${sql.id(this.#schema, "live_games")} for each row execute function ${fn}()`.execute(
      this.#admin,
    );
  }

  async allowUpdates(): Promise<void> {
    await sql`drop trigger chess_one_it_reject_update on ${sql.id(this.#schema, "live_games")}`.execute(
      this.#admin,
    );
    await sql`drop function ${sql.id(this.#schema, "chess_one_it_reject_update")}()`.execute(
      this.#admin,
    );
  }

  async destroyPools(): Promise<void> {
    await Promise.all(this.#pools.splice(0).map((db) => db.destroy()));
  }
}

export async function withDisposableSchema(
  applicationName: string,
  run: (schema: DisposableSchema) => Promise<void>,
): Promise<void> {
  const url = testDatabaseUrl();
  const name = `chess_one_it_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const admin = connect(url, null, applicationName);
  try {
    await assertDisposable(admin, name);
    await sql`create schema ${sql.id(name)}`.execute(admin);
    const schema = new DisposableSchema(url, name, admin, applicationName);
    try {
      const migrated = await migrateToLatest(schema.pool(), MIGRATIONS);
      if (migrated.error !== undefined) throw new Error("migrations failed");
      await run(schema);
    } finally {
      await schema.destroyPools();
      await assertDisposable(admin, name);
      await sql`drop schema ${sql.id(name)} cascade`.execute(admin);
    }
  } finally {
    await admin.destroy();
  }
}
