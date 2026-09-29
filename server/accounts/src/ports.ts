import type {
  AccountStatus,
  CanonicalEmail,
  CanonicalUsername,
  LoginIdentifier,
  UserId,
} from "@chess-one/identity";
import type { SessionId } from "./tokens.ts";

/** Why a session ended. Stored with the revocation; never shown to other users. */
export type RevocationReason =
  | "logout"
  | "logout_all"
  | "revoked_by_user"
  | "password_changed"
  | "password_reset"
  | "account_disabled"
  | "session_limit";

export type ActionTokenPurpose = "password_reset" | "email_verification";

export interface NewAccount {
  readonly userId: UserId;
  readonly username: string;
  readonly usernameCanonical: CanonicalUsername;
  readonly email: string;
  readonly emailCanonical: CanonicalEmail;
  readonly passwordHash: string;
}

export interface NewSession {
  readonly sessionId: SessionId;
  readonly userId: UserId;
  /** SHA-256 digest of the session token; the token itself is never stored. */
  readonly tokenHash: Uint8Array;
  readonly createdAt: number;
  readonly absoluteExpiresAt: number;
}

/**
 * Which of the user's sessions still count toward the per-user cap: not
 * revoked, not past their absolute expiry, and seen after the idle cutoff.
 */
export interface SessionWindow {
  readonly now: number;
  readonly idleCutoff: number;
  readonly maxSessions: number;
}

export interface LoginAccount {
  readonly userId: UserId;
  readonly username: string;
  readonly status: AccountStatus;
  readonly emailVerified: boolean;
  /** Null for an account without a password (for example a future external login). */
  readonly passwordHash: string | null;
}

export interface StoredSession {
  readonly sessionId: SessionId;
  readonly userId: UserId;
  readonly createdAt: number;
  readonly lastSeenAt: number;
  readonly absoluteExpiresAt: number;
  readonly revoked: boolean;
  readonly userStatus: AccountStatus;
}

export interface SessionSummary {
  readonly sessionId: SessionId;
  readonly createdAt: number;
  readonly lastSeenAt: number;
}

export interface AccountProfile {
  readonly userId: UserId;
  readonly username: string;
  readonly usernameCanonical: CanonicalUsername;
  readonly email: string;
  readonly emailCanonical: CanonicalEmail;
  readonly status: AccountStatus;
  readonly emailVerified: boolean;
}

