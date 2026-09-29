import { type CanonicalEmail, parseEmail } from "./email.ts";
import { type CanonicalUsername, canonicalLoginUsername } from "./username.ts";

/**
 * What a login form's identifier names. A username can never contain `@`,
 * so the parse is unambiguous: with `@` it is an email address, without it
 * a username. Anything that could name no account is `unknown`; login treats
 * it exactly like an account that does not exist.
 */
export type LoginIdentifier =
  | { readonly kind: "email"; readonly canonical: CanonicalEmail }
  | { readonly kind: "username"; readonly canonical: CanonicalUsername }
  | { readonly kind: "unknown" };

export function parseLoginIdentifier(input: string): LoginIdentifier {
  if (input.includes("@")) {
    const email = parseEmail(input);
    return email.ok ? { kind: "email", canonical: email.value.canonical } : { kind: "unknown" };
  }
  const username = canonicalLoginUsername(input);
  return username === null ? { kind: "unknown" } : { kind: "username", canonical: username };
}
