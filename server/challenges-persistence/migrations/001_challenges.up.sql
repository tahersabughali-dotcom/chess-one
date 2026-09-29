-- Direct challenges between two registered accounts. Times are UTC wall
-- time from the application's clock. Rows are never deleted by the
-- application: a resolved or expired challenge stays as history. Users are
-- never deleted while they have challenges (ON DELETE RESTRICT; account
-- deletion does not exist yet and must decide the retention of these rows).
CREATE TABLE challenges (
  challenge_id        text        NOT NULL,
  challenger_user_id  uuid        NOT NULL,
  challenged_user_id  uuid        NOT NULL,
  status              text        NOT NULL,
  ruleset_id          text        NOT NULL,
  time_control_type   text        NOT NULL,
  initial_time_ms     integer     NOT NULL,
  increment_ms        integer     NOT NULL,
  seat_preference     text        NOT NULL,
  created_at          timestamptz NOT NULL,
  expires_at          timestamptz NOT NULL,
  resolved_at         timestamptz NULL,
  created_game_id     text        NULL,
  CONSTRAINT challenges_pkey PRIMARY KEY (challenge_id),
  CONSTRAINT challenges_challenge_id_format CHECK (challenge_id ~ '^[A-Za-z0-9_-]{22}$'),
  CONSTRAINT challenges_challenger_fkey
    FOREIGN KEY (challenger_user_id) REFERENCES users (user_id) ON DELETE RESTRICT,
  CONSTRAINT challenges_challenged_fkey
    FOREIGN KEY (challenged_user_id) REFERENCES users (user_id) ON DELETE RESTRICT,
  CONSTRAINT challenges_distinct_participants CHECK (challenger_user_id <> challenged_user_id),
  CONSTRAINT challenges_status
    CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  CONSTRAINT challenges_ruleset_id_format CHECK (ruleset_id ~ '^[A-Z][A-Z0-9]*(-[A-Z0-9]+)+$'),
  -- The live game plays sudden death only and has no increment yet.
  CONSTRAINT challenges_time_control_type CHECK (time_control_type = 'sudden_death'),
  CONSTRAINT challenges_initial_time
    CHECK (initial_time_ms BETWEEN 60000 AND 10800000 AND initial_time_ms % 1000 = 0),
  CONSTRAINT challenges_increment CHECK (increment_ms = 0),
  CONSTRAINT challenges_seat_preference CHECK (seat_preference IN ('white', 'black', 'random')),
  CONSTRAINT challenges_expiry_after_creation CHECK (expires_at > created_at),
  -- Pending has no resolution time. An expiry resolves at the deadline
  -- itself; every other resolution happened strictly before it. Each branch
  -- tests resolved_at for NULL itself: a NULL comparison would pass a CHECK.
  CONSTRAINT challenges_resolution CHECK (
    (status = 'pending' AND resolved_at IS NULL)
    OR (status = 'expired' AND resolved_at IS NOT NULL AND resolved_at = expires_at)
    OR (
      status IN ('accepted', 'declined', 'cancelled')
      AND resolved_at IS NOT NULL
      AND resolved_at >= created_at
      AND resolved_at < expires_at
    )
  ),
  CONSTRAINT challenges_created_game CHECK ((status = 'accepted') = (created_game_id IS NOT NULL)),
  CONSTRAINT challenges_created_game_id_format
    CHECK (created_game_id IS NULL OR created_game_id ~ '^[A-Za-z0-9._:-]{1,128}$')
);

-- At most one pending challenge per unordered pair, in either direction.
CREATE UNIQUE INDEX challenges_pending_pair_key
  ON challenges (LEAST(challenger_user_id, challenged_user_id), GREATEST(challenger_user_id, challenged_user_id))
  WHERE status = 'pending';

-- One challenge per created game.
CREATE UNIQUE INDEX challenges_created_game_key
  ON challenges (created_game_id)
  WHERE created_game_id IS NOT NULL;

-- Pending lists (newest first, keyset pages) and the pending caps.
CREATE INDEX challenges_incoming_pending_idx
  ON challenges (challenged_user_id, created_at DESC, challenge_id DESC)
  WHERE status = 'pending';
CREATE INDEX challenges_outgoing_pending_idx
  ON challenges (challenger_user_id, created_at DESC, challenge_id DESC)
  WHERE status = 'pending';

-- The expiry sweep.
CREATE INDEX challenges_pending_expiry_idx ON challenges (expires_at) WHERE status = 'pending';

-- A resolved challenge is history: nothing in it changes again, so the
-- created game is never replaced. A pending challenge changes only its
-- resolution; its participants and settings are fixed at creation.
CREATE FUNCTION challenges_guard_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'challenge % is resolved', OLD.challenge_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.challenge_id IS DISTINCT FROM OLD.challenge_id
    OR NEW.challenger_user_id IS DISTINCT FROM OLD.challenger_user_id
    OR NEW.challenged_user_id IS DISTINCT FROM OLD.challenged_user_id
    OR NEW.ruleset_id IS DISTINCT FROM OLD.ruleset_id
    OR NEW.time_control_type IS DISTINCT FROM OLD.time_control_type
    OR NEW.initial_time_ms IS DISTINCT FROM OLD.initial_time_ms
    OR NEW.increment_ms IS DISTINCT FROM OLD.increment_ms
    OR NEW.seat_preference IS DISTINCT FROM OLD.seat_preference
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'challenge % settings are fixed', OLD.challenge_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER challenges_guard_update
  BEFORE UPDATE ON challenges
  FOR EACH ROW EXECUTE FUNCTION challenges_guard_update();
