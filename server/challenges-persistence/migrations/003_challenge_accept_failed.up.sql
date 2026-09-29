-- Challenge acceptance failure (CHALLENGE-ACCEPT-STUCK-001): an 'accepting'
-- challenge whose reserved game is proven never to exist as reserved (a
-- participant became ineligible before the game existed, or its id holds
-- another game) ends as 'accept_failed'. It keeps its reservation for audit
-- and has no game: created_game_id stays NULL (challenges_created_game,
-- unchanged, already requires it). Its resolution time is when the failure
-- was proven: never before the acceptance, and possibly after the
-- challenge's own deadline, since an acceptance never expires.
--
-- Exceptional invariant: a failed acceptance's intended_game_id keeps its
-- unique reservation even when another game holds that id (the mismatch
-- case); nothing is ever created under it for this challenge.
ALTER TABLE challenges DROP CONSTRAINT challenges_status;
ALTER TABLE challenges ADD CONSTRAINT challenges_status CHECK (
  status IN ('pending', 'accepting', 'accepted', 'accept_failed', 'declined', 'cancelled', 'expired')
);

ALTER TABLE challenges DROP CONSTRAINT challenges_resolution;
ALTER TABLE challenges ADD CONSTRAINT challenges_resolution CHECK (
  (status IN ('pending', 'accepting') AND resolved_at IS NULL)
  OR (status = 'expired' AND resolved_at IS NOT NULL AND resolved_at = expires_at)
  OR (status = 'accepted' AND resolved_at IS NOT NULL AND resolved_at = accepted_at)
  OR (status = 'accept_failed' AND resolved_at IS NOT NULL AND resolved_at >= accepted_at)
  OR (
    status IN ('declined', 'cancelled')
    AND resolved_at IS NOT NULL
    AND resolved_at >= created_at
    AND resolved_at < expires_at
  )
);

-- The reservation exists exactly while accepting, accepted, or failed, all of it.
ALTER TABLE challenges DROP CONSTRAINT challenges_acceptance_reserved;
ALTER TABLE challenges ADD CONSTRAINT challenges_acceptance_reserved CHECK (
  (
    status IN ('accepting', 'accepted', 'accept_failed')
    AND accepted_at IS NOT NULL
    AND intended_game_id IS NOT NULL
    AND white_user_id IS NOT NULL
    AND black_user_id IS NOT NULL
    AND start_deadline_at IS NOT NULL
  )
  OR (
    status NOT IN ('accepting', 'accepted', 'accept_failed')
    AND accepted_at IS NULL
    AND intended_game_id IS NULL
    AND white_user_id IS NULL
    AND black_user_id IS NULL
    AND start_deadline_at IS NULL
  )
);

-- The reconciliation reads accepting challenges oldest reservation first.
CREATE INDEX challenges_accepting_order
  ON challenges (accepted_at, challenge_id)
  WHERE status = 'accepting';

-- Allowed changes: pending to accepting, declined, cancelled, or expired
-- (never straight to accepted or accept_failed), and accepting to accepted
-- or accept_failed only. Everything else is history. Settings are fixed at
-- creation; the reservation at acceptance.
CREATE OR REPLACE FUNCTION challenges_guard_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status NOT IN ('pending', 'accepting') THEN
    RAISE EXCEPTION 'challenge % is resolved', OLD.challenge_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.status = 'pending' AND NEW.status IN ('accepted', 'accept_failed') THEN
    RAISE EXCEPTION 'challenge % must reserve its acceptance first', OLD.challenge_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.status = 'accepting' AND NEW.status NOT IN ('accepting', 'accepted', 'accept_failed') THEN
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
