-- Reverses 002. It fails, changing nothing, while any challenge is
-- 'accepting' (migration 001 has no such state): settle those first.
CREATE OR REPLACE FUNCTION challenges_guard_update() RETURNS trigger LANGUAGE plpgsql AS $$
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

DROP INDEX challenges_intended_game_key;

ALTER TABLE challenges DROP CONSTRAINT challenges_acceptance_seats;
ALTER TABLE challenges DROP CONSTRAINT challenges_intended_game_id_format;
ALTER TABLE challenges DROP CONSTRAINT challenges_start_deadline;
ALTER TABLE challenges DROP CONSTRAINT challenges_acceptance_time;
ALTER TABLE challenges DROP CONSTRAINT challenges_acceptance_reserved;

ALTER TABLE challenges DROP CONSTRAINT challenges_created_game;
ALTER TABLE challenges ADD CONSTRAINT challenges_created_game
  CHECK ((status = 'accepted') = (created_game_id IS NOT NULL));

ALTER TABLE challenges DROP CONSTRAINT challenges_resolution;
ALTER TABLE challenges ADD CONSTRAINT challenges_resolution CHECK (
  (status = 'pending' AND resolved_at IS NULL)
  OR (status = 'expired' AND resolved_at IS NOT NULL AND resolved_at = expires_at)
  OR (
    status IN ('accepted', 'declined', 'cancelled')
    AND resolved_at IS NOT NULL
    AND resolved_at >= created_at
    AND resolved_at < expires_at
  )
);

ALTER TABLE challenges DROP CONSTRAINT challenges_status;
ALTER TABLE challenges ADD CONSTRAINT challenges_status
  CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired'));

ALTER TABLE challenges
  DROP COLUMN start_deadline_at,
  DROP COLUMN black_user_id,
  DROP COLUMN white_user_id,
  DROP COLUMN intended_game_id,
  DROP COLUMN accepted_at;
