import {
  type CreateSessionResult,
  type NewSession,
  type SessionWindow,
  tokenDigest,
} from "@chess-one/accounts";
import {
  ACCOUNTS_MIGRATION_LOCK_TABLE,
  ACCOUNTS_MIGRATION_TABLE,
  type AccountsDatabase,
  AccountsStoreError,
  accountsMigrator,
  PostgresAccountsRepository,
} from "@chess-one/accounts-persistence";
import { type Kysely, sql } from "kysely";
import { NO_MIGRATIONS } from "kysely/migration";
import { describe, expect, it } from "vitest";
import { field } from "../realtime/support/client.ts";
import { ACCOUNTS_MIGRATIONS, type AccountsSchema, withAccountsSchema } from "./support/db.ts";
import {
  type AccountsHarness,
  type AccountsHarnessOptions,
  accountsHarness,
  CLIENT,
  DAY,
  MINUTE,
  OTHER_PASSWORD,
  PASSWORD,
  registered,
  signedIn,
} from "./support/harness.ts";

const APP = "chess-one-accounts-db-test";
const MIGRATION_NAMES = [
  "001_users",
  "002_user_credentials",
  "003_user_sessions",
  "004_account_action_tokens",
];
const TABLES = ["account_action_tokens", "user_credentials", "user_sessions", "users"];

/** The real adapter, with a hook that lets a concurrent change commit just before a login's session insert. */
class RacingRepository extends PostgresAccountsRepository {
  beforeCreateSession: (() => Promise<void>) | null = null;

  override async createSession(
    session: NewSession,
    bounds: SessionWindow,
    passwordHash: string,
  ): Promise<CreateSessionResult> {
    const hook = this.beforeCreateSession;
    this.beforeCreateSession = null;
    if (hook !== null) await hook();
    return super.createSession(session, bounds, passwordHash);
  }
}

function withPostgres(
  options: Omit<AccountsHarnessOptions, "repository">,
  run: (h: AccountsHarness, db: Kysely<AccountsDatabase>, schema: AccountsSchema) => Promise<void>,
): Promise<void> {
  return withAccountsSchema(APP, {}, async (schema) => {
    const db = schema.accounts();
    const h = accountsHarness({ ...options, repository: new PostgresAccountsRepository(db) });
    await run(h, db, schema);
    expect(h.defects.errors).toEqual([]);
  });
}

async function count(db: Kysely<AccountsDatabase>, query: string): Promise<number> {
  const result = await sql<{
    n: string;
  }>`select count(*)::text as n from ${sql.raw(query)}`.execute(db);
  return Number(result.rows[0]?.n);
}

async function tables(db: Kysely<AccountsDatabase>, schema: string): Promise<string[]> {
  const result = await sql<{ name: string }>`
    select table_name as name from information_schema.tables
    where table_schema = ${schema} order by table_name`.execute(db);
  return result.rows.map((row) => row.name);
}

/** The error PostgreSQL raised for `run`: its SQLSTATE and constraint name. */
async function violation(
  run: () => Promise<unknown>,
): Promise<{ readonly code: unknown; readonly constraint: unknown }> {
  try {
    await run();
  } catch (error: unknown) {
    return { code: field(error, "code"), constraint: field(error, "constraint") };
  }
  return { code: "succeeded", constraint: null };
}

