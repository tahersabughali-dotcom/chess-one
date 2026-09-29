-- The seat assignment of each game: exactly two different accounts, one per
-- seat, fixed at creation. `pending` marks a creation not yet confirmed
-- against the live game (compensation and reconciliation); it grants the
-- same access as `confirmed`. Users are never deleted while they have games.
CREATE TABLE game_assignments (
  game_id        text        NOT NULL,
  white_user_id  uuid        NOT NULL,
  black_user_id  uuid        NOT NULL,
  state          text        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  confirmed_at   timestamptz NULL,
  CONSTRAINT game_assignments_pkey PRIMARY KEY (game_id),
  CONSTRAINT game_assignments_game_id_format CHECK (game_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT game_assignments_white_fkey
    FOREIGN KEY (white_user_id) REFERENCES users (user_id) ON DELETE RESTRICT,
  CONSTRAINT game_assignments_black_fkey
    FOREIGN KEY (black_user_id) REFERENCES users (user_id) ON DELETE RESTRICT,
  CONSTRAINT game_assignments_distinct_players CHECK (white_user_id <> black_user_id),
  CONSTRAINT game_assignments_state CHECK (state IN ('pending', 'confirmed')),
  CONSTRAINT game_assignments_confirmation CHECK (
    (state = 'confirmed') = (confirmed_at IS NOT NULL)
  )
);

-- A user's games, newest first, one index per seat: the seat listing and
-- the account-closed revocation.
CREATE INDEX game_assignments_white_idx ON game_assignments (white_user_id, created_at DESC);
CREATE INDEX game_assignments_black_idx ON game_assignments (black_user_id, created_at DESC);
