import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { type Kysely, sql } from "kysely";
import {
  type Migration,
  type MigrationProvider,
  type MigrationResultSet,
  Migrator,
} from "kysely/migration";

/** Kysely's own bookkeeping tables for applied migrations; they hold no game data. */
export const MIGRATION_TABLE = "live_game_schema_migrations";
export const MIGRATION_LOCK_TABLE = "live_game_schema_migration_lock";

const MIGRATION_NAME = /^\d{3}_[a-z0-9_]+$/;
const UP_SUFFIX = ".up.sql";

/**
 * Numbered SQL migrations from one directory: `NNN_name.up.sql`, each with a
 * matching `NNN_name.down.sql`. The SQL is fixed repository text, run as-is;
 * it never contains client data.
 */
export class SqlFileMigrationProvider implements MigrationProvider {
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

export function liveGameMigrator<DB>(db: Kysely<DB>, directory: string): Migrator {
  return new Migrator({
    db,
    provider: new SqlFileMigrationProvider(directory),
    migrationTableName: MIGRATION_TABLE,
    migrationLockTableName: MIGRATION_LOCK_TABLE,
  });
}

export async function migrateToLatest<DB>(
  db: Kysely<DB>,
  directory: string,
): Promise<MigrationResultSet> {
  return liveGameMigrator(db, directory).migrateToLatest();
}
