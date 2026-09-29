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
import type { AccountStatus, CanonicalEmail, LoginIdentifier, UserId } from "@chess-one/identity";
import { type Kysely, sql, type Transaction } from "kysely";
import {
  accountProfile,
  canonicalIdentity,
  epochMs,
  flag,
  millis,
  sessionIdOf,
  statusOf,
  storedSession,
  userIdOf,
} from "./rows.ts";
import type { AccountsDatabase } from "./schema.ts";
import { MalformedRow, storeError, uniqueViolation } from "./store-error.ts";
import { toTimestamp } from "./wall-time.ts";

/** The compare-and-set on the password hash found another hash. */
class StalePassword extends Error {}

const USERNAME_KEY = "users_username_canonical_key";
const EMAIL_KEY = "users_email_canonical_key";

function sessionRow(session: NewSession) {
  return {
    session_id: session.sessionId,
    user_id: session.userId,
    token_hash: session.tokenHash,
    created_at: toTimestamp(session.createdAt),
    last_seen_at: toTimestamp(session.createdAt),
    absolute_expires_at: toTimestamp(session.absoluteExpiresAt),
  };
}

async function revokeAll(
  trx: Transaction<AccountsDatabase>,
  userId: UserId,
  at: number,
  reason: RevocationReason,
): Promise<readonly SessionId[]> {
  const rows = await trx
    .updateTable("user_sessions")
    .set({ revoked_at: toTimestamp(at), revocation_reason: reason })
    .where("user_id", "=", userId)
    .where("revoked_at", "is", null)
    .returning("session_id")
    .execute();
  return rows.map((row) => sessionIdOf(row.session_id));
}

/** Takes the user row lock that serializes session creation and revocation for one user. */
async function lockUser(trx: Transaction<AccountsDatabase>, userId: UserId): Promise<boolean> {
  const row = await trx
    .selectFrom("users")
    .select("user_id")
    .where("user_id", "=", userId)
    .forUpdate()
    .executeTakeFirst();
  return row !== undefined;
}

/**
 * Inserts a session under the user row lock. If the user already has
 * `maxSessions` counting sessions, the least recently seen are revoked
 * (`session_limit`) first; their ids are returned.
 */
async function insertSession(
  trx: Transaction<AccountsDatabase>,
  session: NewSession,
  bounds: SessionWindow,
): Promise<readonly SessionId[]> {
  if (!(await lockUser(trx, session.userId))) throw new MalformedRow("session owner");
  const counting = await trx
    .selectFrom("user_sessions")
    .select("session_id")
    .where("user_id", "=", session.userId)
    .where("revoked_at", "is", null)
    .where("absolute_expires_at", ">", toTimestamp(bounds.now))
    .where("last_seen_at", ">", toTimestamp(bounds.idleCutoff))
    .orderBy("last_seen_at")
    .orderBy("session_id")
    .execute();
  const excess = counting.length - bounds.maxSessions + 1;
  const evicted = counting.slice(0, Math.max(0, excess)).map((row) => sessionIdOf(row.session_id));
  if (evicted.length > 0) {
    await trx
      .updateTable("user_sessions")
      .set({ revoked_at: toTimestamp(bounds.now), revocation_reason: "session_limit" })
      .where("session_id", "in", evicted)
      .where("revoked_at", "is", null)
      .execute();
  }
  await trx.insertInto("user_sessions").values(sessionRow(session)).execute();
  return evicted;
}

/**
 * Marks a live action token consumed, only if its account is active and still
 * has the address the token was sent to. The conditional UPDATE is the single
 * use: of concurrent attempts, one row update wins and the rest match nothing.
 */
