import type { ColumnType } from "kysely";

/**
 * Kysely view of the live-game schema (migrations 001-004). `bigint` columns
 * are read as the strings pg returns and parsed strictly; `jsonb` columns are
 * written as JSON text and read as parsed, untrusted values. Timestamps are
 * database audit time only and are never read back into game state.
 */
type Int8 = ColumnType<string, number, number>;
type Jsonb = ColumnType<unknown, string, string>;
type AuditTime = ColumnType<unknown, never, never>;
type ReadOnce<T> = ColumnType<T, T, never>;

export interface LiveGamesTable {
  readonly game_id: ReadOnce<string>;
  readonly state_format: string;
  readonly ruleset_id: ReadOnce<string>;
  readonly white_player_id: ReadOnce<string>;
  readonly black_player_id: ReadOnce<string>;
  readonly sequence: Int8;
  readonly status_kind: string;
  readonly position_fen: string;
  readonly clock_domain_id: string;
  readonly state: Jsonb;
  readonly created_at: AuditTime;
  readonly updated_at: ColumnType<unknown, never, string>;
}

export interface LiveGameCommandBindingsTable {
  readonly game_id: ReadOnce<string>;
  readonly seat: ReadOnce<string>;
  readonly client_command_id: ReadOnce<string>;
  readonly binding_ordinal: ReadOnce<number>;
  readonly record_format: ReadOnce<string>;
  readonly fingerprint: ReadOnce<string>;
  readonly bound_at_sequence: ColumnType<string, number, never>;
  readonly response: ColumnType<unknown, string, never>;
  readonly created_at: AuditTime;
}

export interface OutboxEventsTable {
  readonly event_id: ColumnType<string, never, never>;
  readonly event_type: ReadOnce<string>;
  readonly event_version: ReadOnce<number>;
  readonly aggregate_type: ReadOnce<string>;
  readonly aggregate_id: ReadOnce<string>;
  readonly aggregate_sequence: ColumnType<string, number, never>;
  readonly payload: ColumnType<unknown, string, never>;
  readonly created_at: AuditTime;
  readonly publication_status: ColumnType<string, never, string>;
  readonly published_at: ColumnType<unknown, never, string>;
}

export interface LiveGameDatabase {
  readonly live_games: LiveGamesTable;
  readonly live_game_command_bindings: LiveGameCommandBindingsTable;
  readonly outbox_events: OutboxEventsTable;
}
