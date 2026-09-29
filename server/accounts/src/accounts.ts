import type { AccountStatus, CanonicalUsername, UserId } from "@chess-one/identity";
import type {
  AccountDirectory,
  AccountStanding,
  AccountsApi,
  AccountView,
  AuthenticatedSession,
  AuthRequest,
  ChangePasswordError,
  LoginError,
  Outcome,
  PlayerDirectory,
  PlayerRecord,
  RegisterError,
  ResetPasswordError,
  ResetRequestError,
  SessionView,
  SignedIn,
  VerificationError,
  VerificationRequestError,
} from "./api.ts";
import { type AccountsConfig, type AccountsContext, resolveAccountsConfig } from "./config.ts";
import { changePassword, login, register } from "./credentials.ts";
import type { SessionEndListener } from "./extensions.ts";
import {
  confirmEmailVerification,
  requestEmailVerification,
  requestPasswordReset,
  resetPassword,
} from "./recovery.ts";
import {
  accountView,
  announceRevoked,
  authenticate,
  isSessionActive,
  listSessions,
  logout,
  logoutAll,
  revokeSession,
} from "./sessions.ts";

/**
 * The accounts application: registration, login, sessions, and recovery over
 * an `AccountsRepository`. It knows nothing of HTTP, cookies, or games.
 */
function playerRecord(account: {
  readonly userId: UserId;
  readonly username: string;
  readonly status: AccountStatus;
  readonly emailVerified: boolean;
}): PlayerRecord {
  return Object.freeze({
    userId: account.userId,
    username: account.username,
    status: account.status,
    emailVerified: account.emailVerified,
  });
}

export class Accounts implements AccountsApi, AccountDirectory, PlayerDirectory {
  readonly #context: AccountsContext;

  constructor(config: AccountsConfig) {
    this.#context = resolveAccountsConfig(config);
  }

  /** Open watchers of session revocation in this process (one per open connection). */
  get watcherCount(): number {
    return this.#context.revocations.size;
  }

  register(
    input: { readonly username: string; readonly email: string; readonly password: string },
    request: AuthRequest,
  ): Promise<Outcome<SignedIn, RegisterError>> {
    return register(this.#context, input, request);
  }

  login(
    input: { readonly identifier: string; readonly password: string },
    request: AuthRequest,
  ): Promise<Outcome<SignedIn, LoginError>> {
    return login(this.#context, input, request);
  }

  authenticate(token: string): Promise<AuthenticatedSession | null> {
    return authenticate(this.#context, token);
  }

  isSessionActive(session: AuthenticatedSession): Promise<boolean> {
    return isSessionActive(this.#context, session);
  }

  watchSession(session: AuthenticatedSession, onEnd: () => void): () => void {
    return this.#context.revocations.watch(session.sessionId, session.userId, onEnd);
  }

  logout(token: string): Promise<void> {
    return logout(this.#context, token);
  }

  logoutAll(session: AuthenticatedSession): Promise<void> {
    return logoutAll(this.#context, session);
  }

  account(session: AuthenticatedSession): Promise<AccountView | null> {
    return accountView(this.#context, session);
  }

  listSessions(session: AuthenticatedSession): Promise<readonly SessionView[]> {
    return listSessions(this.#context, session);
  }

  revokeSession(
    session: AuthenticatedSession,
    sessionId: string,
  ): Promise<"revoked" | "not_found"> {
    return revokeSession(this.#context, session, sessionId);
  }

  changePassword(
    session: AuthenticatedSession,
    input: { readonly currentPassword: string; readonly newPassword: string },
    request: AuthRequest,
  ): Promise<Outcome<SignedIn, ChangePasswordError>> {
    return changePassword(this.#context, session, input, request);
  }

  requestPasswordReset(
    input: { readonly email: string },
    request: AuthRequest,
  ): Promise<Outcome<null, ResetRequestError>> {
    return requestPasswordReset(this.#context, input, request);
  }

  resetPassword(
    input: { readonly token: string; readonly newPassword: string },
    request: AuthRequest,
  ): Promise<Outcome<null, ResetPasswordError>> {
    return resetPassword(this.#context, input, request);
  }

  requestEmailVerification(
    session: AuthenticatedSession,
  ): Promise<Outcome<null, VerificationRequestError>> {
    return requestEmailVerification(this.#context, session);
  }

  confirmEmailVerification(
    input: { readonly token: string },
    request: AuthRequest,
  ): Promise<Outcome<null, VerificationError>> {
    return confirmEmailVerification(this.#context, input, request);
  }

  /**
   * Operator use case, not exposed over HTTP. Any status but `active` also
   * revokes every session in the same transaction, so re-activating an
   * account never revives an old session; open connections are dropped.
   */
  async setAccountStatus(userId: UserId, status: AccountStatus): Promise<boolean> {
    const context = this.#context;
    const revoked = await context.repository.setAccountStatus(userId, status, context.clock.now());
    if (revoked === null) return false;
    context.facts.record({ name: "account_status_changed", userId, status });
    announceRevoked(context, userId, revoked, "account_disabled");
    if (status !== "active") context.revocations.userEnded(userId, status);
    return true;
  }

  /**
   * Standing of an account for trusted server use cases (game assignment):
   * its status and whether its email address is verified. Never exposed over
   * HTTP; null for an unknown user id.
   */
  async accountStanding(userId: UserId): Promise<AccountStanding | null> {
    const profile = await this.#context.repository.getProfile(userId);
    if (profile === null) return null;
    return Object.freeze({ status: profile.status, emailVerified: profile.emailVerified });
  }

  /** Exact lookup by canonical username for trusted use cases (direct challenges). */
  async findPlayerByUsername(username: CanonicalUsername): Promise<PlayerRecord | null> {
    const account = await this.#context.repository.findLoginAccount({
      kind: "username",
      canonical: username,
    });
    return account === null ? null : playerRecord(account);
  }

  async findPlayerById(userId: UserId): Promise<PlayerRecord | null> {
    const profile = await this.#context.repository.getProfile(userId);
    return profile === null ? null : playerRecord(profile);
  }

  onSessionsEnded(listener: SessionEndListener): () => void {
    return this.#context.revocations.listen(listener);
  }

  /**
   * Maintenance hook, run by a future scheduler: deletes sessions revoked or
   * absolutely expired, and action tokens expired, more than `retentionMs` ago.
   */
  async purgeEnded(
    retentionMs: number,
  ): Promise<{ readonly sessions: number; readonly tokens: number }> {
    const cutoff = this.#context.clock.now() - retentionMs;
    const sessions = await this.#context.repository.deleteSessionsEndedBefore(cutoff);
    const tokens = await this.#context.repository.deleteActionTokensExpiredBefore(cutoff);
    return { sessions, tokens };
  }
}
