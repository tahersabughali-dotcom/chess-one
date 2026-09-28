-- Transactional outbox. A row is written in the same transaction as the
-- state change that produced the event, and is never published from inside
-- that transaction. `event_id` is the durable event identity, assigned here
-- at the persistence boundary (LIVE-CONTRACT-003). The uniqueness constraint
-- stops a retried decision from storing the same event twice.
-- Kept for the life of the game; archive and retention policy is not decided.
CREATE TABLE outbox_events (
  event_id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  event_type          text        NOT NULL,
  event_version       integer     NOT NULL,
  aggregate_type      text        NOT NULL,
  aggregate_id        text        NOT NULL,
  aggregate_sequence  bigint      NOT NULL,
  payload             jsonb       NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  publication_status  text        NOT NULL DEFAULT 'pending',
  published_at        timestamptz NULL,
  CONSTRAINT outbox_events_pkey PRIMARY KEY (event_id),
  CONSTRAINT outbox_events_once_per_aggregate_sequence
    UNIQUE (aggregate_type, aggregate_id, aggregate_sequence, event_type),
  CONSTRAINT outbox_events_live_game_fkey
    FOREIGN KEY (aggregate_id) REFERENCES live_games (game_id) ON DELETE RESTRICT,
  CONSTRAINT outbox_events_aggregate_type CHECK (aggregate_type = 'live_game'),
  CONSTRAINT outbox_events_event_type CHECK (event_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  CONSTRAINT outbox_events_event_version_positive CHECK (event_version > 0),
  CONSTRAINT outbox_events_sequence_nonnegative CHECK (aggregate_sequence >= 0),
  CONSTRAINT outbox_events_payload_object CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT outbox_events_publication_status CHECK (publication_status IN ('pending', 'published')),
  CONSTRAINT outbox_events_published_at_matches_status
    CHECK ((publication_status = 'published') = (published_at IS NOT NULL))
);

-- A future dispatcher reads pending rows oldest first.
CREATE INDEX outbox_events_pending_idx
  ON outbox_events (created_at, event_id)
  WHERE publication_status = 'pending';