export interface NewActionToken {
  readonly tokenHash: Uint8Array;
  readonly userId: UserId;
  readonly purpose: ActionTokenPurpose;
  /** The address the token was sent to; a token for an address the account no longer has is void. */
  readonly emailCanonical: CanonicalEmail;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface PendingActionToken {
  readonly userId: UserId;
  readonly usernameCanonical: CanonicalUsername;
  readonly emailCanonical: CanonicalEmail;
}

export type CreateAccountResult =
  | { readonly kind: "created" }
  | { readonly kind: "username_taken" }
  | { readonly kind: "email_taken" };

export type ChangePasswordResult =
  | { readonly kind: "changed"; readonly revoked: readonly SessionId[] }
  | { readonly kind: "stale" };

export type CreateSessionResult =
  | { readonly kind: "created"; readonly evicted: readonly SessionId[] }
  | { readonly kind: "stale" };

export type ConsumeResetResult =
  | { readonly kind: "reset"; readonly userId: UserId; readonly revoked: readonly SessionId[] }
  | { readonly kind: "invalid" };

export type ConsumeVerificationResult =
  | { readonly kind: "verified"; readonly userId: UserId }
  | { readonly kind: "invalid" };

/**
 * The accounts store. Business outcomes are typed results; an infrastructure
 * failure is thrown, and nothing of a failed operation is kept (every
 * multi-row operation is one transaction). Uniqueness is decided by the
 * store's constraints, never by a read before a write.
 */
export interface AccountsRepository {
  /** User, credential, and first session in one transaction. */
  createAccount(
    account: NewAccount,
    session: NewSession,
    bounds: SessionWindow,
  ): Promise<CreateAccountResult>;
  findLoginAccount(
    identifier: Exclude<LoginIdentifier, { readonly kind: "unknown" }>,
  ): Promise<LoginAccount | null>;
  /** Compare-and-set of the password hash (rehash on login); false if it changed meanwhile. */
  replacePasswordHash(userId: UserId, expected: string, next: string): Promise<boolean>;
  /**
   * Inserts a login session, under the user row lock and only if the stored
   * password hash is still `passwordHash`, the one the login verified: a
   * password change or reset that committed meanwhile makes it `stale`. If
   * the user already has `maxSessions` counting sessions, the least recently
   * seen are revoked (`session_limit`) in the same transaction.
   */
  createSession(
    session: NewSession,
    bounds: SessionWindow,
    passwordHash: string,
  ): Promise<CreateSessionResult>;
  findSessionByTokenHash(tokenHash: Uint8Array): Promise<StoredSession | null>;
  findSession(sessionId: SessionId): Promise<StoredSession | null>;
  /** Moves `last_seen_at` forward to `at` if the session is live and was seen earlier. */
  touchSession(sessionId: SessionId, at: number): Promise<void>;
  revokeSessionByTokenHash(
    tokenHash: Uint8Array,
    at: number,
    reason: RevocationReason,
  ): Promise<{ readonly sessionId: SessionId; readonly userId: UserId } | null>;
  /** Revokes one session only if it belongs to `userId` and is not revoked yet. */
  revokeUserSession(
    userId: UserId,
    sessionId: SessionId,
    at: number,
    reason: RevocationReason,
  ): Promise<boolean>;
  revokeAllUserSessions(
    userId: UserId,
    at: number,
    reason: RevocationReason,
  ): Promise<readonly SessionId[]>;
  listSessions(userId: UserId, bounds: SessionWindow): Promise<readonly SessionSummary[]>;
  getProfile(userId: UserId): Promise<AccountProfile | null>;
  getPasswordHash(userId: UserId): Promise<string | null>;
  /**
   * Compare-and-set of the password, revocation of every session of the
   * user (`password_changed`), and one new session, in one transaction.
   */
  changePassword(
    userId: UserId,
    expected: string,
    next: string,
    session: NewSession,
  ): Promise<ChangePasswordResult>;
  /** Sets the status; any status but `active` also revokes every session (`account_disabled`). */
  setAccountStatus(
    userId: UserId,
    status: AccountStatus,
    at: number,
  ): Promise<readonly SessionId[] | null>;
  findActiveAccountByEmail(email: CanonicalEmail): Promise<AccountProfile | null>;
  /** Stores a token and deletes the user's other unconsumed tokens of the same purpose. */
  issueActionToken(token: NewActionToken): Promise<void>;
  /** A live, unconsumed token of `purpose` whose account is active and still has that email. */
  findActionToken(
    tokenHash: Uint8Array,
    purpose: ActionTokenPurpose,
    now: number,
  ): Promise<PendingActionToken | null>;
  /**
   * Single use: marks the reset token consumed, sets the password, deletes
   * the user's other reset tokens, and revokes every session, in one
   * transaction. A consumed, expired, or unknown token changes nothing.
   */
  consumePasswordReset(
    tokenHash: Uint8Array,
    now: number,
    passwordHash: string,
  ): Promise<ConsumeResetResult>;
  consumeEmailVerification(tokenHash: Uint8Array, now: number): Promise<ConsumeVerificationResult>;
  /** Maintenance: deletes sessions revoked or absolutely expired before `cutoff`. */
  deleteSessionsEndedBefore(cutoff: number): Promise<number>;
  /** Maintenance: deletes action tokens that expired before `cutoff`. */
  deleteActionTokensExpiredBefore(cutoff: number): Promise<number>;
}
