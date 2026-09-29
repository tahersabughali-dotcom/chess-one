import type {
  AccountProfile,
  AccountsRepository,
  ActionTokenPurpose,
  ChangePasswordResult,
  ConsumeResetResult,
  ConsumeVerificationResult,
  CreateAccountResult,
  CreateSessionResult,
  LoginAccount,
  NewAccount,
  NewActionToken,
  NewSession,
  PendingActionToken,
  RevocationReason,
  SessionId,
  SessionSummary,
  SessionWindow,
  StoredSession,
} from "@chess-one/accounts";
import type {
  AccountStatus,
  CanonicalEmail,
  CanonicalUsername,
  LoginIdentifier,
  UserId,
} from "@chess-one/identity";

interface UserRow {
  readonly userId: UserId;
  readonly username: string;
  readonly usernameCanonical: CanonicalUsername;
  readonly email: string;
  readonly emailCanonical: CanonicalEmail;
  status: AccountStatus;
  emailVerifiedAt: number | null;
}

export interface SessionRow {
  readonly sessionId: SessionId;
  readonly userId: UserId;
  /** Hex of the stored digest; the token itself is never given to the store. */
  readonly tokenHash: string;
  readonly createdAt: number;
  lastSeenAt: number;
  readonly absoluteExpiresAt: number;
  revokedAt: number | null;
  reason: RevocationReason | null;
}

export interface TokenRow {
  readonly tokenHash: string;
  readonly userId: UserId;
  readonly purpose: ActionTokenPurpose;
  readonly emailCanonical: CanonicalEmail;
  readonly createdAt: number;
  readonly expiresAt: number;
  consumedAt: number | null;
}

export const INJECTED_STORE_FAILURE =
  'injected store failure: relation "user_sessions" SQLSTATE 08006 at repository.ts:42';

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

/**
 * TEST ADAPTER: `AccountsRepository` in memory, with the PostgreSQL adapter's
 * semantics (canonical uniqueness, compare-and-set, single-use tokens, the
 * per-user cap). Each method runs to completion synchronously after its
 * first await, so it is atomic like one transaction. `failing` makes every
 * call throw, as an unreachable store would.
 */
export class MemoryAccountsRepository implements AccountsRepository {
  readonly users = new Map<UserId, UserRow>();
  readonly credentials = new Map<UserId, string>();
  readonly sessions = new Map<SessionId, SessionRow>();
  readonly tokens = new Map<string, TokenRow>();
  failing = false;
  touches = 0;
  /** Runs once, just before the next login session insert: a concurrent change lands here. */
  beforeCreateSession: (() => Promise<void>) | null = null;

