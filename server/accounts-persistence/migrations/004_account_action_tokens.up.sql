-- Single-use tokens for password reset and email verification. Like session
-- tokens, only a SHA-256 digest is stored. A token is bound to the address it
-- was sent to, expires, and is consumed by one conditional UPDATE, so it can
-- be used once even under concurrent attempts.
CREATE TABLE account_action_tokens (
  token_hash       bytea       NOT NULL,
  user_id          uuid        NOT NULL,
  purpose          text        NOT NULL,
  email_canonical  text        NOT NULL,
  created_at       timestamptz NOT NULL,
  expires_at       timestamptz NOT NULL,
  consumed_at      timestamptz NULL,
  CONSTRAINT account_action_tokens_pkey PRIMARY KEY (token_hash),
  CONSTRAINT account_action_tokens_user_fkey
    FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE,
  CONSTRAINT account_action_tokens_hash_length CHECK (octet_length(token_hash) = 32),
  CONSTRAINT account_action_tokens_purpose CHECK (
    purpose IN ('password_reset', 'email_verification')
  ),
  CONSTRAINT account_action_tokens_times CHECK (expires_at > created_at)
);

-- A user's tokens of one purpose: superseding earlier tokens when a new one is issued.
CREATE INDEX account_action_tokens_user_purpose_idx
  ON account_action_tokens (user_id, purpose);
