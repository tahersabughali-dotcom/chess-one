-- One row per live game: the aggregate state in `live_game_state.v1`, with
-- the fields used for lookup, concurrency, and integrity as typed columns.
-- `sequence` is the optimistic-concurrency token: every committed
-- transition moves it by exactly one with
-- UPDATE ... WHERE game_id = $1 AND sequence = $expected.
-- `clock_domain_id` names the writer clock domain whose monotonic instants
-- the stored clock uses (DEC-063). Timestamps are audit time only.
CREATE TABLE live_games (
  game_id          text        NOT NULL,
  state_format     text        NOT NULL,
  ruleset_id       text        NOT NULL,
  white_player_id  text        NOT NULL,
  black_player_id  text        NOT NULL,
  sequence         bigint      NOT NULL,
  status_kind      text        NOT NULL,
  position_fen     text        NOT NULL,
  clock_domain_id  text        NOT NULL,
  state            jsonb       NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT live_games_pkey PRIMARY KEY (game_id),
  CONSTRAINT live_games_game_id_format CHECK (game_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT live_games_state_format CHECK (state_format = 'live_game_state.v1'),
  CONSTRAINT live_games_sequence_nonnegative CHECK (sequence >= 0),
  CONSTRAINT live_games_status_kind CHECK (status_kind IN ('active', 'finished', 'unresolved')),
  CONSTRAINT live_games_distinct_players CHECK (white_player_id <> black_player_id),
  CONSTRAINT live_games_clock_domain_format CHECK (clock_domain_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT live_games_state_object CHECK (jsonb_typeof(state) = 'object'),
  CONSTRAINT live_games_state_matches_columns CHECK (
    state ->> 'format' = state_format
    AND state ->> 'gameId' = game_id
    AND (state -> 'sequence')::bigint = sequence
    AND state -> 'status' ->> 'kind' = status_kind
    AND state ->> 'positionFen' = position_fen
  ),
  CONSTRAINT live_games_offer_only_when_active CHECK (
    state -> 'pendingDrawOffer' = 'null'::jsonb OR status_kind = 'active'
  )
);
