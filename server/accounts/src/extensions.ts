import type { UserId } from "@chess-one/identity";
import type { SecretToken } from "./tokens.ts";

/**
 * Extension point for screening new passwords against known breach corpora
 * (for example a k-anonymity range query). Batch 10 ships no implementation
 * that calls out: registration never depends on an external service.
 */
export interface CompromisedPasswordScreen {
  isCompromised(password: string): Promise<boolean>;
}

export const NO_COMPROMISED_PASSWORD_SCREEN: CompromisedPasswordScreen = Object.freeze({
  isCompromised: async () => false,
});

export interface TokenDelivery {
  readonly purpose: "password_reset" | "email_verification";
  readonly userId: UserId;
  /** The account's address as entered; the only place an address leaves the store. */
  readonly email: string;
  readonly token: SecretToken;
  readonly expiresAt: number;
}

/**
 * Where password-reset and verification tokens are sent. No email provider
 * exists yet: the only implementation is a test sink, which declares
 * `test_only`, so production accounts refuse it and run with none (the
 * recovery endpoints then answer FEATURE_UNAVAILABLE).
 */
export interface AccountTokenDelivery {
  readonly trust: "production" | "test_only";
  deliver(delivery: TokenDelivery): Promise<void>;
}
