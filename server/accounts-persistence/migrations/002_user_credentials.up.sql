-- The password of an account, as an Argon2id PHC string that carries its own
-- parameters (`$argon2id$v=19$m=...,t=...,p=...$salt$tag`). No password,
-- reversible form, or unsalted digest is ever stored.
CREATE TABLE user_credentials (
  user_id          uuid        NOT NULL,
  password_scheme  text        NOT NULL,
  password_hash    text        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_credentials_pkey PRIMARY KEY (user_id),
  CONSTRAINT user_credentials_user_fkey
    FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE,
  CONSTRAINT user_credentials_scheme CHECK (password_scheme = 'argon2id'),
  CONSTRAINT user_credentials_hash_format CHECK (
    char_length(password_hash) <= 512
    AND password_hash ~ '^\$argon2id\$v=19\$m=[0-9]+,t=[0-9]+,p=[0-9]+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$'
  )
);
