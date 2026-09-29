import { canAuthenticate, type UserId } from "@chess-one/identity";
import type { AccountView, AuthenticatedSession, IssuedSession, SessionView } from "./api.ts";
import type { AccountsContext } from "./config.ts";
import type { SessionRejection } from "./facts.ts";
import type { NewSession, RevocationReason, SessionWindow, StoredSession } from "./ports.ts";
import {
  isSecretToken,
  isSessionId,
  newSecretToken,
  newSessionId,
  type SessionId,
  tokenDigest,
} from "./tokens.ts";

export function sessionWindow(context: AccountsContext, now: number): SessionWindow {
  return {
    now,
    idleCutoff: now - context.sessions.idleTimeoutMs,
    maxSessions: context.sessions.maxSessionsPerUser,
  };
}

/** A fresh session for `userId`: a new CSPRNG token, never one the client offered. */
export function prepareSession(
  context: AccountsContext,
  userId: UserId,
  now: number,
): { readonly issued: IssuedSession; readonly record: NewSession } {
  const token = newSecretToken();
  const sessionId = newSessionId();
  const lifetime = context.sessions.absoluteLifetimeMs;
  return {
    issued: { token, sessionId, userId, maxAgeSeconds: Math.floor(lifetime / 1000) },
    record: {
      sessionId,
      userId,
      tokenHash: tokenDigest("session", token),
      createdAt: now,
      absoluteExpiresAt: now + lifetime,
    },
  };
}

/** Records each revocation and tells this process's watchers (open connections) at once. */
export function announceRevoked(
  context: AccountsContext,
  userId: UserId,
  sessionIds: readonly SessionId[],
  reason: RevocationReason,
): void {
  for (const sessionId of sessionIds) {
    context.facts.record({ name: "session_revoked", userId, sessionId, reason });
  }
  context.revocations.sessionsEnded(sessionIds);
}

function rejection(
  context: AccountsContext,
  stored: StoredSession | null,
  now: number,
): SessionRejection | "account" | null {
  if (stored === null) return "unknown";
  if (stored.revoked) return "revoked";
  if (now >= stored.absoluteExpiresAt) return "expired";
  if (now >= stored.lastSeenAt + context.sessions.idleTimeoutMs) return "idle";
  return canAuthenticate(stored.userStatus) ? null : "account";
}

/**
 * Accepts a stored session only while it is unrevoked, inside both expiry
 * windows, and its account is active; a disabled or locked account fails
 * every session at once. Activity is written only after `touchIntervalMs`.
 */
async function accept(
  context: AccountsContext,
  stored: StoredSession | null,
): Promise<AuthenticatedSession | null> {
  const now = context.clock.now();
  const refused = rejection(context, stored, now);
  if (stored === null || refused !== null) {
    if (refused === "account" && stored !== null) {
      context.facts.record({
        name: "account_disabled_auth_attempt",
        userId: stored.userId,
        status: stored.userStatus,
        via: "session",
      });
    } else if (refused !== null && refused !== "account") {
      context.facts.record({ name: "session_rejected", reason: refused });
    }
    return null;
  }
  if (now - stored.lastSeenAt >= context.sessions.touchIntervalMs) {
    await context.repository.touchSession(stored.sessionId, now);
  }
  return { sessionId: stored.sessionId, userId: stored.userId };
}

export async function authenticate(
  context: AccountsContext,
  token: string,
): Promise<AuthenticatedSession | null> {
  if (!isSecretToken(token)) {
    context.facts.record({ name: "session_rejected", reason: "unknown" });
    return null;
  }
  const stored = await context.repository.findSessionByTokenHash(tokenDigest("session", token));
  return accept(context, stored);
}

export async function isSessionActive(
  context: AccountsContext,
  session: AuthenticatedSession,
): Promise<boolean> {
  const accepted = await accept(context, await context.repository.findSession(session.sessionId));
  return accepted !== null && accepted.userId === session.userId;
}

export async function logout(context: AccountsContext, token: string): Promise<void> {
  if (!isSecretToken(token)) return;
  const now = context.clock.now();
  const revoked = await context.repository.revokeSessionByTokenHash(
    tokenDigest("session", token),
    now,
    "logout",
  );
  if (revoked !== null) announceRevoked(context, revoked.userId, [revoked.sessionId], "logout");
}

export async function logoutAll(
  context: AccountsContext,
  session: AuthenticatedSession,
): Promise<void> {
  const now = context.clock.now();
  const revoked = await context.repository.revokeAllUserSessions(session.userId, now, "logout_all");
  announceRevoked(context, session.userId, revoked, "logout_all");
}

export async function listSessions(
  context: AccountsContext,
  session: AuthenticatedSession,
): Promise<readonly SessionView[]> {
  const bounds = sessionWindow(context, context.clock.now());
  const sessions = await context.repository.listSessions(session.userId, bounds);
  return sessions.map((summary) => ({
    sessionId: summary.sessionId,
    createdAt: summary.createdAt,
    lastSeenAt: summary.lastSeenAt,
    current: summary.sessionId === session.sessionId,
  }));
}

export async function revokeSession(
  context: AccountsContext,
  session: AuthenticatedSession,
  sessionId: string,
): Promise<"revoked" | "not_found"> {
  if (!isSessionId(sessionId)) return "not_found";
  const now = context.clock.now();
  const revoked = await context.repository.revokeUserSession(
    session.userId,
    sessionId,
    now,
    "revoked_by_user",
  );
  if (!revoked) return "not_found";
  announceRevoked(context, session.userId, [sessionId], "revoked_by_user");
  return "revoked";
}

export async function accountView(
  context: AccountsContext,
  session: AuthenticatedSession,
): Promise<AccountView | null> {
  const profile = await context.repository.getProfile(session.userId);
  if (profile === null) return null;
  return {
    userId: profile.userId,
    username: profile.username,
    status: profile.status,
    emailVerified: profile.emailVerified,
  };
}
