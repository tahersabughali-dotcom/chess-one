import type { AccountStatus, UserId } from "@chess-one/identity";
import type { SecretToken, SessionId } from "./tokens.ts";

/** Facts about the request that only the transport knows. */
export interface AuthRequest {
  /** The peer address as the transport sees it; used as a throttle key only. */
  readonly clientAddress: string;
}

/** A new session. The token goes into a cookie and nowhere else. */
export interface IssuedSession {
  readonly token: SecretToken;
  readonly sessionId: SessionId;
  readonly userId: UserId;
  /** Seconds until the absolute expiry, for the cookie's Max-Age. */
  readonly maxAgeSeconds: number;
}

/** A session proven by its token: who the user is, and nothing about games or seats. */
export interface AuthenticatedSession {
  readonly sessionId: SessionId;
  readonly userId: UserId;
}

/** What the account's owner may see about it. No email address, hash, or internal field. */
export interface AccountView {
  readonly userId: UserId;
  readonly username: string;
  readonly status: AccountStatus;
  readonly emailVerified: boolean;
}

export interface SessionView {
  readonly sessionId: SessionId;
  readonly createdAt: number;
  readonly lastSeenAt: number;
  readonly current: boolean;
}

export type InputField =
  | "username"
  | "email"
  | "password"
  | "identifier"
  | "currentPassword"
  | "newPassword"
  | "token";

export type InvalidInput = {
  readonly kind: "invalid_input";
  readonly field: InputField;
  readonly reason: string;
};
export type RateLimited = { readonly kind: "rate_limited"; readonly retryAfterMs: number };
/** Password hashing is at capacity; retry shortly. */
export type Busy = { readonly kind: "busy" };
export type FeatureUnavailable = { readonly kind: "feature_unavailable" };

export type Outcome<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export interface SignedIn {
  readonly session: IssuedSession;
  readonly account: AccountView;
}

export type RegisterError =
  | InvalidInput
  | RateLimited
  | Busy
  | { readonly kind: "username_unavailable" }
  | { readonly kind: "email_unavailable" };

/** `invalid_credentials` is the one answer for an unknown account and for a wrong password. */
export type LoginError =
  | InvalidInput
  | RateLimited
  | Busy
  | { readonly kind: "invalid_credentials" }
  | { readonly kind: "account_unavailable" };

export type ChangePasswordError =
  | InvalidInput
  | RateLimited
  | Busy
  | { readonly kind: "invalid_credentials" };

export type ResetRequestError = InvalidInput | RateLimited | FeatureUnavailable;

export type ResetPasswordError =
  | InvalidInput
  | RateLimited
  | Busy
  | FeatureUnavailable
  | { readonly kind: "invalid_token" };

export type VerificationRequestError =
  | RateLimited
  | FeatureUnavailable
  | { readonly kind: "already_verified" };

export type VerificationError =
  | RateLimited
  | FeatureUnavailable
  | { readonly kind: "invalid_token" };

/**
 * What the realtime edge may ask about a session: prove a token, recheck a
 * session, and be told when it ends. Nothing here grants a game or a seat.
 */
export interface SessionAuthority {
  /** The session a token proves, or null. Throws only if the store cannot answer. */
  authenticate(token: string): Promise<AuthenticatedSession | null>;
  isSessionActive(session: AuthenticatedSession): Promise<boolean>;
  /** Calls `onEnd` once if this process ends the session; returns the unsubscribe. */
  watchSession(session: AuthenticatedSession, onEnd: () => void): () => void;
}

/** The public accounts API used by the HTTP transport. */
export interface AccountsApi extends SessionAuthority {
  register(
    input: { readonly username: string; readonly email: string; readonly password: string },
    request: AuthRequest,
  ): Promise<Outcome<SignedIn, RegisterError>>;
  login(
    input: { readonly identifier: string; readonly password: string },
    request: AuthRequest,
  ): Promise<Outcome<SignedIn, LoginError>>;
  /** Idempotent: an unknown, malformed, or already revoked token is not an error. */
  logout(token: string): Promise<void>;
  /** Revokes every session of the user, the current one included. */
  logoutAll(session: AuthenticatedSession): Promise<void>;
  account(session: AuthenticatedSession): Promise<AccountView | null>;
  listSessions(session: AuthenticatedSession): Promise<readonly SessionView[]>;
  /** Only the user's own sessions: another user's session id is `not_found`. */
  revokeSession(session: AuthenticatedSession, sessionId: string): Promise<"revoked" | "not_found">;
  /** Revokes every session, then signs the current device in again with a new one. */
  changePassword(
    session: AuthenticatedSession,
    input: { readonly currentPassword: string; readonly newPassword: string },
    request: AuthRequest,
  ): Promise<Outcome<SignedIn, ChangePasswordError>>;
  /** Always `accepted` for a well-formed address, whether or not an account has it. */
  requestPasswordReset(
    input: { readonly email: string },
    request: AuthRequest,
  ): Promise<Outcome<null, ResetRequestError>>;
  resetPassword(
    input: { readonly token: string; readonly newPassword: string },
    request: AuthRequest,
  ): Promise<Outcome<null, ResetPasswordError>>;
  requestEmailVerification(
    session: AuthenticatedSession,
  ): Promise<Outcome<null, VerificationRequestError>>;
  confirmEmailVerification(
    input: { readonly token: string },
    request: AuthRequest,
  ): Promise<Outcome<null, VerificationError>>;
}