async function consumeToken(
  trx: Transaction<AccountsDatabase>,
  tokenHash: Uint8Array,
  purpose: ActionTokenPurpose,
  now: number,
): Promise<UserId | null> {
  const at = toTimestamp(now);
  const row = await trx
    .updateTable("account_action_tokens")
    .set({ consumed_at: at })
    .where("token_hash", "=", tokenHash)
    .where("purpose", "=", purpose)
    .where("consumed_at", "is", null)
    .where("expires_at", ">", at)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom("users")
          .select("users.user_id")
          .whereRef("users.user_id", "=", "account_action_tokens.user_id")
          .whereRef("users.email_canonical", "=", "account_action_tokens.email_canonical")
          .where("users.status", "=", "active"),
      ),
    )
    .returning("user_id")
    .executeTakeFirst();
  if (row === undefined) return null;
  const userId = userIdOf(row.user_id);
  await trx
    .deleteFrom("account_action_tokens")
    .where("user_id", "=", userId)
    .where("purpose", "=", purpose)
    .where("consumed_at", "is", null)
    .execute();
  return userId;
}

/**
 * `AccountsRepository` on PostgreSQL through Kysely. Every statement uses
 * bound parameters; every multi-row change is one transaction; uniqueness is
 * decided by the constraints and a violation maps to a typed result by the
 * constraint name.
 */
export class PostgresAccountsRepository implements AccountsRepository {
  readonly #db: Kysely<AccountsDatabase>;

  constructor(db: Kysely<AccountsDatabase>) {
    this.#db = db;
  }