describe("TST-AUTH-DB schema", () => {
  it("TST-AUTH-DB-001 migrations go up, down to nothing, and up again, with their own bookkeeping tables", async () => {
    await withAccountsSchema(APP, { migrateAccounts: false }, async (schema) => {
      const db = schema.accounts(1);
      const migrator = accountsMigrator(db, ACCOUNTS_MIGRATIONS, schema.name);
      const up = await migrator.migrateToLatest();
      expect(up.error).toBeUndefined();
      expect(
        up.results?.map((result) => [result.migrationName, result.direction, result.status]),
      ).toEqual(MIGRATION_NAMES.map((name) => [name, "Up", "Success"]));
      expect(await tables(db, schema.name)).toEqual(
        [...TABLES, ACCOUNTS_MIGRATION_LOCK_TABLE, ACCOUNTS_MIGRATION_TABLE].sort(),
      );
      const down = await migrator.migrateTo(NO_MIGRATIONS);
      expect(down.error).toBeUndefined();
      expect(
        down.results?.map((result) => [result.migrationName, result.direction, result.status]),
      ).toEqual([...MIGRATION_NAMES].reverse().map((name) => [name, "Down", "Success"]));
      expect(await tables(db, schema.name)).toEqual(
        [ACCOUNTS_MIGRATION_LOCK_TABLE, ACCOUNTS_MIGRATION_TABLE].sort(),
      );
      const again = await migrator.migrateToLatest();
      expect(again.error).toBeUndefined();
      expect(again.results).toHaveLength(4);
      expect((await migrator.migrateToLatest()).results).toEqual([]);
    });
  });

  it("TST-AUTH-DB-016 a migrator pinned to its schema ignores another schema's bookkeeping tables", async () => {
    await withAccountsSchema(APP, {}, async (outer) => {
      expect(await tables(outer.accounts(1), outer.name)).toContain(ACCOUNTS_MIGRATION_TABLE);
      await withAccountsSchema(APP, { migrateAccounts: false }, async (inner) => {
        const db = inner.accounts(1);
        const migrated = await accountsMigrator(
          db,
          ACCOUNTS_MIGRATIONS,
          inner.name,
        ).migrateToLatest();
        expect(migrated.error).toBeUndefined();
        expect(migrated.results).toHaveLength(4);
        expect(await tables(db, inner.name)).toEqual(
          [...TABLES, ACCOUNTS_MIGRATION_LOCK_TABLE, ACCOUNTS_MIGRATION_TABLE].sort(),
        );
      });
    });
  });

  it("TST-AUTH-DB-002 accounts and live-game migrations coexist in one schema without touching each other", async () => {
    await withAccountsSchema(APP, { migrateLiveGame: true }, async (schema) => {
      const names = await tables(schema.accounts(1), schema.name);
      for (const table of [...TABLES, "live_games", "outbox_events"]) {
        expect(names).toContain(table);
      }
    });
  });

  it("TST-AUTH-DB-003 only the needed indexes exist, and no column holds a password or raw token", async () => {
    await withAccountsSchema(APP, {}, async (schema) => {
      const db = schema.accounts(1);
      const indexes = await sql<{ name: string }>`
        select indexname as name from pg_indexes
        where schemaname = ${schema.name} and tablename = any(${TABLES})
        order by indexname`.execute(db);
      expect(indexes.rows.map((row) => row.name)).toEqual([
        "account_action_tokens_pkey",
        "account_action_tokens_user_purpose_idx",
        "user_credentials_pkey",
        "user_sessions_pkey",
        "user_sessions_token_hash_key",
        "user_sessions_user_live_idx",
        "users_email_canonical_key",
        "users_pkey",
        "users_username_canonical_key",
      ]);
      const columns = await sql<{ table: string; column: string }>`
        select table_name as "table", column_name as "column" from information_schema.columns
        where table_schema = ${schema.name} and table_name = any(${TABLES})`.execute(db);
      const suspicious = columns.rows
        .filter((row) => /password|token|secret/.test(row.column))
        .map((row) => `${row.table}.${row.column}`)
        .sort();
      expect(suspicious).toEqual([
        "account_action_tokens.token_hash",
        "user_credentials.password_hash",
        "user_credentials.password_scheme",
        "user_sessions.token_hash",
      ]);
    });
  });

  it("TST-AUTH-DB-004 constraints reject what the domain would never write", async () => {
    await withAccountsSchema(APP, {}, async (schema) => {
      const db = schema.accounts(1);
      const user = (username: string, canonical: string, email: string, emailCanonical: string) =>
        sql`insert into users (user_id, username, username_canonical, email, email_canonical)
            values (gen_random_uuid(), ${username}, ${canonical}, ${email}, ${emailCanonical})`.execute(
          db,
        );
      await user("Taher", "taher", "T@x.test", "t@x.test");
      const id = await sql<{ id: string }>`select user_id::text as id from users`.execute(db);
      const userId = id.rows[0]?.id ?? "";
      const cases: readonly (readonly [() => Promise<unknown>, string, string])[] = [
        [() => user("a", "a", "a@x.test", "a@x.test"), "23514", "users_username_format"],
        [() => user("a__b", "a__b", "b@x.test", "b@x.test"), "23514", "users_username_format"],
        [
          () => user("Taher2", "Taher2", "c@x.test", "c@x.test"),
          "23514",
          "users_username_canonical_form",
        ],
        [() => user("valid", "valid", "no-at", "no-at"), "23514", "users_email_format"],
        [
          () => user("valid", "valid", "A@x.test", "A@x.test"),
          "23514",
          "users_email_canonical_form",
        ],
        [
          () => user("TAHER", "taher", "d@x.test", "d@x.test"),
          "23505",
          "users_username_canonical_key",
        ],
        [
          () => user("other", "other", "T@X.TEST", "t@x.test"),
          "23505",
          "users_email_canonical_key",
        ],
        [() => sql`update users set status = 'banned'`.execute(db), "23514", "users_status"],
        [
          () =>
            sql`insert into user_credentials (user_id, password_scheme, password_hash)
                values (${userId}::uuid, 'argon2id', 'plaintext')`.execute(db),
          "23514",
          "user_credentials_hash_format",
        ],
        [
          () =>
            sql`insert into user_credentials (user_id, password_scheme, password_hash)
                values (${userId}::uuid, 'bcrypt', '$argon2id$v=19$m=8,t=1,p=1$AAAA$AAAA')`.execute(
              db,
            ),
          "23514",
          "user_credentials_scheme",
        ],
        [
          () =>
            sql`insert into user_sessions (session_id, user_id, token_hash, created_at, last_seen_at, absolute_expires_at)
                values (gen_random_uuid(), ${userId}::uuid, decode(repeat('ab', 31), 'hex'), now(), now(), now() + interval '1 day')`.execute(
              db,
            ),
          "23514",
          "user_sessions_token_hash_length",
        ],
        [
          () =>
            sql`insert into user_sessions (session_id, user_id, token_hash, created_at, last_seen_at, absolute_expires_at, revoked_at)
                values (gen_random_uuid(), ${userId}::uuid, decode(repeat('ab', 32), 'hex'), now(), now(), now() + interval '1 day', now())`.execute(
              db,
            ),
          "23514",
          "user_sessions_revocation",
        ],
        [
          () =>
            sql`insert into user_sessions (session_id, user_id, token_hash, created_at, last_seen_at, absolute_expires_at, revoked_at, revocation_reason)
                values (gen_random_uuid(), ${userId}::uuid, decode(repeat('ab', 32), 'hex'), now(), now(), now() + interval '1 day', now(), 'bogus')`.execute(
              db,
            ),
          "23514",
          "user_sessions_revocation",
        ],
        [
          () =>
            sql`insert into user_sessions (session_id, user_id, token_hash, created_at, last_seen_at, absolute_expires_at)
                values (gen_random_uuid(), ${userId}::uuid, decode(repeat('ab', 32), 'hex'), now(), now() - interval '1 day', now() + interval '1 day')`.execute(
              db,
            ),
          "23514",
          "user_sessions_times",
        ],
        [
          () =>
            sql`insert into account_action_tokens (token_hash, user_id, purpose, email_canonical, created_at, expires_at)
                values (decode(repeat('ab', 32), 'hex'), ${userId}::uuid, 'magic', 't@x.test', now(), now() + interval '1 hour')`.execute(
              db,
            ),
          "23514",
          "account_action_tokens_purpose",
        ],
        [
          () =>
            sql`insert into account_action_tokens (token_hash, user_id, purpose, email_canonical, created_at, expires_at)
                values (decode(repeat('ab', 16), 'hex'), ${userId}::uuid, 'password_reset', 't@x.test', now(), now() + interval '1 hour')`.execute(
              db,
            ),
          "23514",
          "account_action_tokens_hash_length",
        ],
      ];
      for (const [run, code, constraint] of cases) {
        expect(await violation(run), constraint).toEqual({ code, constraint });
      }
    });
  });
});

