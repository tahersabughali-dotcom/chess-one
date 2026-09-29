import type { AccountStatus, UserId } from "@chess-one/identity";
import type { RevocationReason } from "./ports.ts";
import type { SecretToken, SessionId } from "./tokens.ts";

/**
 * Told, in this process, after a session revocation or an account status
 * change is stored. It is how layers above accounts (game control) drop
 * what a session held without accounts knowing what that is. Calls are
 * synchronous and must not throw; a listener that throws is reported, and
 * the others are still called.
 */
export interface SessionEndListener {
  sessionsEnded(userId: UserId, sessionIds: readonly SessionId[], reason: RevocationReason): void;
  /** The account can no longer sign in (disabled or locked); every session was revoked with it. */
  accountClosed(userId: UserId, status: AccountStatus): void;
}

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
