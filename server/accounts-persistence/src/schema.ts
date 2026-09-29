import type { ColumnType } from "kysely";

/**
 * Kysely view of the accounts schema (accounts migrations 001-004).
 * Timestamps are written as ISO-8601 text from the accounts wall clock and
 * are never selected raw: the repository reads them as epoch milliseconds
 * through SQL, so no driver date parsing is involved. `bytea` digests are
 * written as bytes and only ever compared, never read back.
 */
type Time = ColumnType<unknown, string, string>;
type AuditTime = ColumnType<unknown, never, never>;
type ReadOnce<T> = ColumnType<T, T, never>;
type Digest = ColumnType<unknown, Uint8Array, never>;

export interface UsersTable {
  readonly user_id: ReadOnce<string>;
  readonly username: string;
  readonly username_canonical: string;
  readonly email: string;
  readonly email_canonical: string;
  readonly email_verified_at: ColumnType<unknown, never, string>;
  readonly status: ColumnType<string, never, string>;
  readonly created_at: AuditTime;
  readonly updated_at: ColumnType<unknown, never, string>;
}

export interface UserCredentialsTable {
  readonly user_id: ReadOnce<string>;
  readonly password_scheme: string;
  readonly password_hash: string;
  readonly created_at: AuditTime;
  readonly updated_at: ColumnType<unknown, never, string>;
}

export interface UserSessionsTable {
  readonly session_id: ReadOnce<string>;
  readonly user_id: ReadOnce<string>;
  readonly token_hash: Digest;
  readonly created_at: ColumnType<unknown, string, never>;
  readonly last_seen_at: Time;
  readonly absolute_expires_at: ColumnType<unknown, string, never>;
  readonly revoked_at: ColumnType<unknown, never, string>;
  readonly revocation_reason: ColumnType<string | null, never, string>;
}

export interface AccountActionTokensTable {
  readonly token_hash: Digest;
  readonly user_id: ReadOnce<string>;
  readonly purpose: ReadOnce<string>;
  readonly email_canonical: ReadOnce<string>;
  readonly created_at: ColumnType<unknown, string, never>;
  readonly expires_at: ColumnType<unknown, string, never>;
  readonly consumed_at: ColumnType<unknown, never, string>;
}

export interface AccountsDatabase {
  readonly users: UsersTable;
  readonly user_credentials: UserCredentialsTable;
  readonly user_sessions: UserSessionsTable;
  readonly account_action_tokens: AccountActionTokensTable;
}
