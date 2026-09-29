declare const canonicalUsernameBrand: unique symbol;

/** The comparison form of a username: ASCII lowercase. Uniqueness is on this value. */
export type CanonicalUsername = string & { readonly [canonicalUsernameBrand]: true };

export interface Username {
  /** As the owner typed it, kept for display. */
  readonly display: string;
  readonly canonical: CanonicalUsername;
}

export type UsernameRejection =
  | "too_short"
  | "too_long"
  | "invalid_characters"
  | "invalid_edge"
  | "consecutive_separators"
  | "reserved";

export type UsernameResult =
  | { readonly ok: true; readonly value: Username }
  | { readonly ok: false; readonly reason: UsernameRejection };

/**
 * Login usernames, version 1: 3 to 24 characters from A-Z, a-z, 0-9, `_`,
 * and `-`; the first and last are a letter or digit, and two separators are
 * never adjacent. ASCII only, so there are no invisible, confusable, or
 * case-folding surprises; an international display name is a separate,
 * later concept. The same rule is a CHECK constraint in PostgreSQL.
 */
export const USERNAME_POLICY = Object.freeze({ minLength: 3, maxLength: 24 });

const ALLOWED = /^[A-Za-z0-9_-]+$/;
const CANONICAL = /^[a-z0-9_-]{3,24}$/;
const ALPHANUMERIC = /^[A-Za-z0-9]$/;
const DOUBLE_SEPARATOR = /[_-]{2}/;

/** Names that would let an account pose as the service or its staff. */
const RESERVED: ReadonlySet<string> = new Set([
  "admin",
  "administrator",
  "anonymous",
  "api",
  "auth",
  "chess-one",
  "chess_one",
  "chessone",
  "guest",
  "moderator",
  "null",
  "official",
  "root",
  "security",
  "staff",
  "support",
  "system",
  "undefined",
]);

function lowerAscii(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => String.fromCharCode(letter.charCodeAt(0) + 32));
}

export function isCanonicalUsername(value: string): value is CanonicalUsername {
  return CANONICAL.test(value);
}

/** Validates a username exactly as given: nothing is trimmed or rewritten. */
export function parseUsername(input: string): UsernameResult {
  if (input.length < USERNAME_POLICY.minLength) return { ok: false, reason: "too_short" };
  if (input.length > USERNAME_POLICY.maxLength) return { ok: false, reason: "too_long" };
  if (!ALLOWED.test(input)) return { ok: false, reason: "invalid_characters" };
  if (!ALPHANUMERIC.test(input.charAt(0)) || !ALPHANUMERIC.test(input.charAt(input.length - 1))) {
    return { ok: false, reason: "invalid_edge" };
  }
  if (DOUBLE_SEPARATOR.test(input)) return { ok: false, reason: "consecutive_separators" };
  const canonical = lowerAscii(input);
  if (!isCanonicalUsername(canonical)) return { ok: false, reason: "invalid_characters" };
  if (RESERVED.has(canonical)) return { ok: false, reason: "reserved" };
  return { ok: true, value: { display: input, canonical } };
}

/**
 * The canonical form of something typed as a login username, or null if it
 * could never be a username. Reserved names are not refused here: login
 * looks them up like any other name.
 */
export function canonicalLoginUsername(input: string): CanonicalUsername | null {
  if (!ALLOWED.test(input)) return null;
  const canonical = lowerAscii(input);
  return isCanonicalUsername(canonical) ? canonical : null;
}
