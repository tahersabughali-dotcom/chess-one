import type { CanonicalEmail } from "./email.ts";
import type { CanonicalUsername } from "./username.ts";

/**
 * Password policy, version 1 (length-based, NIST SP 800-63B style):
 *
 * - at least 15 and at most 256 characters, counted as Unicode code points
 *   (15 because the password is the only authentication factor);
 * - any printable character, spaces included, so long passphrases work;
 * - no composition rules (no forced upper case, digit, or symbol);
 * - the password is used exactly as given: never trimmed, truncated,
 *   case-folded, or Unicode-normalized. What cannot be kept exactly is
 *   refused instead: unpaired surrogates (not encodable as UTF-8) and
 *   control characters (not typeable and easy to smuggle);
 * - a new password may not equal the account's username or email address.
 *
 * 256 code points is at most 1024 bytes of UTF-8. Argon2 absorbs its input
 * through one BLAKE2b pass, so this bound, not the hash, limits input cost.
 */
export const PASSWORD_POLICY = Object.freeze({ minLength: 15, maxLength: 256 });

export type PasswordRejection =
  | "too_short"
  | "too_long"
  | "malformed_unicode"
  | "control_characters"
  | "matches_account_identifier";

export type PasswordCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: PasswordRejection };

/** C0 controls, DEL, and C1 controls. */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/** Code points of a well-formed string: every UTF-16 unit except the low half of a pair. */
function codePoints(value: string): number {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0xdc00 || code > 0xdfff) count += 1;
  }
  return count;
}

/**
 * The checks every password input passes before it reaches a hash function,
 * including a login attempt: exact encodability and the size bound. The
 * minimum length and identifier rules apply to new passwords only, so an
 * account created under an earlier policy can still sign in.
 */
export function checkPasswordInput(password: string): PasswordCheck {
  if (password.length === 0) return { ok: false, reason: "too_short" };
  if (!password.isWellFormed()) return { ok: false, reason: "malformed_unicode" };
  if (codePoints(password) > PASSWORD_POLICY.maxLength) return { ok: false, reason: "too_long" };
  return { ok: true };
}

export interface PasswordContext {
  readonly username: CanonicalUsername;
  readonly email: CanonicalEmail;
}

function lowerAscii(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => String.fromCharCode(letter.charCodeAt(0) + 32));
}

export function checkNewPassword(password: string, context: PasswordContext): PasswordCheck {
  const input = checkPasswordInput(password);
  if (!input.ok) return input;
  if (hasControlCharacter(password)) return { ok: false, reason: "control_characters" };
  if (codePoints(password) < PASSWORD_POLICY.minLength) return { ok: false, reason: "too_short" };
  const folded = lowerAscii(password);
  if (folded === context.username || folded === context.email) {
    return { ok: false, reason: "matches_account_identifier" };
  }
  return { ok: true };
}
