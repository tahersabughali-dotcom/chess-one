import { createHash, randomBytes, randomUUID } from "node:crypto";

declare const secretTokenBrand: unique symbol;
declare const sessionIdBrand: unique symbol;

/**
 * A bearer secret: 256 bits from the CSPRNG, as 43 characters of unpadded
 * base64url. Session, password-reset, and email-verification tokens all use
 * this shape. The token itself is never stored or logged; the store keeps
 * only `tokenDigest(purpose, token)`.
 */
export type SecretToken = string & { readonly [secretTokenBrand]: true };

/** A session's public handle: shown in the session list, useless as a credential. */
export type SessionId = string & { readonly [sessionIdBrand]: true };

export type TokenPurpose = "session" | "password_reset" | "email_verification";

/** 32 bytes in base64url: 42 free characters, then one carrying the last 2 bits (4 zero bits). */
const SECRET_TOKEN = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isSecretToken(value: string): value is SecretToken {
  return SECRET_TOKEN.test(value);
}

export function isSessionId(value: string): value is SessionId {
  return UUID_V4.test(value);
}

export function newSecretToken(): SecretToken {
  const token = randomBytes(32).toString("base64url");
  if (!isSecretToken(token)) throw new Error("The CSPRNG produced a malformed token");
  return token;
}

export function newSessionId(): SessionId {
  const id = randomUUID();
  if (!isSessionId(id)) throw new Error("randomUUID produced a malformed id");
  return id;
}

/**
 * SHA-256 of the token under a purpose label. The token has 256 bits of
 * entropy, so a fast hash is enough: a leaked table cannot be turned back
 * into tokens, and the label keeps a session digest from ever matching a
 * reset or verification digest.
 */
export function tokenDigest(purpose: TokenPurpose, token: SecretToken): Uint8Array {
  return createHash("sha256").update(`chess-one:${purpose}:v1:${token}`).digest();
}

/** A fixed-size digest of a throttle key, so limiters never hold raw emails or names. */
export function keyDigest(scope: string, key: string): string {
  return createHash("sha256").update(`${scope}\u0000${key}`).digest("base64url");
}