describe("TST-AUTH-DB flows through PostgresAccountsRepository", () => {
  it("TST-AUTH-DB-005 register, login by either identifier, sessions, logout, and logout-all", async () => {
    await withPostgres({}, async (h, db) => {
      const first = await registered(h, "Taher");
      expect(first.account).toMatchObject({
        username: "Taher",
        status: "active",
        emailVerified: false,
      });
      const byEmail = await signedIn(h, "TAHER@EXAMPLE.TEST");
      const byName = await signedIn(h, "taher");
      expect(byName.account.userId).toBe(first.account.userId);
      expect(await h.accounts.authenticate(byEmail.session.token)).toEqual({
        sessionId: byEmail.session.sessionId,
        userId: first.account.userId,
      });
      const session = { sessionId: byName.session.sessionId, userId: byName.account.userId };
      const listed = await h.accounts.listSessions(session);
      expect(listed.map((view) => view.current).sort()).toEqual([false, false, true]);
      await h.accounts.logout(first.session.token);
      await h.accounts.logout(first.session.token);
      expect(await h.accounts.authenticate(first.session.token)).toBeNull();
      await h.accounts.logoutAll(session);
      expect(await h.accounts.authenticate(byEmail.session.token)).toBeNull();
      expect(await h.accounts.authenticate(byName.session.token)).toBeNull();
      expect(await count(db, "user_sessions where revoked_at is null")).toBe(0);
      const reasons = await sql<{ reason: string }>`
        select revocation_reason as reason from user_sessions order by revocation_reason`.execute(
        db,
      );
      expect(reasons.rows.map((row) => row.reason)).toEqual(["logout", "logout_all", "logout_all"]);
    });
  });

  it("TST-AUTH-DB-006 only digests are stored: no row contains a session token, reset token, or password", async () => {
    await withPostgres({}, async (h, db) => {
      const { session } = await registered(h, "Taher");
      expect(
        (await h.accounts.requestPasswordReset({ email: "taher@example.test" }, CLIENT)).ok,
      ).toBe(true);
      const reset = h.delivery.last("password_reset").token;
      const dump = await sql<{ row: string }>`
        select row_to_json(t)::text as row from users t
        union all select row_to_json(t)::text from user_credentials t
        union all select row_to_json(t)::text from user_sessions t
        union all select row_to_json(t)::text from account_action_tokens t`.execute(db);
      const text = dump.rows.map((row) => row.row).join("\n");
      for (const secret of [session.token, reset, PASSWORD]) expect(text).not.toContain(secret);
      const stored = await sql<{
        hash: Uint8Array;
      }>`select token_hash as hash from user_sessions`.execute(db);
      expect(
        Buffer.from(stored.rows[0]?.hash ?? []).equals(tokenDigest("session", session.token)),
      ).toBe(true);
      const credential = await sql<{
        hash: string;
      }>`select password_hash as hash from user_credentials`.execute(db);
      expect(credential.rows[0]?.hash).toMatch(/^\$argon2id\$v=19\$m=8,t=1,p=1\$/);
    });
  });

  it("TST-AUTH-DB-007 last_seen_at is touched at most once per interval; idle and absolute expiry end the session; purge removes ended rows", async () => {
    await withPostgres({}, async (h, db) => {
      const { session } = await registered(h, "Taher");
      const lastSeen = async () => {
        const result = await sql<{ ms: string }>`
          select (extract(epoch from last_seen_at) * 1000)::int8::text as ms from user_sessions`.execute(
          db,
        );
        return Number(result.rows[0]?.ms);
      };
      const created = await lastSeen();
      h.clock.advance(MINUTE);
      expect(await h.accounts.authenticate(session.token)).not.toBeNull();
      expect(await lastSeen()).toBe(created);
      h.clock.advance(15 * MINUTE);
      expect(await h.accounts.authenticate(session.token)).not.toBeNull();
      expect(await lastSeen()).toBe(created + 16 * MINUTE);
      h.clock.advance(7 * DAY + MINUTE);
      expect(await h.accounts.authenticate(session.token)).toBeNull();
      const other = await signedIn(h, "taher");
      h.clock.advance(31 * DAY);
      expect(await h.accounts.authenticate(other.session.token)).toBeNull();
      await h.accounts.logout(other.session.token);
      h.clock.advance(DAY);
      expect(await h.accounts.purgeEnded(0)).toEqual({ sessions: 2, tokens: 0 });
      expect(await count(db, "user_sessions")).toBe(0);
    });
  });

  it("TST-AUTH-DB-008 the per-user cap evicts the least recently seen session under the user lock", async () => {
    await withPostgres({ sessions: { maxSessionsPerUser: 2 } }, async (h, db) => {
      const a = await registered(h, "Taher");
      h.clock.advance(MINUTE);
      const b = await signedIn(h, "taher");
      h.clock.advance(MINUTE);
      await signedIn(h, "taher");
      expect(await h.accounts.authenticate(a.session.token)).toBeNull();
      expect(await h.accounts.authenticate(b.session.token)).not.toBeNull();
      expect(await count(db, "user_sessions where revocation_reason = 'session_limit'")).toBe(1);
      await Promise.all(Array.from({ length: 6 }, () => signedIn(h, "taher")));
      expect(await count(db, "user_sessions where revoked_at is null")).toBe(2);
    });
  });

  it("TST-AUTH-DB-009 password change, reset, verification, and disabling all persist and revoke", async () => {
    await withPostgres({}, async (h, db) => {
      const first = await registered(h, "Taher");
      const session = { sessionId: first.session.sessionId, userId: first.account.userId };
      const changed = await h.accounts.changePassword(
        session,
        { currentPassword: PASSWORD, newPassword: OTHER_PASSWORD },
        CLIENT,
      );
      if (!changed.ok) throw new Error(changed.error.kind);
      expect(await h.accounts.authenticate(first.session.token)).toBeNull();
      expect(await h.accounts.authenticate(changed.value.session.token)).not.toBeNull();
      expect((await h.accounts.login({ identifier: "taher", password: PASSWORD }, CLIENT)).ok).toBe(
        false,
      );

      await h.accounts.requestPasswordReset({ email: "taher@example.test" }, CLIENT);
      const token = h.delivery.last("password_reset").token;
      expect((await h.accounts.resetPassword({ token, newPassword: PASSWORD }, CLIENT)).ok).toBe(
        true,
      );
      expect(await h.accounts.authenticate(changed.value.session.token)).toBeNull();
      const again = await signedIn(h, "taher", PASSWORD);

      const current = { sessionId: again.session.sessionId, userId: again.account.userId };
      expect((await h.accounts.requestEmailVerification(current)).ok).toBe(true);
      const verify = h.delivery.last("email_verification").token;
      expect((await h.accounts.confirmEmailVerification({ token: verify }, CLIENT)).ok).toBe(true);
      expect(await h.accounts.account(current)).toMatchObject({ emailVerified: true });

      expect(await h.accounts.setAccountStatus(again.account.userId, "disabled")).toBe(true);
      expect(await h.accounts.authenticate(again.session.token)).toBeNull();
      expect(await count(db, "user_sessions where revoked_at is null")).toBe(0);
      expect(await count(db, "users where status = 'disabled'")).toBe(1);
    });
  });
});

