import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { LiveGameDatabase } from "./schema.ts";

/**
 * Connection settings, supplied by the host from its secret store. This
 * package never reads the environment and never logs or echoes them.
 * `schema`, when set, becomes the session `search_path`, so one database can
 * hold isolated schemas (used by the integration tests).
 */
export interface LiveGameDatabaseSettings {
  readonly connectionString: string;
  readonly maxConnections: number;
  readonly applicationName: string;
  readonly schema: string | null;
}

export function isSchemaName(value: string): boolean {
  return /^[a-z_][a-z0-9_]{0,62}$/.test(value);
}

export function createLiveGameDatabase(
  settings: LiveGameDatabaseSettings,
): Kysely<LiveGameDatabase> {
  const { schema } = settings;
  if (schema !== null && !isSchemaName(schema)) {
    throw new Error("Live game database schema must be a plain lowercase identifier");
  }
  const pool = new pg.Pool({
    connectionString: settings.connectionString,
    max: settings.maxConnections,
    application_name: settings.applicationName,
    ...(schema === null ? {} : { options: `-c search_path=${schema}` }),
  });
  return new Kysely<LiveGameDatabase>({ dialect: new PostgresDialect({ pool }) });
}
