import type { ColumnType } from "kysely";

/**
 * Kysely view of the game-access schema (game-access migrations 001-002).
 * Audit timestamps are set by the database and never read back. `bigint`
 * arrives from the driver as text and is parsed by the repository.
 */
type AuditTime = ColumnType<unknown, never, never>;
type ReadOnce<T> = ColumnType<T, T, never>;

export interface GameAssignmentsTable {
  readonly game_id: ReadOnce<string>;
  readonly white_user_id: ReadOnce<string>;
  readonly black_user_id: ReadOnce<string>;
  readonly state: ColumnType<string, string, string>;
  readonly created_at: AuditTime;
  readonly confirmed_at: ColumnType<unknown, never, string>;
}

export interface GameSeatControlTable {
  readonly game_id: ReadOnce<string>;
  readonly seat: ReadOnce<string>;
  readonly controlling_session_id: ColumnType<string | null, string | null, string | null>;
  readonly control_lease_id: string;
  readonly control_version: ColumnType<string, number, number>;
  readonly updated_at: ColumnType<unknown, never, string>;
}

/** The accounts tables the game-access queries join, read-only and minimal. */
export interface ReferencedUserSessionsTable {
  readonly session_id: ColumnType<string, never, never>;
  readonly user_id: ColumnType<string, never, never>;
}

export interface GameAccessDatabase {
  readonly game_assignments: GameAssignmentsTable;
  readonly game_seat_control: GameSeatControlTable;
  readonly user_sessions: ReferencedUserSessionsTable;
}
