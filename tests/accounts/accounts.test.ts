import {
  Accounts,
  AccountsConfigError,
  type AuthenticatedSession,
  RFC9106_SECOND_RECOMMENDED,
  type SignedIn,
  tokenDigest,
} from "@chess-one/accounts";
import type { AccountStatus } from "@chess-one/identity";
import { describe, expect, it } from "vitest";
import {
  type AccountsHarness,
  accountsHarness,
  CLIENT,
  DAY,
  MINUTE,
  OTHER_PASSWORD,
  PASSWORD,
  registered,
  signedIn,
  TEST_ARGON2,
  testHasher,
} from "./support/harness.ts";
import { MemoryAccountsRepository } from "./support/memory-repository.ts";

function authOf(signed: SignedIn): AuthenticatedSession {
  return { sessionId: signed.session.sessionId, userId: signed.session.userId };
}

function memoryOf(h: AccountsHarness): MemoryAccountsRepository {
  if (h.memory === null) throw new Error("not a memory harness");
  return h.memory;
}

function expectNoSecrets(h: AccountsHarness, secrets: readonly string[]): void {
  const facts = JSON.stringify(h.facts.facts);
  for (const secret of secrets) expect(facts).not.toContain(secret);
}

describe("TST-AUTH-REG registration", () => {
  it("TST-AUTH-REG-001 registration stores a random user id, an Argon2id hash, and a session digest, and signs the user in", async () => {
    const h = accountsHarness();
    const signed = await registered(h, "Taher", PASSWORD, "Taher@Example.test");
    const memory = memoryOf(h);
    const [user] = [...memory.users.values()];
    expect(user).toMatchObject({
      username: "Taher",
      usernameCanonical: "taher",
      email: "Taher@Example.test",
      emailCanonical: "taher@example.test",
      status: "active",
      emailVerifiedAt: null,
    });
    expect(signed.account).toEqual({
      userId: user?.userId,
      username: "Taher",
      status: "active",
      emailVerified: false,
    });
    expect(signed.session.userId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const hash = memory.credentials.get(signed.session.userId) ?? "";
    expect(hash).toMatch(/^\$argon2id\$v=19\$/);
    expect(hash).not.toContain(PASSWORD);
    const [session] = [...memory.sessions.values()];
    expect(session?.tokenHash).toBe(
      Buffer.from(tokenDigest("session", signed.session.token)).toString("hex"),
    );
    expect(JSON.stringify([...memory.sessions.values()])).not.toContain(signed.session.token);
    expect(signed.session.maxAgeSeconds).toBe(30 * 24 * 3600);
    expect(await h.accounts.authenticate(signed.session.token)).toEqual(authOf(signed));
    expect(h.facts.named("registration_success")).toHaveLength(1);
    expect(h.facts.named("session_created")).toEqual([
      {
        name: "session_created",
        userId: signed.session.userId,
        sessionId: signed.session.sessionId,
        cause: "registration",
      },
    ]);
    expectNoSecrets(h, [PASSWORD, signed.session.token, "taher@example.test", "Taher"]);
  });

  it("TST-AUTH-REG-002 usernames and emails are unique on their canonical forms", async () => {
    const h = accountsHarness();
    await registered(h, "Taher", PASSWORD, "taher@example.test");
    const again = (username: string, email: string) =>
      h.accounts.register({ username, email, password: PASSWORD }, CLIENT);
    expect(await again("TAHER", "other@example.test")).toEqual({
      ok: false,
      error: { kind: "username_unavailable" },
    });
    expect(await again("Other", " TAHER@EXAMPLE.TEST ")).toEqual({
      ok: false,
      error: { kind: "email_unavailable" },
    });
    expect(memoryOf(h).users.size).toBe(1);
    expect(h.facts.named("registration_rejected").map((fact) => fact)).toEqual([
      { name: "registration_rejected", reason: "username_unavailable" },
      { name: "registration_rejected", reason: "email_unavailable" },
    ]);
  });

  it("TST-AUTH-REG-003 invalid input is refused with the field and a policy code, before any hashing", async () => {
    const h = accountsHarness();
    const before = h.hasher.derivations;
    const attempt = (username: string, email: string, password: string) =>
      h.accounts.register({ username, email, password }, CLIENT);
    expect(await attempt("x", "a@example.test", PASSWORD)).toEqual({
      ok: false,
      error: { kind: "invalid_input", field: "username", reason: "too_short" },
    });
    expect(await attempt("valid_name", "nope", PASSWORD)).toEqual({
      ok: false,
      error: { kind: "invalid_input", field: "email", reason: "invalid_format" },
    });
    expect(await attempt("valid_name", "a@example.test", "short")).toEqual({
      ok: false,
      error: { kind: "invalid_input", field: "password", reason: "too_short" },
    });
    expect(await attempt("valid_name", "a@example.test", "valid_name")).toEqual({
      ok: false,
      error: { kind: "invalid_input", field: "password", reason: "too_short" },
    });
    expect(h.hasher.derivations).toBe(before);
    expect(memoryOf(h).users.size).toBe(0);
  });

  it("TST-AUTH-REG-004 the compromised-password screen is consulted for new passwords", async () => {
    const h = accountsHarness({ compromised: ["password12345678"] });
    expect(
      await h.accounts.register(
        { username: "screened", email: "s@example.test", password: "password12345678" },
        CLIENT,
      ),
    ).toEqual({
      ok: false,
      error: { kind: "invalid_input", field: "password", reason: "compromised" },
    });
    expect(h.facts.named("registration_rejected")).toEqual([
      { name: "registration_rejected", reason: "compromised_password" },
    ]);
  });

  it("TST-AUTH-REG-005 registration applies the 15 to 256 code point bounds: 14 and 257 are refused, 15, 256, and a spaced passphrase register", async () => {
    const h = accountsHarness();
    const attempt = (username: string, password: string) =>
      h.accounts.register({ username, email: `${username}@example.test`, password }, CLIENT);
    expect(await attempt("fourteen", "x".repeat(14))).toEqual({
      ok: false,
      error: { kind: "invalid_input", field: "password", reason: "too_short" },
    });
    expect(await attempt("toolong", "x".repeat(257))).toEqual({
      ok: false,
      error: { kind: "invalid_input", field: "password", reason: "too_long" },
    });
    expect(memoryOf(h).users.size).toBe(0);
    expect((await attempt("fifteen", "x".repeat(15))).ok).toBe(true);
    expect((await attempt("maximum", "y".repeat(256))).ok).toBe(true);
    expect((await attempt("spaced", "four words of text")).ok).toBe(true);
    expect(memoryOf(h).users.size).toBe(3);
  });
});

describe("TST-AUTH-LOGIN login and enumeration resistance", () => {
  it("TST-AUTH-LOGIN-001 login works by username or email in any case, and every login is a new session", async () => {
    const h = accountsHarness();
    const first = await registered(h, "Taher", PASSWORD, "taher@example.test");
    const byName = await signedIn(h, "tAhEr");
    const byEmail = await signedIn(h, "TAHER@example.TEST");
    const ids = [first, byName, byEmail].map((signed) => signed.session.sessionId);
    expect(new Set(ids).size).toBe(3);
    expect(new Set([first, byName, byEmail].map((s) => s.session.token)).size).toBe(3);
    expect(byEmail.account).toEqual(first.account);
    expect(h.facts.named("login_success")).toHaveLength(2);
  });

  it("TST-AUTH-LOGIN-002 an unknown account and a wrong password get the identical answer, and both run one Argon2id derivation", async () => {
    const h = accountsHarness();
    await registered(h, "Taher");
    const unknownBefore = h.hasher.derivations;
    const unknown = await h.accounts.login({ identifier: "nobody", password: PASSWORD }, CLIENT);
    const unknownCost = h.hasher.derivations - unknownBefore;
    const wrongBefore = h.hasher.derivations;
    const wrong = await h.accounts.login({ identifier: "taher", password: OTHER_PASSWORD }, CLIENT);
    const wrongCost = h.hasher.derivations - wrongBefore;
    const malformedBefore = h.hasher.derivations;
    const malformed = await h.accounts.login({ identifier: "a b c", password: PASSWORD }, CLIENT);
    expect(unknown).toEqual({ ok: false, error: { kind: "invalid_credentials" } });
    expect(wrong).toEqual(unknown);
    expect(malformed).toEqual(unknown);
    expect([unknownCost, wrongCost, h.hasher.derivations - malformedBefore]).toEqual([1, 1, 1]);
    expect(h.facts.named("login_failure")).toEqual([
      { name: "login_failure", reason: "unknown_account", identifierKind: "username" },
      { name: "login_failure", reason: "wrong_password", identifierKind: "username" },
      { name: "login_failure", reason: "unknown_account", identifierKind: "unknown" },
    ]);
    expectNoSecrets(h, [PASSWORD, OTHER_PASSWORD, "nobody"]);
  });

  it("TST-AUTH-LOGIN-003 a disabled or locked account is revealed only to someone who knows the password", async () => {
    const h = accountsHarness();
    const signed = await registered(h, "Taher");
    const statuses: readonly AccountStatus[] = ["disabled", "locked"];
    for (const status of statuses) {
      await h.accounts.setAccountStatus(signed.session.userId, status);
      expect(
        await h.accounts.login({ identifier: "taher", password: OTHER_PASSWORD }, CLIENT),
      ).toEqual({ ok: false, error: { kind: "invalid_credentials" } });
      expect(await h.accounts.login({ identifier: "taher", password: PASSWORD }, CLIENT)).toEqual({
        ok: false,
        error: { kind: "account_unavailable" },
      });
    }
    expect(h.facts.named("account_disabled_auth_attempt")).toEqual([
      {
        name: "account_disabled_auth_attempt",
        userId: signed.session.userId,
        status: "disabled",
        via: "login",
      },
      {
        name: "account_disabled_auth_attempt",
        userId: signed.session.userId,
        status: "locked",
        via: "login",
      },
    ]);
  });

  it("TST-AUTH-LOGIN-004 a hash with outdated parameters is upgraded on the next successful login, and only then", async () => {
    const repository = new MemoryAccountsRepository();
    const old = accountsHarness({
      repository,
      hasher: testHasher({ ...TEST_ARGON2, memoryKiB: 16 }),
    });
    const signed = await registered(old, "Taher");
    const oldHash = repository.credentials.get(signed.session.userId);
    expect(oldHash).toContain("m=16,");
    const current = accountsHarness({ repository });
    await current.accounts.login({ identifier: "taher", password: OTHER_PASSWORD }, CLIENT);
    expect(repository.credentials.get(signed.session.userId)).toBe(oldHash);
    await signedIn(current, "taher");
    const newHash = repository.credentials.get(signed.session.userId) ?? "";
    expect(newHash).toContain("m=8,");
    expect(current.facts.named("password_rehashed")).toHaveLength(1);
    await signedIn(current, "taher");
    expect(current.facts.named("password_rehashed")).toHaveLength(1);
  });

  it("TST-AUTH-LOGIN-005 oversized identifiers and passwords are refused before any lookup", async () => {
    const h = accountsHarness();
    expect(
      await h.accounts.login({ identifier: "x".repeat(255), password: PASSWORD }, CLIENT),
    ).toEqual({
      ok: false,
      error: { kind: "invalid_input", field: "identifier", reason: "length" },
    });
    expect(
      await h.accounts.login({ identifier: "taher", password: "x".repeat(257) }, CLIENT),
    ).toEqual({
      ok: false,
      error: { kind: "invalid_input", field: "password", reason: "too_long" },
    });
  });

  it("TST-AUTH-LOGIN-006 a login that verified the old password gets no session if a password change commits first", async () => {
    const h = accountsHarness();
    const first = await registered(h, "Taher");
    if (h.memory === null) throw new Error("memory");
    h.memory.beforeCreateSession = async () => {
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
    expect(h.facts.named("login_failure").at(-1)).toMatchObject({ reason: "password_changed" });
    const live = [...h.memory.sessions.values()].filter((row) => row.revokedAt === null);
    expect(live).toHaveLength(1);
    expect((await signedIn(h, "taher", OTHER_PASSWORD)).account.userId).toBe(first.account.userId);
  });
});

describe("TST-AUTH-SESSION session lifecycle", () => {
  it("TST-AUTH-SESSION-001 a session ends at its absolute expiry even while in use", async () => {
    const h = accountsHarness();
    const signed = await registered(h, "Taher");
    for (let day = 1; day < 30; day += 1) {
      h.clock.advance(DAY);
      expect(await h.accounts.authenticate(signed.session.token), `day ${day}`).not.toBeNull();
    }
    h.clock.advance(DAY);
    expect(await h.accounts.authenticate(signed.session.token)).toBeNull();
    expect(h.facts.named("session_rejected").at(-1)).toEqual({
      name: "session_rejected",
      reason: "expired",
    });
  });

  it("TST-AUTH-SESSION-002 a session ends after 7 idle days; activity is written at most every 15 minutes", async () => {
    const h = accountsHarness();
    const signed = await registered(h, "Taher");
    const memory = memoryOf(h);
    h.clock.advance(MINUTE);
    await h.accounts.authenticate(signed.session.token);
    expect(memory.touches).toBe(0);
    h.clock.advance(15 * MINUTE);
    await h.accounts.authenticate(signed.session.token);
    expect(memory.touches).toBe(1);
    h.clock.advance(7 * DAY - 1);
    expect(await h.accounts.authenticate(signed.session.token)).not.toBeNull();
    h.clock.advance(7 * DAY);
    expect(await h.accounts.authenticate(signed.session.token)).toBeNull();
    expect(h.facts.named("session_rejected").at(-1)).toEqual({
      name: "session_rejected",
      reason: "idle",
    });
  });

  it("TST-AUTH-SESSION-003 logout revokes the session at once, is idempotent, and leaves other sessions alone", async () => {
    const h = accountsHarness();
    const first = await registered(h, "Taher");
    const second = await signedIn(h, "taher");
    await h.accounts.logout(first.session.token);
    expect(await h.accounts.authenticate(first.session.token)).toBeNull();
    expect(await h.accounts.authenticate(second.session.token)).not.toBeNull();
    await h.accounts.logout(first.session.token);
    await h.accounts.logout("not a token");
    expect(h.facts.named("session_revoked")).toEqual([
      {
        name: "session_revoked",
        userId: first.session.userId,
        sessionId: first.session.sessionId,
        reason: "logout",
      },
    ]);
  });

  it("TST-AUTH-SESSION-004 logout-all revokes every session of the user, the current one included, and no one else's", async () => {
    const h = accountsHarness();
    const a = await registered(h, "Taher");
    const b = await signedIn(h, "taher");
    const other = await registered(h, "Someone");
    await h.accounts.logoutAll(authOf(a));
    expect(await h.accounts.authenticate(a.session.token)).toBeNull();
    expect(await h.accounts.authenticate(b.session.token)).toBeNull();
    expect(await h.accounts.authenticate(other.session.token)).not.toBeNull();
  });

  it("TST-AUTH-SESSION-005 the session list shows the user's live sessions with the current one marked, and no secrets", async () => {
    const h = accountsHarness();
    const a = await registered(h, "Taher");
    h.clock.advance(MINUTE);
    const b = await signedIn(h, "taher");
    const ended = await signedIn(h, "taher");
    await h.accounts.logout(ended.session.token);
    const list = await h.accounts.listSessions(authOf(a));
    expect(list).toEqual([
      {
        sessionId: b.session.sessionId,
        createdAt: h.clock.now(),
        lastSeenAt: h.clock.now(),
        current: false,
      },
      {
        sessionId: a.session.sessionId,
        createdAt: h.clock.now() - MINUTE,
        lastSeenAt: h.clock.now() - MINUTE,
        current: true,
      },
    ]);
    expect(JSON.stringify(list)).not.toMatch(new RegExp(`${a.session.token}|${b.session.token}`));
  });

  it("TST-AUTH-SESSION-006 revoking one session works only on the user's own sessions (IDOR)", async () => {
    const h = accountsHarness();
    const mine = await registered(h, "Taher");
    const spare = await signedIn(h, "taher");
    const theirs = await registered(h, "Victim");
    expect(await h.accounts.revokeSession(authOf(mine), theirs.session.sessionId)).toBe(
      "not_found",
    );
    expect(await h.accounts.authenticate(theirs.session.token)).not.toBeNull();
    expect(await h.accounts.revokeSession(authOf(mine), "not-a-session-id")).toBe("not_found");
    expect(await h.accounts.revokeSession(authOf(mine), spare.session.sessionId)).toBe("revoked");
    expect(await h.accounts.authenticate(spare.session.token)).toBeNull();
    expect(await h.accounts.revokeSession(authOf(mine), spare.session.sessionId)).toBe("not_found");
    expect(await h.accounts.authenticate(mine.session.token)).not.toBeNull();
  });

  it("TST-AUTH-SESSION-007 the per-user cap revokes the least recently seen session when one more is created", async () => {
    const h = accountsHarness({ sessions: { maxSessionsPerUser: 3 } });
    const first = await registered(h, "Taher");
    h.clock.advance(MINUTE);
    const second = await signedIn(h, "taher");
    h.clock.advance(MINUTE);
    const third = await signedIn(h, "taher");
    h.clock.advance(20 * MINUTE);
    await h.accounts.authenticate(first.session.token);
    const fourth = await signedIn(h, "taher");
    expect(await h.accounts.authenticate(second.session.token)).toBeNull();
    for (const live of [first, third, fourth]) {
      expect(await h.accounts.authenticate(live.session.token)).not.toBeNull();
    }
    expect(h.facts.named("session_revoked")).toEqual([
      {
        name: "session_revoked",
        userId: first.session.userId,
        sessionId: second.session.sessionId,
        reason: "session_limit",
      },
    ]);
  });

  it("TST-AUTH-SESSION-008 disabling an account invalidates all its sessions and tells watchers; re-enabling does not revive them", async () => {
    const h = accountsHarness();
    const a = await registered(h, "Taher");
    const b = await signedIn(h, "taher");
    const ended: string[] = [];
    h.accounts.watchSession(authOf(a), () => ended.push("a"));
    h.accounts.watchSession(authOf(b), () => ended.push("b"));
    expect(await h.accounts.setAccountStatus(a.session.userId, "disabled")).toBe(true);
    expect(ended.sort()).toEqual(["a", "b"]);
    expect(await h.accounts.authenticate(a.session.token)).toBeNull();
    await h.accounts.setAccountStatus(a.session.userId, "active");
    expect(await h.accounts.authenticate(a.session.token)).toBeNull();
    expect(await h.accounts.authenticate(b.session.token)).toBeNull();
    expect(await signedIn(h, "taher")).toBeTruthy();
  });

  it("TST-AUTH-SESSION-009 a session whose account is disabled directly in the store fails at once, with a security fact", async () => {
    const h = accountsHarness();
    const a = await registered(h, "Taher");
    const user = memoryOf(h).users.get(a.session.userId);
    if (user === undefined) throw new Error("no user");
    user.status = "locked";
    expect(await h.accounts.authenticate(a.session.token)).toBeNull();
    expect(await h.accounts.isSessionActive(authOf(a))).toBe(false);
    expect(h.facts.named("account_disabled_auth_attempt")).toContainEqual({
      name: "account_disabled_auth_attempt",
      userId: a.session.userId,
      status: "locked",
      via: "session",
    });
  });

  it("TST-AUTH-SESSION-010 maintenance deletes only long-ended sessions and tokens", async () => {
    const h = accountsHarness();
    const a = await registered(h, "Taher");
    const b = await signedIn(h, "taher");
    await h.accounts.logout(a.session.token);
    await h.accounts.requestPasswordReset({ email: "taher@example.test" }, CLIENT);
    h.clock.advance(2 * DAY);
    expect(await h.accounts.purgeEnded(DAY)).toEqual({ sessions: 1, tokens: 1 });
    expect(await h.accounts.authenticate(b.session.token)).not.toBeNull();
  });
});

describe("TST-AUTH-PASSWORD password change", () => {
  it("TST-AUTH-PASSWORD-001 the current password is required; a wrong one changes nothing", async () => {
    const h = accountsHarness();
    const a = await registered(h, "Taher");
    const hash = memoryOf(h).credentials.get(a.session.userId);
    expect(
      await h.accounts.changePassword(
        authOf(a),
        { currentPassword: OTHER_PASSWORD, newPassword: "brand new passphrase" },
        CLIENT,
      ),
    ).toEqual({ ok: false, error: { kind: "invalid_credentials" } });
    expect(memoryOf(h).credentials.get(a.session.userId)).toBe(hash);
    expect(await h.accounts.authenticate(a.session.token)).not.toBeNull();
  });

  it("TST-AUTH-PASSWORD-002 a change revokes every session, the current one included, and signs the device in with a new session", async () => {
    const h = accountsHarness();
    const a = await registered(h, "Taher");
    const b = await signedIn(h, "taher");
    const ended: string[] = [];
    h.accounts.watchSession(authOf(b), () => ended.push("b"));
    const changed = await h.accounts.changePassword(
      authOf(a),
      { currentPassword: PASSWORD, newPassword: "brand new passphrase" },
      CLIENT,
    );
    if (!changed.ok) throw new Error("change failed");
    expect(changed.value.session.sessionId).not.toBe(a.session.sessionId);
    expect(changed.value.session.token).not.toBe(a.session.token);
    expect(await h.accounts.authenticate(a.session.token)).toBeNull();
    expect(await h.accounts.authenticate(b.session.token)).toBeNull();
    expect(await h.accounts.authenticate(changed.value.session.token)).not.toBeNull();
    expect(ended).toEqual(["b"]);
    expect(
      await h.accounts.login({ identifier: "taher", password: PASSWORD }, CLIENT),
    ).toMatchObject({ ok: false });
    await signedIn(h, "taher", "brand new passphrase");
    expectNoSecrets(h, [PASSWORD, "brand new passphrase", changed.value.session.token]);
  });

  it("TST-AUTH-PASSWORD-003 the new password must meet the policy and differ from the account's identifiers", async () => {
    const h = accountsHarness();
    const a = await registered(h, "Taher", PASSWORD, "taher@example.test");
    expect(
      await h.accounts.changePassword(
        authOf(a),
        { currentPassword: PASSWORD, newPassword: "TAHER@example.test" },
        CLIENT,
      ),
    ).toEqual({
      ok: false,
      error: { kind: "invalid_input", field: "newPassword", reason: "matches_account_identifier" },
    });
  });
});

describe("TST-AUTH-RECOVERY password reset and email verification foundations", () => {
  it("TST-AUTH-RECOVERY-001 a reset request answers the same for known and unknown addresses; only a known active address gets a token", async () => {
    const h = accountsHarness();
    await registered(h, "Taher", PASSWORD, "taher@example.test");
    const known = await h.accounts.requestPasswordReset({ email: "TAHER@example.test" }, CLIENT);
    const unknown = await h.accounts.requestPasswordReset({ email: "ghost@example.test" }, CLIENT);
    expect(known).toEqual({ ok: true, value: null });
    expect(unknown).toEqual(known);
    expect(h.delivery.deliveries).toHaveLength(1);
    const delivered = h.delivery.last("password_reset");
    expect(delivered.email).toBe("taher@example.test");
    expect(delivered.expiresAt).toBe(h.clock.now() + 30 * MINUTE);
    const stored = [...memoryOf(h).tokens.values()];
    expect(stored).toHaveLength(1);
    expect(JSON.stringify(stored)).not.toContain(delivered.token);
    expectNoSecrets(h, [delivered.token, "taher@example.test", "ghost@example.test"]);
  });

  it("TST-AUTH-RECOVERY-002 a reset token works once, sets the password, and revokes every session", async () => {
    const h = accountsHarness();
    const a = await registered(h, "Taher");
    await h.accounts.requestPasswordReset({ email: "taher@example.test" }, CLIENT);
    const { token } = h.delivery.last("password_reset");
    const reset = () =>
      h.accounts.resetPassword({ token, newPassword: "reset passphrase ok" }, CLIENT);
    expect(await reset()).toEqual({ ok: true, value: null });
    expect(await reset()).toEqual({ ok: false, error: { kind: "invalid_token" } });
    expect(await h.accounts.authenticate(a.session.token)).toBeNull();
    await signedIn(h, "taher", "reset passphrase ok");
  });

  it("TST-AUTH-RECOVERY-003 reset tokens expire, are superseded by newer ones, and are purpose-bound", async () => {
    const h = accountsHarness();
    await registered(h, "Taher");
    await h.accounts.requestPasswordReset({ email: "taher@example.test" }, CLIENT);
    const first = h.delivery.last("password_reset").token;
    await h.accounts.requestPasswordReset({ email: "taher@example.test" }, CLIENT);
    const second = h.delivery.last("password_reset").token;
    const use = (token: string) =>
      h.accounts.resetPassword({ token, newPassword: "reset passphrase ok" }, CLIENT);
    expect(await use(first)).toEqual({ ok: false, error: { kind: "invalid_token" } });
    h.clock.advance(30 * MINUTE);
    expect(await use(second)).toEqual({ ok: false, error: { kind: "invalid_token" } });
    const signed = await signedIn(h, "taher");
    await h.accounts.requestEmailVerification(authOf(signed));
    const verification = h.delivery.last("email_verification").token;
    expect(await use(verification)).toEqual({ ok: false, error: { kind: "invalid_token" } });
    expect(await use("garbage")).toEqual({ ok: false, error: { kind: "invalid_token" } });
  });

  it("TST-AUTH-RECOVERY-004 email verification marks the address verified once", async () => {
    const h = accountsHarness();
    const a = await registered(h, "Taher");
    expect(await h.accounts.requestEmailVerification(authOf(a))).toEqual({ ok: true, value: null });
    const { token } = h.delivery.last("email_verification");
    expect(await h.accounts.confirmEmailVerification({ token }, CLIENT)).toEqual({
      ok: true,
      value: null,
    });
    expect(await h.accounts.account(authOf(a))).toMatchObject({ emailVerified: true });
    expect(await h.accounts.confirmEmailVerification({ token }, CLIENT)).toEqual({
      ok: false,
      error: { kind: "invalid_token" },
    });
    expect(await h.accounts.requestEmailVerification(authOf(a))).toEqual({
      ok: false,
      error: { kind: "already_verified" },
    });
  });

  it("TST-AUTH-RECOVERY-005 with no delivery configured, recovery answers feature_unavailable", async () => {
    const h = accountsHarness({ delivery: false });
    const a = await registered(h, "Taher");
    const unavailable = { ok: false, error: { kind: "feature_unavailable" } };
    expect(await h.accounts.requestPasswordReset({ email: "taher@example.test" }, CLIENT)).toEqual(
      unavailable,
    );
    expect(
      await h.accounts.resetPassword({ token: "x", newPassword: "reset passphrase ok" }, CLIENT),
    ).toEqual(unavailable);
    expect(await h.accounts.requestEmailVerification(authOf(a))).toEqual(unavailable);
    expect(await h.accounts.confirmEmailVerification({ token: "x" }, CLIENT)).toEqual(unavailable);
  });

  it("TST-AUTH-RECOVERY-006 a delivery failure is reported and not surfaced to the requester", async () => {
    const h = accountsHarness();
    await registered(h, "Taher");
    h.delivery.failNext = true;
    expect(await h.accounts.requestPasswordReset({ email: "taher@example.test" }, CLIENT)).toEqual({
      ok: true,
      value: null,
    });
    expect(h.defects.errors).toHaveLength(1);
    expect(h.facts.named("token_delivery_failed")).toEqual([
      { name: "token_delivery_failed", purpose: "password_reset" },
    ]);
  });
});

describe("TST-AUTH-THROTTLE rate limiting and brute force", () => {
  it("TST-AUTH-THROTTLE-001 repeated logins for one identifier are limited without locking the account; the limit refills", async () => {
    const h = accountsHarness({
      rateLimits: { login_identifier: { burst: 3, refillEveryMs: MINUTE } },
    });
    await registered(h, "Taher");
    for (let i = 0; i < 3; i += 1) {
      await h.accounts.login({ identifier: "taher", password: OTHER_PASSWORD }, CLIENT);
    }
    const before = h.hasher.derivations;
    expect(await h.accounts.login({ identifier: "TAHER", password: PASSWORD }, CLIENT)).toEqual({
      ok: false,
      error: { kind: "rate_limited", retryAfterMs: MINUTE },
    });
    expect(h.hasher.derivations).toBe(before);
    expect(await h.accounts.login({ identifier: "other", password: PASSWORD }, CLIENT)).toEqual({
      ok: false,
      error: { kind: "invalid_credentials" },
    });
    h.clock.advance(MINUTE);
    expect((await h.accounts.login({ identifier: "taher", password: PASSWORD }, CLIENT)).ok).toBe(
      true,
    );
    expect(h.facts.named("auth_rate_limited")).toEqual([
      { name: "auth_rate_limited", scope: "login_identifier" },
    ]);
  });

  it("TST-AUTH-THROTTLE-002 one client address is limited across identifiers; another address is not", async () => {
    const h = accountsHarness({
      rateLimits: { client_address: { burst: 2, refillEveryMs: 2_000 } },
    });
    const from = (clientAddress: string, identifier: string) =>
      h.accounts.login({ identifier, password: PASSWORD }, { clientAddress });
    await from("203.0.113.1", "a1a");
    await from("203.0.113.1", "b2b");
    expect(await from("203.0.113.1", "c3c")).toMatchObject({
      ok: false,
      error: { kind: "rate_limited" },
    });
    expect(await from("203.0.113.2", "c3c")).toEqual({
      ok: false,
      error: { kind: "invalid_credentials" },
    });
  });

  it("TST-AUTH-THROTTLE-003 password changes are limited per user, so a stolen session cannot guess the current password quickly", async () => {
    const h = accountsHarness({
      rateLimits: { password_change: { burst: 2, refillEveryMs: MINUTE } },
    });
    const a = await registered(h, "Taher");
    const attempt = () =>
      h.accounts.changePassword(
        authOf(a),
        { currentPassword: OTHER_PASSWORD, newPassword: "brand new passphrase" },
        CLIENT,
      );
    await attempt();
    await attempt();
    expect(await attempt()).toMatchObject({ ok: false, error: { kind: "rate_limited" } });
  });

  it("TST-AUTH-THROTTLE-004 reset requests are limited per address; limiters hold digests, never raw identifiers", async () => {
    const h = accountsHarness({
      rateLimits: { password_reset_request: { burst: 1, refillEveryMs: 15 * MINUTE } },
    });
    await registered(h, "Taher");
    await h.accounts.requestPasswordReset({ email: "taher@example.test" }, CLIENT);
    expect(
      await h.accounts.requestPasswordReset({ email: "Taher@Example.test" }, CLIENT),
    ).toMatchObject({ ok: false, error: { kind: "rate_limited" } });
    expect(h.delivery.deliveries).toHaveLength(1);
  });
});

describe("TST-AUTH-CONFIG configuration fails closed", () => {
  it("TST-AUTH-CONFIG-001 production refuses test-only hashing and a test-only token delivery", () => {
    const h = accountsHarness();
    expect(() => new Accounts({ ...h.config, environment: "production", delivery: null })).toThrow(
      /production password hashing/,
    );
    const hasher = testHasher(RFC9106_SECOND_RECOMMENDED, { maxConcurrent: 1, maxWaiting: 1 });
    expect(() => new Accounts({ ...h.config, environment: "production", hasher })).toThrow(
      /test-only token delivery/,
    );
    expect(
      new Accounts({ ...h.config, environment: "production", hasher, delivery: null }),
    ).toBeInstanceOf(Accounts);
  });

  it("TST-AUTH-CONFIG-002 session and token durations are bounded", () => {
    const h = accountsHarness();
    for (const sessions of [
      { absoluteLifetimeMs: 1_000 },
      { idleTimeoutMs: 100 * DAY },
      { maxSessionsPerUser: 0 },
      { touchIntervalMs: 0 },
    ]) {
      expect(() => new Accounts({ ...h.config, sessions })).toThrow(AccountsConfigError);
    }
    expect(() => new Accounts({ ...h.config, tokens: { passwordResetTtlMs: 7 * DAY } })).toThrow(
      AccountsConfigError,
    );
  });

  it("TST-AUTH-CONFIG-003 the RFC 9106 production parameters are accepted as production strength", () => {
    expect(
      testHasher(RFC9106_SECOND_RECOMMENDED, { maxConcurrent: 1, maxWaiting: 1 }).strength,
    ).toBe("production");
  });
});

describe("TST-AUTH-STORE store failures", () => {
  it("TST-AUTH-STORE-001 an unreachable store throws to the caller (the transport answers 503) and leaves nothing half-done", async () => {
    const h = accountsHarness();
    const a = await registered(h, "Taher");
    memoryOf(h).failing = true;
    await expect(h.accounts.authenticate(a.session.token)).rejects.toThrow();
    await expect(
      h.accounts.register(
        { username: "other", email: "o@example.test", password: PASSWORD },
        CLIENT,
      ),
    ).rejects.toThrow();
    memoryOf(h).failing = false;
    expect(memoryOf(h).users.size).toBe(1);
    expect(await h.accounts.authenticate(a.session.token)).not.toBeNull();
  });
});
