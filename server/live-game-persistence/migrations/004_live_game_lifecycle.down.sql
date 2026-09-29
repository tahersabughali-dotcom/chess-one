-- Refused while any row uses live_game_state.v2: the v1 constraints cannot hold it.
DROP INDEX live_games_awaiting_deadline_idx;
ALTER TABLE live_games DROP CONSTRAINT live_games_pre_game_shape;
ALTER TABLE live_games DROP CONSTRAINT live_games_status_kind;
ALTER TABLE live_games ADD CONSTRAINT live_games_status_kind
  CHECK (status_kind IN ('active', 'finished', 'unresolved'));
ALTER TABLE live_games DROP CONSTRAINT live_games_state_format;
ALTER TABLE live_games ADD CONSTRAINT live_games_state_format
  CHECK (state_format = 'live_game_state.v1');
