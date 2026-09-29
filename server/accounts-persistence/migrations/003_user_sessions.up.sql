-- Opaque server sessions. The cookie holds a 256-bit random token; only its
-- SHA-256 digest is stored, so a copy of this table cannot be replayed as a
-- cookie. Times are the accounts service's wall clock. A session is live
-- while unrevoked, before `absolute_expires_at`, and seen within the idle
-- window; the service checks all three on every use.
CREATE TABLE user_sessions (
  session_id           uuid        NOT NULL,
  user_id              uuid        NOT NULL,
  token_hash           bytea       NOT NULL,
  created_at           timestamptz NOT NULL,
  last_seen_at         timestamptz NOT NULL,
  absolute_expires_at  timestamptz NOT NULL,
  revoked_at           timestamptz NULL,
  revocation_reason    text        NULL,
  CONSTRAINT user_sessions_pkey PRIMARY KEY (session_id),
  CONSTRAINT user_sessions_user_fkey
    FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE,
  CONSTRAINT user_sessions_token_hash_length CHECK (octet_length(token_hash) = 32),
  CONSTRAINT user_sessions_token_hash_key UNIQUE (token_hash),
  CONSTRAINT user_sessions_times CHECK (
    last_seen_at >= created_at AND absolute_expires_at > created_at
  ),
  CONSTRAINT user_sessions_revocation CHECK (
    (revoked_at IS NULL AND revocation_reason IS NULL)
    OR (
      revoked_at IS NOT NULL
      AND revocation_reason IS NOT NULL
      AND revocation_reason IN (
        'logout', 'logout_all', 'revoked_by_user', 'password_changed',
        'password_reset', 'account_disabled', 'session_limit'
      )
    )
  )
);

-- A user's unrevoked sessions, least recently seen first: session listing,
-- revoke-all, and the per-user cap.
CREATE INDEX user_sessions_user_live_idx
  ON user_sessions (user_id, last_seen_at) WHERE revoked_at IS NULL;
