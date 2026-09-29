import type { ColumnType } from "kysely";

/**
 * Kysely view of the challenge schema (challenge migrations 001-003). Times are
 * written from the application's wall clock and read back as epoch
 * milliseconds by the repository's own SQL, never through a driver `Date`.
 */
type ReadOnce<T> = ColumnType<T, T, never>;

export interface ChallengesTable {
  readonly challenge_id: ReadOnce<string>;
  readonly challenger_user_id: ReadOnce<string>;
  readonly challenged_user_id: ReadOnce<string>;
  readonly status: ColumnType<string, string, string>;
  readonly ruleset_id: ReadOnce<string>;
  readonly time_control_type: ReadOnce<string>;
  readonly initial_time_ms: ReadOnce<number>;
  readonly increment_ms: ReadOnce<number>;
  readonly seat_preference: ReadOnce<string>;
  readonly created_at: ReadOnce<unknown>;
  readonly expires_at: ReadOnce<unknown>;
  readonly resolved_at: ColumnType<unknown, unknown, unknown>;
  readonly created_game_id: ColumnType<string | null, string | null, string | null>;
  readonly accepted_at: ColumnType<unknown, unknown, unknown>;
  readonly intended_game_id: ColumnType<string | null, string | null, string | null>;
  readonly white_user_id: ColumnType<string | null, string | null, string | null>;
  readonly black_user_id: ColumnType<string | null, string | null, string | null>;
  readonly start_deadline_at: ColumnType<unknown, unknown, unknown>;
}

/** The accounts table the challenge queries join for display usernames, read-only. */
export interface ReferencedUsersTable {
  readonly user_id: ColumnType<string, never, never>;
  readonly username: ColumnType<string, never, never>;
}

export interface ChallengesDatabase {
  readonly challenges: ChallengesTable;
  readonly users: ReferencedUsersTable;
}
