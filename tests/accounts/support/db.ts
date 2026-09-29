import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  type AccountsDatabase,
  createAccountsDatabase,
  migrateAccountsToLatest,
} from "@chess-one/accounts-persistence";
import {
  createLiveGameDatabase,
  type LiveGameDatabase,
  migrateToLatest,
} from "@chess-one/live-game-persistence";
import { type Kysely, sql } from "kysely";
import { testDatabaseUrl } from "../../live-game-persistence/support/disposable-schema.ts";

/**
 * A disposable schema in the local test database for the accounts suites,
 * with the same guards as the live-game suites: a local host, a database
 * named *_test, a generated schema name, and a BLOCKED failure (never a
 * skip) when no database is configured.
 */
export const ACCOUNTS_MIGRATIONS = fileURLToPath(
  new URL("../../../server/accounts-persistence/migrations", import.meta.url),
);
const LIVE_GAME_MIGRATIONS = fileURLToPath(
  new URL("../../../server/live-game-persistence/migrations", import.meta.url),
);
const TEST_DATABASE_NAME = /^[a-z0-9_]+_test$/;
const TEST_SCHEMA_NAME = /^chess_one_it_[0-9a-f]{16}$/;

export type AccountsTable =
  | "users"
  | "user_credentials"
  | "user_sessions"
  | "account_action_tokens";

async function assertDisposable(admin: Kysely<AccountsDatabase>, schema: string): Promise<void> {
  const connected = await sql<{ name: string }>`select current_database() as name`.execute(admin);
  if (!TEST_DATABASE_NAME.test(connected.rows[0]?.name ?? "")) {
    throw new Error("Refusing destructive setup or cleanup outside a database named *_test");
  }
  if (!TEST_SCHEMA_NAME.test(schema)) {
    throw new Error("Refusing destructive setup or cleanup of a schema this suite did not create");
  }
}

/** The SQLSTATE of a driver error, and nothing else from it (no message, no connection detail). */
function sqlstate(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : null;
}

export class AccountsSchema {
  readonly name: string;
  readonly #url: string;
  readonly #admin: Kysely<AccountsDatabase>;
  readonly #applicationName: string;
  readonly #accountsPools: Kysely<AccountsDatabase>[] = [];
  readonly #liveGamePools: Kysely<LiveGameDatabase>[] = [];

  constructor(url: string, name: string, admin: Kysely<AccountsDatabase>, applicationName: string) {
    this.#url = url;
    this.name = name;
    this.#admin = admin;
    this.#applicationName = applicationName;
  }

  /** A new accounts pool on the schema, as a restarted process would open. */
  accounts(maxConnections = 8): Kysely<AccountsDatabase> {
    const db = createAccountsDatabase({
      connectionString: this.#url,
      maxConnections,
      applicationName: this.#applicationName,
      schema: this.name,
    });
    this.#accountsPools.push(db);
    return db;
  }

  liveGame(): Kysely<LiveGameDatabase> {
    const db = createLiveGameDatabase({
      connectionString: this.#url,
      maxConnections: 4,
      applicationName: this.#applicationName,
      schema: this.name,
    });
    this.#liveGamePools.push(db);
    return db;
  }

  /**
   * Makes every `operation` on `table` fail inside PostgreSQL, so a
   * transaction that reaches it must roll back. Returns the undo.
   */
  async failOn(table: AccountsTable, operation: "insert" | "update"): Promise<() => Promise<void>> {
    const suffix = `${table}_${operation}`;
    const fn = sql.id(this.name, `chess_one_it_fail_${suffix}`);
    const trigger = sql.id(`chess_one_it_fail_${suffix}`);
    const target = sql.id(this.name, table);
    await sql`create function ${fn}() returns trigger language plpgsql as $$ begin raise exception 'injected ${sql.raw(suffix)} failure'; end $$`.execute(
      this.#admin,
    );
    await sql`create trigger ${trigger} before ${sql.raw(operation)} on ${target} for each row execute function ${fn}()`.execute(
      this.#admin,
    );
    return async () => {
      await sql`drop trigger ${trigger} on ${target}`.execute(this.#admin);
      await sql`drop function ${fn}()`.execute(this.#admin);
    };
  }

  async destroyPools(): Promise<void> {
    await Promise.all([
      ...this.#accountsPools.splice(0).map((db) => db.destroy()),
      ...this.#liveGamePools.splice(0).map((db) => db.destroy()),
    ]);
  }
}

export interface AccountsSchemaOptions {
  /** Default true. False leaves the schema empty for migration tests. */
  readonly migrateAccounts?: boolean;
  readonly migrateLiveGame?: boolean;
}

export async function withAccountsSchema(
  applicationName: string,
  options: AccountsSchemaOptions,
  run: (schema: AccountsSchema) => Promise<void>,
): Promise<void> {
  const url = testDatabaseUrl();
  const name = `chess_one_it_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const admin = createAccountsDatabase({
    connectionString: url,
    maxConnections: 2,
    applicationName,
    schema: null,
  });
  try {
    await assertDisposable(admin, name);
    await sql`create schema ${sql.id(name)}`.execute(admin);
    const schema = new AccountsSchema(url, name, admin, applicationName);
    try {
      if (options.migrateAccounts !== false) {
        const migrated = await migrateAccountsToLatest(
          schema.accounts(1),
          ACCOUNTS_MIGRATIONS,
          schema.name,
        );
        if (migrated.error !== undefined) {
          throw new Error(
            `accounts migrations failed: sqlstate ${String(sqlstate(migrated.error))}`,
          );
        }
      }
      if (options.migrateLiveGame === true) {
        const migrated = await migrateToLatest(schema.liveGame(), LIVE_GAME_MIGRATIONS);
        if (migrated.error !== undefined) {
          throw new Error(
            `live-game migrations failed: sqlstate ${String(sqlstate(migrated.error))}`,
          );
        }
      }
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
