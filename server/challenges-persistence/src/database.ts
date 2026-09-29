import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { ChallengesDatabase } from "./schema.ts";

/**
 * Connection settings, supplied by the host from its secret store. This
 * package never reads the environment and never logs or echoes them.
 * `schema`, when set, becomes the session `search_path`.
 */
export interface ChallengesDatabaseSettings {
  readonly connectionString: string;
  readonly maxConnections: number;
  readonly applicationName: string;
  readonly schema: string | null;
}

export function createChallengesDatabase(
  settings: ChallengesDatabaseSettings,
): Kysely<ChallengesDatabase> {
  const { schema } = settings;
  if (schema !== null && !/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) {
    throw new Error("Challenges database schema must be a plain lowercase identifier");
  }
  const pool = new pg.Pool({
    connectionString: settings.connectionString,
    max: settings.maxConnections,
    application_name: settings.applicationName,
    ...(schema === null ? {} : { options: `-c search_path=${schema}` }),
  });
  return new Kysely<ChallengesDatabase>({ dialect: new PostgresDialect({ pool }) });
}
