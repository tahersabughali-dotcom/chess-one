declare const canonicalEmailBrand: unique symbol;

/** The comparison form of an email address. Uniqueness and login lookup use it. */
export type CanonicalEmail = string & { readonly [canonicalEmailBrand]: true };

export interface EmailAddress {
  /** The address as entered, minus surrounding whitespace; mail is sent to this form. */
  readonly display: string;
  readonly canonical: CanonicalEmail;
}

export type EmailRejection =
  | "empty"
  | "too_long"
  | "unsupported_characters"
  | "invalid_format"
  | "invalid_local_part"
  | "invalid_domain";

export type EmailResult =
  | { readonly ok: true; readonly value: EmailAddress }
  | { readonly ok: false; readonly reason: EmailRejection };

/**
 * Email addresses, version 1.
 *
 * Normalization is limited to what is safe for every provider: surrounding
 * ASCII whitespace is removed, and the canonical form is ASCII lowercase of
 * the whole address. The domain is case-insensitive by standard; the local
 * part is folded too, so `Taher@x.example` and `taher@x.example` can never be
 * two accounts. No provider rule is applied: dots and `+tags` are kept, as
 * Gmail's rules are not everyone's. The address is ASCII dot-atom only
 * (RFC 5321/5322 without quoted local parts, comments, or IP literals);
 * internationalized addresses are a recorded later extension.
 */
export const EMAIL_POLICY = Object.freeze({ maxLength: 254, maxLocalLength: 64 });

const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;
const ATEXT = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+$/;
const LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const NUMERIC = /^[0-9]+$/;
const CANONICAL = /^[\x21-\x7e]{3,254}$/;
const SURROUNDING_SPACE = /^[ \t\r\n]+|[ \t\r\n]+$/g;

function lowerAscii(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => String.fromCharCode(letter.charCodeAt(0) + 32));
}

function validLocalPart(local: string): boolean {
  if (local.length === 0 || local.length > EMAIL_POLICY.maxLocalLength) return false;
  return local.split(".").every((atom) => ATEXT.test(atom));
}

function validDomain(domain: string): boolean {
  const labels = domain.split(".");
  if (labels.length < 2 || domain.length > 253) return false;
  const top = labels[labels.length - 1] ?? "";
  return labels.every((label) => LABEL.test(label)) && !NUMERIC.test(top);
}

export function isCanonicalEmail(value: string): value is CanonicalEmail {
  return CANONICAL.test(value) && value === lowerAscii(value) && value.split("@").length === 2;
}

export function parseEmail(input: string): EmailResult {
  const display = input.replace(SURROUNDING_SPACE, "");
  if (display.length === 0) return { ok: false, reason: "empty" };
  if (display.length > EMAIL_POLICY.maxLength) return { ok: false, reason: "too_long" };
  if (!PRINTABLE_ASCII.test(display)) return { ok: false, reason: "unsupported_characters" };
  const parts = display.split("@");
  if (parts.length !== 2) return { ok: false, reason: "invalid_format" };
  const [local = "", domain = ""] = parts;
  if (!validLocalPart(local)) return { ok: false, reason: "invalid_local_part" };
  if (!validDomain(domain)) return { ok: false, reason: "invalid_domain" };
  const canonical = lowerAscii(display);
  if (!isCanonicalEmail(canonical)) return { ok: false, reason: "invalid_format" };
  return { ok: true, value: { display, canonical } };
}
