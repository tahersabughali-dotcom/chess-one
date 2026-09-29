-- The game start lifecycle (live_game_state.v2). A game is created awaiting
-- its players with no clock running, and leaves that status exactly once:
-- by its start or by its abort at the start deadline. Rows written before
-- this migration keep their v1 record and meaning; v1 never holds a pre-game
-- status, so the new statuses are admitted for v2 rows only.
ALTER TABLE live_games DROP CONSTRAINT live_games_state_format;
ALTER TABLE live_games ADD CONSTRAINT live_games_state_format
  CHECK (state_format IN ('live_game_state.v1', 'live_game_state.v2'));

ALTER TABLE live_games DROP CONSTRAINT live_games_status_kind;
ALTER TABLE live_games ADD CONSTRAINT live_games_status_kind CHECK (
  status_kind IN ('active', 'finished', 'unresolved')
  OR (
    state_format = 'live_game_state.v2'
    AND status_kind IN ('awaiting_players', 'aborted_before_start')
  )
);

-- Awaiting is sequence 0 and an abort is the one transition after it, so no
-- command was ever decided for either. The deadline is UTC epoch
-- milliseconds, a non-negative integer.
ALTER TABLE live_games ADD CONSTRAINT live_games_pre_game_shape CHECK (
  status_kind NOT IN ('awaiting_players', 'aborted_before_start')
  OR (
    sequence = CASE status_kind WHEN 'awaiting_players' THEN 0 ELSE 1 END
    AND jsonb_typeof(state -> 'status' -> 'startDeadlineAtWallMs') = 'number'
    AND (state -> 'status' ->> 'startDeadlineAtWallMs') ~ '^(0|[1-9][0-9]{0,15})$'
    AND (state -> 'clock' -> 'running') = 'false'::jsonb
  )
);

-- The start-deadline sweep reads awaiting games by deadline.
CREATE INDEX live_games_awaiting_deadline_idx
  ON live_games (((state -> 'status' ->> 'startDeadlineAtWallMs')::bigint), game_id)
  WHERE status_kind = 'awaiting_players';