describe("TST-AUTH-DB races: the database decides", () => {
  it("TST-AUTH-DB-010 concurrent registrations of one username (any case) or one email (any case) have exactly one winner", async () => {
    await withPostgres({}, async (h, db) => {
      const names = await Promise.all(
        ["Racer", "RACER", "racer", "rAcEr", "Racer", "racER"].map((username, index) =>
          h.accounts.register(
            { username, email: `r${index}@example.test`, password: PASSWORD },
            CLIENT,
          ),
        ),
      );
      expect(names.filter((result) => result.ok)).toHaveLength(1);
      expect(
        names
          .filter((result) => !result.ok)
          .map((result) => (result.ok ? null : result.error.kind)),
      ).toEqual(Array.from({ length: 5 }, () => "username_unavailable"));

      const emails = await Promise.all(
        ["same@example.test", "SAME@example.test", "Same@Example.Test", "same@EXAMPLE.test"].map(
          (email, index) =>
            h.accounts.register({ username: `mail${index}`, email, password: PASSWORD }, CLIENT),
        ),
      );
      expect(emails.filter((result) => result.ok)).toHaveLength(1);
      expect(
        emails
          .filter((result) => !result.ok)
          .map((result) => (result.ok ? null : result.error.kind)),
      ).toEqual(["email_unavailable", "email_unavailable", "email_unavailable"]);
      expect(await count(db, "users")).toBe(2);
      expect(await count(db, "user_credentials")).toBe(2);
      expect(await count(db, "user_sessions")).toBe(2);
    });
  });

  it("TST-AUTH-DB-017 a login that verified the old password gets no session if a password change commits first", async () => {
    await withAccountsSchema(APP, {}, async (schema) => {
      const db = schema.accounts();
      const repository = new RacingRepository(db);
      const h = accountsHarness({ repository });
      const first = await registered(h, "Taher");
      repository.beforeCreateSession = async () => {
        const changed = await h.accounts.changePassword(
          { sessionId: first.session.sessionId, userId: first.account.userId },
          { currentPassword: PASSWORD, newPassword: OTHER_PASSWORD },
          CLIENT,
        );
        expect(changed.ok).toBe(true);
      };
      expect(await h.accounts.login({ identifier: "taher", password: PASSWORD }, CLIENT)).toEqual({
        ok: false,
        error: { kind: "invalid_credentials" },
      });
      expect(await count(db, "user_sessions where revoked_at is null")).toBe(1);
      expect(h.defects.errors).toEqual([]);
    });
  });

  it("TST-AUTH-DB-011 a reset token is consumed once under concurrent use", async () => {
    await withPostgres({}, async (h) => {
      await registered(h, "Taher");
      await h.accounts.requestPasswordReset({ email: "taher@example.test" }, CLIENT);
      const token = h.delivery.last("password_reset").token;
      const results = await Promise.all(
        Array.from({ length: 6 }, (_unused, index) =>
          h.accounts.resetPassword(
            { token, newPassword: `new passphrase number ${index}` },
            CLIENT,
          ),
        ),
      );
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(
        results
          .filter((result) => !result.ok)
          .map((result) => (result.ok ? null : result.error.kind)),
      ).toEqual(Array.from({ length: 5 }, () => "invalid_token"));
    });
  });
});