  async #guard<T>(operation: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error: unknown) {
      throw storeError(operation, error);
    }
  }

  #profileQuery() {
    return this.#db
      .selectFrom("users")
      .select([
        "user_id",
        "username",
        "username_canonical",
        "email",
        "email_canonical",
        "status",
        sql<boolean>`email_verified_at is not null`.as("email_verified"),
      ]);
  }

  #sessionQuery() {
    return this.#db
      .selectFrom("user_sessions")
      .innerJoin("users", "users.user_id", "user_sessions.user_id")
      .select([
        "user_sessions.session_id",
        "user_sessions.user_id",
        epochMs("user_sessions.created_at").as("created_ms"),
        epochMs("user_sessions.last_seen_at").as("last_seen_ms"),
        epochMs("user_sessions.absolute_expires_at").as("expires_ms"),
        sql<boolean>`user_sessions.revoked_at is not null`.as("revoked"),
        "users.status",
      ]);
  }

  createAccount(
    account: NewAccount,
    session: NewSession,
    bounds: SessionWindow,
  ): Promise<CreateAccountResult> {
    return this.#guard("create_account", async () => {
      try {
        await this.#db.transaction().execute(async (trx) => {
          await trx
            .insertInto("users")
            .values({
              user_id: account.userId,
              username: account.username,
              username_canonical: account.usernameCanonical,
              email: account.email,
              email_canonical: account.emailCanonical,
            })
            .execute();
          await trx
            .insertInto("user_credentials")
            .values({
              user_id: account.userId,
              password_scheme: "argon2id",
              password_hash: account.passwordHash,
            })
            .execute();
          await insertSession(trx, session, bounds);
        });
        return { kind: "created" };
      } catch (error: unknown) {
        const constraint = uniqueViolation(error);
        if (constraint === USERNAME_KEY) return { kind: "username_taken" };
        if (constraint === EMAIL_KEY) return { kind: "email_taken" };
        throw error;
      }
    });
  }

  findLoginAccount(
    identifier: Exclude<LoginIdentifier, { readonly kind: "unknown" }>,
  ): Promise<LoginAccount | null> {
    return this.#guard("find_login_account", async () => {
      const query = this.#db
        .selectFrom("users")
        .leftJoin("user_credentials", "user_credentials.user_id", "users.user_id")
        .select([
          "users.user_id",
          "users.username",
          "users.status",
          sql<boolean>`users.email_verified_at is not null`.as("email_verified"),
          "user_credentials.password_hash",
        ]);
      const row = await (identifier.kind === "email"
        ? query.where("users.email_canonical", "=", identifier.canonical)
        : query.where("users.username_canonical", "=", identifier.canonical)
      ).executeTakeFirst();
      if (row === undefined) return null;
      return {
        userId: userIdOf(row.user_id),
        username: row.username,
        status: statusOf(row.status),
        emailVerified: flag(row.email_verified, "email_verified"),
        passwordHash: row.password_hash,
      };
    });
  }

  replacePasswordHash(userId: UserId, expected: string, next: string): Promise<boolean> {
    return this.#guard("replace_password_hash", async () => {
      const result = await this.#db
        .updateTable("user_credentials")
        .set({ password_hash: next, updated_at: sql<string>`now()` })
        .where("user_id", "=", userId)
        .where("password_hash", "=", expected)
        .executeTakeFirst();
      return result.numUpdatedRows === 1n;
    });
  }

  createSession(
    session: NewSession,
    bounds: SessionWindow,
    passwordHash: string,
  ): Promise<CreateSessionResult> {
    return this.#guard("create_session", () =>
      this.#db.transaction().execute(async (trx): Promise<CreateSessionResult> => {
        if (!(await lockUser(trx, session.userId))) return { kind: "stale" };
        const credential = await trx
          .selectFrom("user_credentials")
          .select("password_hash")
          .where("user_id", "=", session.userId)
          .executeTakeFirst();
        if (credential?.password_hash !== passwordHash) return { kind: "stale" };
        return { kind: "created", evicted: await insertSession(trx, session, bounds) };
      }),
    );
  }

  findSessionByTokenHash(tokenHash: Uint8Array): Promise<StoredSession | null> {
    return this.#guard("find_session", async () =>
      storedSession(
        await this.#sessionQuery()
          .where("user_sessions.token_hash", "=", tokenHash)
          .executeTakeFirst(),
      ),
    );
  }

  findSession(sessionId: SessionId): Promise<StoredSession | null> {
    return this.#guard("find_session", async () =>
      storedSession(
        await this.#sessionQuery()
          .where("user_sessions.session_id", "=", sessionId)
          .executeTakeFirst(),
      ),
    );
  }

  touchSession(sessionId: SessionId, at: number): Promise<void> {
    return this.#guard("touch_session", async () => {
      const time = toTimestamp(at);
      await this.#db
        .updateTable("user_sessions")
        .set({ last_seen_at: time })
        .where("session_id", "=", sessionId)
        .where("revoked_at", "is", null)
        .where("last_seen_at", "<", time)
        .execute();
    });
  }

  revokeSessionByTokenHash(
    tokenHash: Uint8Array,
    at: number,
    reason: RevocationReason,
  ): Promise<{ readonly sessionId: SessionId; readonly userId: UserId } | null> {
    return this.#guard("revoke_session", async () => {
      const row = await this.#db
        .updateTable("user_sessions")
        .set({ revoked_at: toTimestamp(at), revocation_reason: reason })
        .where("token_hash", "=", tokenHash)
        .where("revoked_at", "is", null)
        .returning(["session_id", "user_id"])
        .executeTakeFirst();
      if (row === undefined) return null;
      return { sessionId: sessionIdOf(row.session_id), userId: userIdOf(row.user_id) };
    });
  }

  revokeUserSession(
    userId: UserId,
    sessionId: SessionId,
    at: number,
    reason: RevocationReason,
  ): Promise<boolean> {
    return this.#guard("revoke_session", async () => {
      const result = await this.#db
        .updateTable("user_sessions")
        .set({ revoked_at: toTimestamp(at), revocation_reason: reason })
        .where("session_id", "=", sessionId)
        .where("user_id", "=", userId)
        .where("revoked_at", "is", null)
        .executeTakeFirst();
      return result.numUpdatedRows === 1n;
    });
  }

  revokeAllUserSessions(
    userId: UserId,
    at: number,
    reason: RevocationReason,
  ): Promise<readonly SessionId[]> {
    return this.#guard("revoke_all_sessions", () =>
      this.#db.transaction().execute(async (trx) => {
        await lockUser(trx, userId);
        return revokeAll(trx, userId, at, reason);
      }),
    );
  }

  listSessions(userId: UserId, bounds: SessionWindow): Promise<readonly SessionSummary[]> {
    return this.#guard("list_sessions", async () => {
      const rows = await this.#db
        .selectFrom("user_sessions")
        .select([
          "session_id",
          epochMs("created_at").as("created_ms"),
          epochMs("last_seen_at").as("last_seen_ms"),
        ])
        .where("user_id", "=", userId)
        .where("revoked_at", "is", null)
        .where("absolute_expires_at", ">", toTimestamp(bounds.now))
        .where("last_seen_at", ">", toTimestamp(bounds.idleCutoff))
        .orderBy("last_seen_at", "desc")
        .orderBy("session_id")
        .limit(bounds.maxSessions)
        .execute();
      return rows.map((row) => ({
        sessionId: sessionIdOf(row.session_id),
        createdAt: millis(row.created_ms, "created_at"),
        lastSeenAt: millis(row.last_seen_ms, "last_seen_at"),
      }));
    });
  }

  getProfile(userId: UserId): Promise<AccountProfile | null> {
    return this.#guard("get_profile", async () =>
      accountProfile(await this.#profileQuery().where("user_id", "=", userId).executeTakeFirst()),
    );
  }

  getPasswordHash(userId: UserId): Promise<string | null> {
    return this.#guard("get_password_hash", async () => {
      const row = await this.#db
        .selectFrom("user_credentials")
        .select("password_hash")
        .where("user_id", "=", userId)
        .executeTakeFirst();
      return row === undefined ? null : row.password_hash;
    });
  }

  changePassword(
    userId: UserId,
    expected: string,
    next: string,
    session: NewSession,
  ): Promise<ChangePasswordResult> {
    return this.#guard("change_password", async () => {
      try {
        const revoked = await this.#db.transaction().execute(async (trx) => {
          if (!(await lockUser(trx, userId))) throw new StalePassword();
          const updated = await trx
            .updateTable("user_credentials")
            .set({ password_hash: next, updated_at: sql<string>`now()` })
            .where("user_id", "=", userId)
            .where("password_hash", "=", expected)
            .executeTakeFirst();
          if (updated.numUpdatedRows !== 1n) throw new StalePassword();
          const ended = await revokeAll(trx, userId, session.createdAt, "password_changed");
          await trx.insertInto("user_sessions").values(sessionRow(session)).execute();
          return ended;
        });
        return { kind: "changed", revoked };
      } catch (error: unknown) {
        if (error instanceof StalePassword) return { kind: "stale" };
        throw error;
      }
    });
  }

  setAccountStatus(
    userId: UserId,
    status: AccountStatus,
    at: number,
  ): Promise<readonly SessionId[] | null> {
    return this.#guard("set_account_status", () =>
      this.#db.transaction().execute(async (trx) => {
        const updated = await trx
          .updateTable("users")
          .set({ status, updated_at: sql<string>`now()` })
          .where("user_id", "=", userId)
          .returning("user_id")
          .executeTakeFirst();
        if (updated === undefined) return null;
        return status === "active" ? [] : revokeAll(trx, userId, at, "account_disabled");
      }),
    );
  }

  findActiveAccountByEmail(email: CanonicalEmail): Promise<AccountProfile | null> {
    return this.#guard("find_account_by_email", async () =>
      accountProfile(
        await this.#profileQuery()
          .where("email_canonical", "=", email)
          .where("status", "=", "active")
          .executeTakeFirst(),
      ),
    );
  }

  issueActionToken(token: NewActionToken): Promise<void> {
    return this.#guard("issue_action_token", () =>
      this.#db.transaction().execute(async (trx) => {
        await trx
          .deleteFrom("account_action_tokens")
          .where("user_id", "=", token.userId)
          .where("purpose", "=", token.purpose)
          .where("consumed_at", "is", null)
          .execute();
        await trx
          .insertInto("account_action_tokens")
          .values({
            token_hash: token.tokenHash,
            user_id: token.userId,
            purpose: token.purpose,
            email_canonical: token.emailCanonical,
            created_at: toTimestamp(token.createdAt),
            expires_at: toTimestamp(token.expiresAt),
          })
          .execute();
      }),
    );
  }

  findActionToken(
    tokenHash: Uint8Array,
    purpose: ActionTokenPurpose,
    now: number,
  ): Promise<PendingActionToken | null> {
    return this.#guard("find_action_token", async () => {
      const row = await this.#db
        .selectFrom("account_action_tokens")
        .innerJoin("users", "users.user_id", "account_action_tokens.user_id")
        .select(["users.user_id", "users.username_canonical", "users.email_canonical"])
        .where("account_action_tokens.token_hash", "=", tokenHash)
        .where("account_action_tokens.purpose", "=", purpose)
        .where("account_action_tokens.consumed_at", "is", null)
        .where("account_action_tokens.expires_at", ">", toTimestamp(now))
        .whereRef("users.email_canonical", "=", "account_action_tokens.email_canonical")
        .where("users.status", "=", "active")
        .executeTakeFirst();
      if (row === undefined) return null;
      return { userId: userIdOf(row.user_id), ...canonicalIdentity(row) };
    });
  }

  consumePasswordReset(
    tokenHash: Uint8Array,
    now: number,
    passwordHash: string,
  ): Promise<ConsumeResetResult> {
    return this.#guard("consume_password_reset", () =>
      this.#db.transaction().execute(async (trx): Promise<ConsumeResetResult> => {
        const userId = await consumeToken(trx, tokenHash, "password_reset", now);
        if (userId === null) return { kind: "invalid" };
        await lockUser(trx, userId);
        await trx
          .insertInto("user_credentials")
          .values({ user_id: userId, password_scheme: "argon2id", password_hash: passwordHash })
          .onConflict((conflict) =>
            conflict.column("user_id").doUpdateSet({
              password_scheme: "argon2id",
              password_hash: passwordHash,
              updated_at: sql<string>`now()`,
            }),
          )
          .execute();
        const revoked = await revokeAll(trx, userId, now, "password_reset");
        return { kind: "reset", userId, revoked };
      }),
    );
  }

  consumeEmailVerification(tokenHash: Uint8Array, now: number): Promise<ConsumeVerificationResult> {
    return this.#guard("consume_email_verification", () =>
      this.#db.transaction().execute(async (trx): Promise<ConsumeVerificationResult> => {
        const userId = await consumeToken(trx, tokenHash, "email_verification", now);
        if (userId === null) return { kind: "invalid" };
        await trx
          .updateTable("users")
          .set({ email_verified_at: toTimestamp(now), updated_at: sql<string>`now()` })
          .where("user_id", "=", userId)
          .where("email_verified_at", "is", null)
          .execute();
        return { kind: "verified", userId };
      }),
    );
  }

  deleteSessionsEndedBefore(cutoff: number): Promise<number> {
    return this.#guard("delete_ended_sessions", async () => {
      const time = toTimestamp(cutoff);
      const result = await this.#db
        .deleteFrom("user_sessions")
        .where((eb) => eb.or([eb("revoked_at", "<", time), eb("absolute_expires_at", "<", time)]))
        .executeTakeFirst();
      return Number(result.numDeletedRows);
    });
  }

  deleteActionTokensExpiredBefore(cutoff: number): Promise<number> {
    return this.#guard("delete_expired_tokens", async () => {
      const result = await this.#db
        .deleteFrom("account_action_tokens")
        .where("expires_at", "<", toTimestamp(cutoff))
        .executeTakeFirst();
      return Number(result.numDeletedRows);
    });
  }
}
