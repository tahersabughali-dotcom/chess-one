-- One row per binding decision (DEC-061): the first decision stored for a
-- seat and client command id, replayed unchanged on every retry. Kept for the
-- life of the game; archive and retention policy is not decided, and there
-- is no TTL. `binding_ordinal` is the game's binding order and doubles as a
-- race guard: two writers appending the same ordinal cannot both commit.
CREATE TABLE live_game_command_bindings (
  game_id            text        NOT NULL,
  seat               text        NOT NULL,
  client_command_id  text        NOT NULL,
  binding_ordinal    integer     NOT NULL,
  record_format      text        NOT NULL,
  fingerprint        text        NOT NULL,
  bound_at_sequence  bigint      NOT NULL,
  response           jsonb       NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT live_game_command_bindings_pkey PRIMARY KEY (game_id, seat, client_command_id),
  CONSTRAINT live_game_command_bindings_ordinal_key UNIQUE (game_id, binding_ordinal),
  CONSTRAINT live_game_command_bindings_game_fkey
    FOREIGN KEY (game_id) REFERENCES live_games (game_id) ON DELETE RESTRICT,
  CONSTRAINT live_game_command_bindings_seat CHECK (seat IN ('white', 'black')),
  CONSTRAINT live_game_command_bindings_command_id_format
    CHECK (client_command_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT live_game_command_bindings_ordinal_nonnegative CHECK (binding_ordinal >= 0),
  CONSTRAINT live_game_command_bindings_record_format CHECK (record_format = 'live_game_state.v1'),
  CONSTRAINT live_game_command_bindings_fingerprint_present CHECK (fingerprint <> ''),
  CONSTRAINT live_game_command_bindings_sequence_nonnegative CHECK (bound_at_sequence >= 0),
  CONSTRAINT live_game_command_bindings_response_object CHECK (jsonb_typeof(response) = 'object')
);