  async #ready(): Promise<void> {
    await Promise.resolve();
    if (this.failing) throw new Error(INJECTED_STORE_FAILURE);
  }

  #counting(userId: UserId, bounds: SessionWindow): SessionRow[] {
    return [...this.sessions.values()]
      .filter(
        (row) =>
          row.userId === userId &&
          row.revokedAt === null &&
          row.absoluteExpiresAt > bounds.now &&
          row.lastSeenAt > bounds.idleCutoff,
      )
      .sort((a, b) => a.lastSeenAt - b.lastSeenAt || a.sessionId.localeCompare(b.sessionId));
  }

  #insertSession(session: NewSession, bounds: SessionWindow): SessionId[] {
    const counting = this.#counting(session.userId, bounds);
    const evicted = counting.slice(0, Math.max(0, counting.length - bounds.maxSessions + 1));
    for (const row of evicted) {
      row.revokedAt = bounds.now;
      row.reason = "session_limit";
    }
    this.#addSession(session);
    return evicted.map((row) => row.sessionId);
  }

  #addSession(session: NewSession): void {
    const tokenHash = hex(session.tokenHash);
    if ([...this.sessions.values()].some((row) => row.tokenHash === tokenHash)) {
      throw new Error("duplicate token hash");
    }
    this.sessions.set(session.sessionId, {
      sessionId: session.sessionId,
      userId: session.userId,
      tokenHash,
      createdAt: session.createdAt,
      lastSeenAt: session.createdAt,
      absoluteExpiresAt: session.absoluteExpiresAt,
      revokedAt: null,
      reason: null,
    });
  }

  #revokeAll(userId: UserId, at: number, reason: RevocationReason): SessionId[] {
    const ended: SessionId[] = [];
    for (const row of this.sessions.values()) {
      if (row.userId !== userId || row.revokedAt !== null) continue;
      row.revokedAt = at;
      row.reason = reason;
      ended.push(row.sessionId);
    }
    return ended;
  }

  #stored(row: SessionRow | undefined): StoredSession | null {
    if (row === undefined) return null;
    const user = this.users.get(row.userId);
    if (user === undefined) return null;
    return {
      sessionId: row.sessionId,
      userId: row.userId,
      createdAt: row.createdAt,
      lastSeenAt: row.lastSeenAt,
      absoluteExpiresAt: row.absoluteExpiresAt,
      revoked: row.revokedAt !== null,
      userStatus: user.status,
    };
  }

  #profile(user: UserRow | undefined): AccountProfile | null {
    if (user === undefined) return null;
    return {
      userId: user.userId,
      username: user.username,
      usernameCanonical: user.usernameCanonical,
      email: user.email,
      emailCanonical: user.emailCanonical,
      status: user.status,
      emailVerified: user.emailVerifiedAt !== null,
    };
  }

  /** The live token row, if its account is active and still has the address. */
  #liveToken(tokenHash: Uint8Array, purpose: ActionTokenPurpose, now: number): TokenRow | null {
    const row = this.tokens.get(hex(tokenHash));
    if (row === undefined || row.purpose !== purpose || row.consumedAt !== null) return null;
    if (row.expiresAt <= now) return null;
    const user = this.users.get(row.userId);
    if (user === undefined || user.status !== "active") return null;
    return user.emailCanonical === row.emailCanonical ? row : null;
  }

  #consume(row: TokenRow, now: number): void {
    row.consumedAt = now;
    for (const [key, other] of this.tokens) {
      if (
        other.userId === row.userId &&
        other.purpose === row.purpose &&
        other.consumedAt === null
      ) {
        this.tokens.delete(key);
      }
    }
  }

  async createAccount(
    account: NewAccount,
    session: NewSession,
    bounds: SessionWindow,
  ): Promise<CreateAccountResult> {
    await this.#ready();
    const users = [...this.users.values()];
    if (users.some((user) => user.usernameCanonical === account.usernameCanonical)) {
      return { kind: "username_taken" };
    }
    if (users.some((user) => user.emailCanonical === account.emailCanonical)) {
      return { kind: "email_taken" };
    }
    this.users.set(account.userId, {
      userId: account.userId,
      username: account.username,
      usernameCanonical: account.usernameCanonical,
      email: account.email,
      emailCanonical: account.emailCanonical,
      status: "active",
      emailVerifiedAt: null,
    });
    this.credentials.set(account.userId, account.passwordHash);
    this.#insertSession(session, bounds);
    return { kind: "created" };
  }

  async findLoginAccount(
    identifier: Exclude<LoginIdentifier, { readonly kind: "unknown" }>,
  ): Promise<LoginAccount | null> {
    await this.#ready();
    const user = [...this.users.values()].find((row) =>
      identifier.kind === "email"
        ? row.emailCanonical === identifier.canonical
        : row.usernameCanonical === identifier.canonical,
    );
    if (user === undefined) return null;
    return {
      userId: user.userId,
      username: user.username,
      status: user.status,
      emailVerified: user.emailVerifiedAt !== null,
      passwordHash: this.credentials.get(user.userId) ?? null,
    };
  }

  async replacePasswordHash(userId: UserId, expected: string, next: string): Promise<boolean> {
    await this.#ready();
    if (this.credentials.get(userId) !== expected) return false;
    this.credentials.set(userId, next);
    return true;
  }

  async createSession(
    session: NewSession,
    bounds: SessionWindow,
    passwordHash: string,
  ): Promise<CreateSessionResult> {
    const hook = this.beforeCreateSession;
    this.beforeCreateSession = null;
    if (hook !== null) await hook();
    await this.#ready();
    if (!this.users.has(session.userId)) return { kind: "stale" };
    if (this.credentials.get(session.userId) !== passwordHash) return { kind: "stale" };
    return { kind: "created", evicted: this.#insertSession(session, bounds) };
  }

  async findSessionByTokenHash(tokenHash: Uint8Array): Promise<StoredSession | null> {
    await this.#ready();
    const key = hex(tokenHash);
    return this.#stored([...this.sessions.values()].find((row) => row.tokenHash === key));
  }

  async findSession(sessionId: SessionId): Promise<StoredSession | null> {
    await this.#ready();
    return this.#stored(this.sessions.get(sessionId));
  }

  async touchSession(sessionId: SessionId, at: number): Promise<void> {
    await this.#ready();
    const row = this.sessions.get(sessionId);
    if (row === undefined || row.revokedAt !== null || row.lastSeenAt >= at) return;
    row.lastSeenAt = at;
    this.touches += 1;
  }

  async revokeSessionByTokenHash(
    tokenHash: Uint8Array,
    at: number,
    reason: RevocationReason,
  ): Promise<{ readonly sessionId: SessionId; readonly userId: UserId } | null> {
    await this.#ready();
    const key = hex(tokenHash);
    const row = [...this.sessions.values()].find(
      (candidate) => candidate.tokenHash === key && candidate.revokedAt === null,
    );
    if (row === undefined) return null;
    row.revokedAt = at;
    row.reason = reason;
    return { sessionId: row.sessionId, userId: row.userId };
  }

  async revokeUserSession(
    userId: UserId,
    sessionId: SessionId,
    at: number,
    reason: RevocationReason,
  ): Promise<boolean> {
    await this.#ready();
    const row = this.sessions.get(sessionId);
    if (row === undefined || row.userId !== userId || row.revokedAt !== null) return false;
    row.revokedAt = at;
    row.reason = reason;
    return true;
  }

  async revokeAllUserSessions(
    userId: UserId,
    at: number,
    reason: RevocationReason,
  ): Promise<readonly SessionId[]> {
    await this.#ready();
    return this.#revokeAll(userId, at, reason);
  }

  async listSessions(userId: UserId, bounds: SessionWindow): Promise<readonly SessionSummary[]> {
    await this.#ready();
    return this.#counting(userId, bounds)
      .reverse()
      .slice(0, bounds.maxSessions)
      .map((row) => ({
        sessionId: row.sessionId,
        createdAt: row.createdAt,
        lastSeenAt: row.lastSeenAt,
      }));
  }

  async getProfile(userId: UserId): Promise<AccountProfile | null> {
    await this.#ready();
    return this.#profile(this.users.get(userId));
  }

  async getPasswordHash(userId: UserId): Promise<string | null> {
    await this.#ready();
    return this.credentials.get(userId) ?? null;
  }

  async changePassword(
    userId: UserId,
    expected: string,
    next: string,
    session: NewSession,
  ): Promise<ChangePasswordResult> {
    await this.#ready();
    if (this.credentials.get(userId) !== expected) return { kind: "stale" };
    this.credentials.set(userId, next);
    const revoked = this.#revokeAll(userId, session.createdAt, "password_changed");
    this.#addSession(session);
    return { kind: "changed", revoked };
  }

  async setAccountStatus(
    userId: UserId,
    status: AccountStatus,
    at: number,
  ): Promise<readonly SessionId[] | null> {
    await this.#ready();
    const user = this.users.get(userId);
    if (user === undefined) return null;
    user.status = status;
    return status === "active" ? [] : this.#revokeAll(userId, at, "account_disabled");
  }

  async findActiveAccountByEmail(email: CanonicalEmail): Promise<AccountProfile | null> {
    await this.#ready();
    return this.#profile(
      [...this.users.values()].find(
        (row) => row.emailCanonical === email && row.status === "active",
      ),
    );
  }

  async issueActionToken(token: NewActionToken): Promise<void> {
    await this.#ready();
    for (const [key, row] of this.tokens) {
      if (row.userId === token.userId && row.purpose === token.purpose && row.consumedAt === null) {
        this.tokens.delete(key);
      }
    }
    const tokenHash = hex(token.tokenHash);
    this.tokens.set(tokenHash, {
      tokenHash,
      userId: token.userId,
      purpose: token.purpose,
      emailCanonical: token.emailCanonical,
      createdAt: token.createdAt,
      expiresAt: token.expiresAt,
      consumedAt: null,
    });
  }

  async findActionToken(
    tokenHash: Uint8Array,
    purpose: ActionTokenPurpose,
    now: number,
  ): Promise<PendingActionToken | null> {
    await this.#ready();
    const row = this.#liveToken(tokenHash, purpose, now);
    const user = row === null ? undefined : this.users.get(row.userId);
    if (user === undefined) return null;
    return {
      userId: user.userId,
      usernameCanonical: user.usernameCanonical,
      emailCanonical: user.emailCanonical,
    };
  }

  async consumePasswordReset(
    tokenHash: Uint8Array,
    now: number,
    passwordHash: string,
  ): Promise<ConsumeResetResult> {
    await this.#ready();
    const row = this.#liveToken(tokenHash, "password_reset", now);
    if (row === null) return { kind: "invalid" };
    this.#consume(row, now);
    this.credentials.set(row.userId, passwordHash);
    const revoked = this.#revokeAll(row.userId, now, "password_reset");
    return { kind: "reset", userId: row.userId, revoked };
  }

  async consumeEmailVerification(
    tokenHash: Uint8Array,
    now: number,
  ): Promise<ConsumeVerificationResult> {
    await this.#ready();
    const row = this.#liveToken(tokenHash, "email_verification", now);
    if (row === null) return { kind: "invalid" };
    this.#consume(row, now);
    const user = this.users.get(row.userId);
    if (user !== undefined && user.emailVerifiedAt === null) user.emailVerifiedAt = now;
    return { kind: "verified", userId: row.userId };
  }

  async deleteSessionsEndedBefore(cutoff: number): Promise<number> {
    await this.#ready();
    let deleted = 0;
    for (const [key, row] of this.sessions) {
      if ((row.revokedAt !== null && row.revokedAt < cutoff) || row.absoluteExpiresAt < cutoff) {
        this.sessions.delete(key);
        deleted += 1;
      }
    }
    return deleted;
  }

  async deleteActionTokensExpiredBefore(cutoff: number): Promise<number> {
    await this.#ready();
    let deleted = 0;
    for (const [key, row] of this.tokens) {
      if (row.expiresAt < cutoff) {
        this.tokens.delete(key);
        deleted += 1;
      }
    }
    return deleted;
  }
}
