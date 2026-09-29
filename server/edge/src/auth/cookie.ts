/**
 * The session cookie. `secure` is the only production mode: the `__Host-`
 * prefix makes browsers refuse the cookie unless it is Secure, has Path=/,
 * and has no Domain, so no subdomain or plain-HTTP page can set or overwrite
 * it. `insecure_loopback` drops Secure (and so the prefix) for plain-HTTP
 * tests on a loopback origin; the edge refuses it in production.
 */
export type SessionCookieMode = "secure" | "insecure_loopback";

export interface SessionCookiePolicy {
  readonly mode: SessionCookieMode;
  readonly name: string;
}

export const SECURE_SESSION_COOKIE = "__Host-chess_one_session";
export const LOOPBACK_SESSION_COOKIE = "chess_one_session";

export function sessionCookiePolicy(mode: SessionCookieMode): SessionCookiePolicy {
  return Object.freeze({
    mode,
    name: mode === "secure" ? SECURE_SESSION_COOKIE : LOOPBACK_SESSION_COOKIE,
  });
}

export type CookieRead =
  | { readonly kind: "absent" }
  | { readonly kind: "token"; readonly token: string }
  | { readonly kind: "rejected"; readonly reason: "duplicate" | "malformed" | "too_large" };

/** RFC 6265 cookie-name (an RFC 7230 token). */
const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
/** RFC 6265 cookie-value octets, optionally double-quoted. */
const COOKIE_VALUE =
  /^(?:"[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*"|[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*)$/;
/** A session token: 32 random bytes in unpadded base64url. */
const SESSION_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Reads the session token from a `Cookie` header. Fails closed: a header
 * that is not a well-formed cookie list, carries the session cookie twice
 * (a sign of cookie injection or tossing), or carries a value that is not a
 * token shape is rejected as a whole rather than guessed at.
 */
export function readSessionCookie(
  header: string | null,
  policy: SessionCookiePolicy,
  maxLength: number,
): CookieRead {
  if (header === null || header === "") return { kind: "absent" };
  if (header.length > maxLength) return { kind: "rejected", reason: "too_large" };
  let token: string | null = null;
  for (const part of header.split(";")) {
    const pair = part.trim();
    const equals = pair.indexOf("=");
    if (equals <= 0) return { kind: "rejected", reason: "malformed" };
    const name = pair.slice(0, equals);
    const value = pair.slice(equals + 1);
    if (!COOKIE_NAME.test(name) || !COOKIE_VALUE.test(value)) {
      return { kind: "rejected", reason: "malformed" };
    }
    if (name !== policy.name) continue;
    if (token !== null) return { kind: "rejected", reason: "duplicate" };
    if (!SESSION_TOKEN.test(value)) return { kind: "rejected", reason: "malformed" };
    token = value;
  }
  return token === null ? { kind: "absent" } : { kind: "token", token };
}

function attributes(policy: SessionCookiePolicy, maxAgeSeconds: number): string {
  const secure = policy.mode === "secure" ? "; Secure" : "";
  return `Path=/; Max-Age=${maxAgeSeconds}; HttpOnly${secure}; SameSite=Lax`;
}

export function sessionCookieHeader(
  policy: SessionCookiePolicy,
  token: string,
  maxAgeSeconds: number,
): string {
  if (!SESSION_TOKEN.test(token)) throw new Error("Refusing to set a malformed session cookie");
  return `${policy.name}=${token}; ${attributes(policy, maxAgeSeconds)}`;
}

export function clearedSessionCookieHeader(policy: SessionCookiePolicy): string {
  return `${policy.name}=; ${attributes(policy, 0)}`;
}