describe("TST-AUTH-DB rollback: a failure inside the transaction leaves nothing behind", () => {
  it("TST-AUTH-DB-012 registration rolls back the user and credentials when the session insert fails; the error leaks no driver text", async () => {
    await withPostgres({}, async (h, db, schema) => {
      const undo = await schema.failOn("user_sessions", "insert");
      const failure = await h.accounts
        .register({ username: "Taher", email: "taher@example.test", password: PASSWORD }, CLIENT)
        .then(
          () => null,
          (error: unknown) => error,
        );
      expect(failure).toBeInstanceOf(AccountsStoreError);
      expect(String(failure)).toBe(
        "AccountsStoreError: Accounts store operation create_account failed: sqlstate P0001",
      );
      expect(await count(db, "users")).toBe(0);
      expect(await count(db, "user_credentials")).toBe(0);
      await undo();
      expect((await registered(h, "Taher")).account.username).toBe("Taher");
    });
  });

  it("TST-AUTH-DB-013 a failed login session insert does not evict the least recently seen session", async () => {
    await withPostgres({ sessions: { maxSessionsPerUser: 2 } }, async (h, db, schema) => {
      const a = await registered(h, "Taher");
      h.clock.advance(MINUTE);
      await signedIn(h, "taher");
      const undo = await schema.failOn("user_sessions", "insert");
      await expect(signedIn(h, "taher")).rejects.toBeInstanceOf(AccountsStoreError);
      expect(await count(db, "user_sessions where revoked_at is null")).toBe(2);
      expect(await h.accounts.authenticate(a.session.token)).not.toBeNull();
      await undo();
    });
  });

  it("TST-AUTH-DB-014 a failed password change keeps the old password and every session", async () => {
    await withPostgres({}, async (h, _db, schema) => {
      const first = await registered(h, "Taher");
      const other = await signedIn(h, "taher");
      const undo = await schema.failOn("user_sessions", "insert");
      const session = { sessionId: first.session.sessionId, userId: first.account.userId };
      await expect(
        h.accounts.changePassword(
          session,
          { currentPassword: PASSWORD, newPassword: OTHER_PASSWORD },
          CLIENT,
        ),
      ).rejects.toBeInstanceOf(AccountsStoreError);
      await undo();
      expect(await h.accounts.authenticate(first.session.token)).not.toBeNull();
      expect(await h.accounts.authenticate(other.session.token)).not.toBeNull();
      expect((await signedIn(h, "taher", PASSWORD)).account.userId).toBe(first.account.userId);
    });
  });

  it("TST-AUTH-DB-015 a failed reset leaves the token unconsumed, the password unchanged, and sessions alive", async () => {
    await withPostgres({}, async (h, _db, schema) => {
      const first = await registered(h, "Taher");
      await h.accounts.requestPasswordReset({ email: "taher@example.test" }, CLIENT);
      const token = h.delivery.last("password_reset").token;
      const undo = await schema.failOn("user_credentials", "update");
      await expect(
        h.accounts.resetPassword({ token, newPassword: OTHER_PASSWORD }, CLIENT),
      ).rejects.toBeInstanceOf(AccountsStoreError);
      await undo();
      expect(await h.accounts.authenticate(first.session.token)).not.toBeNull();
      expect(
        (await h.accounts.resetPassword({ token, newPassword: OTHER_PASSWORD }, CLIENT)).ok,
      ).toBe(true);
      expect(await h.accounts.authenticate(first.session.token)).toBeNull();
      expect((await signedIn(h, "taher", OTHER_PASSWORD)).account.userId).toBe(
        first.account.userId,
      );
    });
  });
});
