import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { AccountsDatabase } from "./schema.ts";

/**
 * Connection settings, supplied by the host from its secret store. This
 * package never reads the environment and never logs or echoes them.
 * `schema`, when set, becomes the session `search_path` (used by the
 * integration tests to isolate each run).
 */
export interface AccountsDatabaseSettings {
  readonly connectionString: string;
  readonly maxConnections: number;
  readonly applicationName: string;
  readonly schema: string | null;
}

export function createAccountsDatabase(
  settings: AccountsDatabaseSettings,
): Kysely<AccountsDatabase> {
  const { schema } = settings;
  if (schema !== null && !/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) {
    throw new Error("Accounts database schema must be a plain lowercase identifier");
  }
  const pool = new pg.Pool({
    connectionString: settings.connectionString,
    max: settings.maxConnections,
    application_name: settings.applicationName,
    ...(schema === null ? {} : { options: `-c search_path=${schema}` }),
  });
  return new Kysely<AccountsDatabase>({ dialect: new PostgresDialect({ pool }) });
}
