import { fileURLToPath } from "node:url";
import {
  createGameAccessDatabase,
  type GameAccessDatabase,
  migrateGameAccessToLatest,
} from "@chess-one/game-access-persistence";
import type { Kysely } from "kysely";
import { type AccountsSchema, withAccountsSchema } from "../../accounts/support/db.ts";
import { testDatabaseUrl } from "../../live-game-persistence/support/disposable-schema.ts";

export const GAME_ACCESS_MIGRATIONS = fileURLToPath(
  new URL("../../../server/game-access-persistence/migrations", import.meta.url),
);

function sqlstate(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : null;
}

/**
 * The accounts disposable schema (local *_test database, generated schema
 * name, dropped afterwards) with the live-game tables and, unless
 * `migrateGameAccess` is false, the game-access tables migrated after the
 * accounts ones they reference.
 */
export class GameAccessSchema {
  readonly base: AccountsSchema;
  readonly #url: string;
  readonly #applicationName: string;
  readonly #pools: Kysely<GameAccessDatabase>[] = [];

  constructor(base: AccountsSchema, url: string, applicationName: string) {
    this.base = base;
    this.#url = url;
    this.#applicationName = applicationName;
  }

  get name(): string {
    return this.base.name;
  }

  /** A new game-access pool on the schema, as a restarted process would open. */
  gameAccess(maxConnections = 8): Kysely<GameAccessDatabase> {
    const db = createGameAccessDatabase({
      connectionString: this.#url,
      maxConnections,
      applicationName: this.#applicationName,
      schema: this.base.name,
    });
    this.#pools.push(db);
    return db;
  }

  async destroyPools(): Promise<void> {
    await Promise.all(this.#pools.splice(0).map((db) => db.destroy()));
  }
}

export async function withGameAccessSchema(
  applicationName: string,
  options: { readonly migrateGameAccess?: boolean },
  run: (schema: GameAccessSchema) => Promise<void>,
): Promise<void> {
  await withAccountsSchema(applicationName, { migrateLiveGame: true }, async (base) => {
    const schema = new GameAccessSchema(base, testDatabaseUrl(), applicationName);
    try {
      if (options.migrateGameAccess !== false) {
        const migrated = await migrateGameAccessToLatest(
          schema.gameAccess(1),
          GAME_ACCESS_MIGRATIONS,
          schema.name,
        );
        if (migrated.error !== undefined) {
          throw new Error(
            `game-access migrations failed: sqlstate ${String(sqlstate(migrated.error))}`,
          );
        }
      }
      await run(schema);
    } finally {
      await schema.destroyPools();
    }
  });
}
