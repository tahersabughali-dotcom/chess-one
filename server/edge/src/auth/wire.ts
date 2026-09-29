import type { AccountView, SessionView } from "@chess-one/accounts";

/**
 * Versioned auth response bodies. They carry no token, token digest, hash,
 * email address, or internal field; the session token travels only in the
 * HttpOnly cookie.
 */
export const AUTH_USER_FORMAT = "auth_user.v1";
export const AUTH_SESSIONS_FORMAT = "auth_sessions.v1";
export const AUTH_ERROR_FORMAT = "auth_error.v1";

export type AuthErrorCode =
  | "INVALID_REQUEST"
  | "VALIDATION_FAILED"
  | "INVALID_TOKEN"
  | "INVALID_CREDENTIALS"
  | "UNAUTHENTICATED"
  | "ACCOUNT_UNAVAILABLE"
  | "ORIGIN_NOT_ALLOWED"
  | "NOT_FOUND"
  | "USERNAME_UNAVAILABLE"
  | "EMAIL_UNAVAILABLE"
  | "ALREADY_VERIFIED"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "RATE_LIMITED"
  | "FEATURE_UNAVAILABLE"
  | "SERVICE_BUSY"
  | "SERVICE_UNAVAILABLE";

export interface AuthUserWire {
  readonly format: typeof AUTH_USER_FORMAT;
  readonly user: {
    readonly userId: string;
    readonly username: string;
    readonly status: string;
    readonly emailVerified: boolean;
  };
}

export interface AuthSessionsWire {
  readonly format: typeof AUTH_SESSIONS_FORMAT;
  readonly sessions: readonly {
    readonly sessionId: string;
    /** Epoch milliseconds. */
    readonly createdAt: number;
    readonly lastSeenAt: number;
    readonly current: boolean;
  }[];
}

export interface AuthErrorWire {
  readonly format: typeof AUTH_ERROR_FORMAT;
  readonly code: AuthErrorCode;
  /** VALIDATION_FAILED only: which input, and a policy code such as `too_short`. */
  readonly field?: string;
  readonly reason?: string;
  /** RATE_LIMITED only. */
  readonly retryAfterMs?: number;
}

export function encodeAuthUser(account: AccountView): AuthUserWire {
  return {
    format: AUTH_USER_FORMAT,
    user: {
      userId: account.userId,
      username: account.username,
      status: account.status,
      emailVerified: account.emailVerified,
    },
  };
}

export function encodeAuthSessions(sessions: readonly SessionView[]): AuthSessionsWire {
  return {
    format: AUTH_SESSIONS_FORMAT,
    sessions: sessions.map((session) => ({
      sessionId: session.sessionId,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      current: session.current,
    })),
  };
}

export function encodeAuthError(
  code: AuthErrorCode,
  detail: {
    readonly field?: string;
    readonly reason?: string;
    readonly retryAfterMs?: number;
  } = {},
): AuthErrorWire {
  return { format: AUTH_ERROR_FORMAT, code, ...detail };
}
