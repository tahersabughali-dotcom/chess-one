-- Reverses 003. It fails, changing nothing, while any challenge is
-- 'accept_failed' (migration 002 has no such state).
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

DROP INDEX challenges_accepting_order;

ALTER TABLE challenges DROP CONSTRAINT challenges_acceptance_reserved;
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

ALTER TABLE challenges DROP CONSTRAINT challenges_status;
ALTER TABLE challenges ADD CONSTRAINT challenges_status
  CHECK (status IN ('pending', 'accepting', 'accepted', 'declined', 'cancelled', 'expired'));
