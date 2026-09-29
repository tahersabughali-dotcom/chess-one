-- One row per account. `user_id` is a random UUID chosen by the server;
-- neither the username nor the email address is a key. Uniqueness is on the
-- canonical forms (ASCII lowercase), decided by these constraints and never
-- by a read before the insert. The password lives in `user_credentials`, so
-- an account without a password (a future external login) needs no change
-- here. `lower(... COLLATE "C")` folds ASCII only, whatever the locale.
CREATE TABLE users (
  user_id             uuid        NOT NULL,
  username            text        NOT NULL,
  username_canonical  text        NOT NULL,
  email               text        NOT NULL,
  email_canonical     text        NOT NULL,
  email_verified_at   timestamptz NULL,
  status              text        NOT NULL DEFAULT 'active',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_pkey PRIMARY KEY (user_id),
  CONSTRAINT users_username_format CHECK (
    username ~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,22}[A-Za-z0-9]$' AND username !~ '[_-]{2}'
  ),
  CONSTRAINT users_username_canonical_form CHECK (
    username_canonical = lower(username COLLATE "C")
  ),
  CONSTRAINT users_email_format CHECK (
    char_length(email) BETWEEN 3 AND 254 AND email ~ '^[!-~]+$' AND email ~ '^[^@]+@[^@]+$'
  ),
  CONSTRAINT users_email_canonical_form CHECK (email_canonical = lower(email COLLATE "C")),
  CONSTRAINT users_status CHECK (status IN ('active', 'disabled', 'locked')),
  CONSTRAINT users_username_canonical_key UNIQUE (username_canonical),
  CONSTRAINT users_email_canonical_key UNIQUE (email_canonical)
);
