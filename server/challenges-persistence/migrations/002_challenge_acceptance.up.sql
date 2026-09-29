-- Challenge acceptance (GAME-START-LIFECYCLE-001 resolved): an acceptance is
-- first reserved durably as 'accepting' with its game id, final seats,
-- acceptance time, and start deadline, each fixed once; it becomes
-- 'accepted' only when its game is proven to exist, with created_game_id
-- the reserved id. The reservation columns never change once set.
ALTER TABLE challenges
  ADD COLUMN accepted_at       timestamptz NULL,
  ADD COLUMN intended_game_id  text        NULL,
  ADD COLUMN white_user_id     uuid        NULL,
  ADD COLUMN black_user_id     uuid        NULL,
  ADD COLUMN start_deadline_at timestamptz NULL;

ALTER TABLE challenges DROP CONSTRAINT challenges_status;
ALTER TABLE challenges ADD CONSTRAINT challenges_status
  CHECK (status IN ('pending', 'accepting', 'accepted', 'declined', 'cancelled', 'expired'));

-- Pending and accepting have no resolution time. An expiry resolves at the
-- deadline itself; an acceptance at its reservation time; a decline or
-- cancel strictly before the deadline.
ALTER TABLE challenges DROP CONSTRAINT challenges_resolution;
ALTER TABLE challenges ADD CONSTRAINT challenges_resolution CHECK (
  (status IN ('pending', 'accepting') AND resolved_at IS NULL)
  OR (status = 'expired' AND resolved_at IS NOT NULL AND resolved_at = expires_at)
  OR (status = 'accepted' AND resolved_at IS NOT NULL AND resolved_at = accepted_at)
  OR (
    status IN ('declined', 'cancelled')
    AND resolved_at IS NOT NULL
    AND resolved_at >= created_at
    AND resolved_at < expires_at
  )
);

-- Accepted exactly when a game is recorded, and that game is the reserved one.
ALTER TABLE challenges DROP CONSTRAINT challenges_created_game;
ALTER TABLE challenges ADD CONSTRAINT challenges_created_game CHECK (
  (status = 'accepted') = (created_game_id IS NOT NULL)
  AND (created_game_id IS NULL OR created_game_id = intended_game_id)
);

-- The reservation exists exactly while accepting or accepted, all of it.
ALTER TABLE challenges ADD CONSTRAINT challenges_acceptance_reserved CHECK (
  (
    status IN ('accepting', 'accepted')
    AND accepted_at IS NOT NULL
    AND intended_game_id IS NOT NULL
    AND white_user_id IS NOT NULL
    AND black_user_id IS NOT NULL
    AND start_deadline_at IS NOT NULL
  )
  OR (
    status NOT IN ('accepting', 'accepted')
    AND accepted_at IS NULL
    AND intended_game_id IS NULL
    AND white_user_id IS NULL
    AND black_user_id IS NULL
    AND start_deadline_at IS NULL
  )
);
ALTER TABLE challenges ADD CONSTRAINT challenges_acceptance_time CHECK (
  accepted_at IS NULL OR (accepted_at >= created_at AND accepted_at < expires_at)
);
ALTER TABLE challenges ADD CONSTRAINT challenges_start_deadline CHECK (
  start_deadline_at IS NULL OR start_deadline_at = accepted_at + interval '10 minutes'
);
ALTER TABLE challenges ADD CONSTRAINT challenges_intended_game_id_format
  CHECK (intended_game_id IS NULL OR intended_game_id ~ '^[A-Za-z0-9._:-]{1,128}$');
-- The seats are the two participants, as the preference requires.
ALTER TABLE challenges ADD CONSTRAINT challenges_acceptance_seats CHECK (
  white_user_id IS NULL
  OR (
    (
      (white_user_id = challenger_user_id AND black_user_id = challenged_user_id)
      OR (white_user_id = challenged_user_id AND black_user_id = challenger_user_id)
    )
    AND (seat_preference <> 'white' OR white_user_id = challenger_user_id)
    AND (seat_preference <> 'black' OR black_user_id = challenger_user_id)
  )
);

-- One acceptance per reserved game id.
CREATE UNIQUE INDEX challenges_intended_game_key
  ON challenges (intended_game_id)
  WHERE intended_game_id IS NOT NULL;

-- Allowed changes: pending to accepting, declined, cancelled, or expired
-- (never straight to accepted), and accepting to accepted only. Everything
-- else is history. Settings are fixed at creation; the reservation at
-- acceptance.
CREATE OR REPLACE FUNCTION challenges_guard_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status NOT IN ('pending', 'accepting') THEN
    RAISE EXCEPTION 'challenge % is resolved', OLD.challenge_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.status = 'pending' AND NEW.status = 'accepted' THEN
    RAISE EXCEPTION 'challenge % must reserve its acceptance first', OLD.challenge_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.status = 'accepting' AND NEW.status NOT IN ('accepting', 'accepted') THEN
    RAISE EXCEPTION 'challenge % is being accepted', OLD.challenge_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.status = 'accepting' AND (
    NEW.accepted_at IS DISTINCT FROM OLD.accepted_at
    OR NEW.intended_game_id IS DISTINCT FROM OLD.intended_game_id
    OR NEW.white_user_id IS DISTINCT FROM OLD.white_user_id
    OR NEW.black_user_id IS DISTINCT FROM OLD.black_user_id
    OR NEW.start_deadline_at IS DISTINCT FROM OLD.start_deadline_at
  ) THEN
    RAISE EXCEPTION 'challenge % acceptance is fixed', OLD.challenge_id
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
