import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { type Kysely, sql } from "kysely";
import {
  type Migration,
  type MigrationProvider,
  type MigrationResultSet,
  Migrator,
} from "kysely/migration";

/**
 * Bookkeeping tables of the game-access migrations, separate from the
 * accounts and live-game ones (DEC-048). These migrations reference the
 * accounts tables, so they run after the accounts migrations.
 */
export const GAME_ACCESS_MIGRATION_TABLE = "game_access_schema_migrations";
export const GAME_ACCESS_MIGRATION_LOCK_TABLE = "game_access_schema_migration_lock";

const MIGRATION_NAME = /^\d{3}_[a-z0-9_]+$/;
const UP_SUFFIX = ".up.sql";

/**
 * Numbered SQL migrations from one directory: `NNN_name.up.sql`, each with a
 * matching `NNN_name.down.sql`. The SQL is fixed repository text, run as-is.
 */
class GameAccessSqlMigrationProvider implements MigrationProvider {
  readonly #directory: string;

  constructor(directory: string) {
    this.#directory = directory;
  }

  async getMigrations(): Promise<Record<string, Migration>> {
    const files = (await readdir(this.#directory))
      .filter((file) => file.endsWith(UP_SUFFIX))
      .sort();
    const entries = await Promise.all(
      files.map(async (file): Promise<[string, Migration]> => {
        const name = file.slice(0, -UP_SUFFIX.length);
        if (!MIGRATION_NAME.test(name)) throw new Error(`Unexpected migration file name ${file}`);
        const up = await readFile(join(this.#directory, file), "utf8");
        const down = await readFile(join(this.#directory, `${name}.down.sql`), "utf8");
        return [
          name,
          {
            up: async (db) => {
              await sql.raw(up).execute(db);
            },
            down: async (db) => {
              await sql.raw(down).execute(db);
            },
          },
        ];
      }),
    );
    return Object.fromEntries(entries);
  }
}

/** `schema` pins the bookkeeping tables to one schema (see the accounts migrator). */
export function gameAccessMigrator<DB>(
  db: Kysely<DB>,
  directory: string,
  schema: string | null = null,
): Migrator {
  return new Migrator({
    db,
    provider: new GameAccessSqlMigrationProvider(directory),
    migrationTableName: GAME_ACCESS_MIGRATION_TABLE,
    migrationLockTableName: GAME_ACCESS_MIGRATION_LOCK_TABLE,
    ...(schema === null ? {} : { migrationTableSchema: schema }),
  });
}

export async function migrateGameAccessToLatest<DB>(
  db: Kysely<DB>,
  directory: string,
  schema: string | null = null,
): Promise<MigrationResultSet> {
  return gameAccessMigrator(db, directory, schema).migrateToLatest();
}
