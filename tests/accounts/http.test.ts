import { afterEach, describe, expect, it } from "vitest";
import { field } from "../realtime/support/client.ts";
import { MINUTE, TEST_ARGON2, testHasher } from "./support/harness.ts";
import {
  type AuthEdge,
  authEdge,
  call,
  registerOver,
  sessionCookie,
  tokenOf,
} from "./support/http.ts";

const PASSWORD = "correct horse battery staple";
const open: AuthEdge[] = [];

function edge(options: Parameters<typeof authEdge>[0] = {}): AuthEdge {
  const created = authEdge(options);
  open.push(created);
  return created;
}

afterEach(async () => {
  for (const auth of open.splice(0)) {
    await auth.close();
    expect(auth.defects.errors.filter((error) => !String(error).includes("injected"))).toEqual([]);
  }
});

function error(code: string, detail: Record<string, unknown> = {}): unknown {
  return { format: "auth_error.v1", code, ...detail };
}

describe("TST-AUTH-HTTP register, login, and the session cookie", () => {
  it("TST-AUTH-HTTP-001 register answers 201 with auth_user.v1 and an HttpOnly SameSite cookie; no token, hash, or email in the body", async () => {
    const auth = edge();
    const answer = await call(auth, "POST", "/auth/register", {
      body: { username: "Taher", email: "Taher@Example.test", password: PASSWORD },
    });
    expect(answer.status).toBe(201);
    expect(answer.body).toEqual({
      format: "auth_user.v1",
      user: {
        userId: field(answer.body, "user", "userId"),
        username: "Taher",
        status: "active",
        emailVerified: false,
      },
    });
    expect(answer.setCookie).toHaveLength(1);
    const [line = ""] = answer.setCookie;
    expect(line).toMatch(
      /^chess_one_session=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=2592000; HttpOnly; SameSite=Lax$/,
    );
    const token = tokenOf(sessionCookie(answer));
    expect(answer.text).not.toContain(token);
    expect(answer.text).not.toMatch(/argon2|example\.test|password|hash|token/i);
  });

  it("TST-AUTH-HTTP-002 every response carries the security headers; none carries CORS headers; HSTS only in production", async () => {
    const auth = edge();
    for (const answer of [
      await call(auth, "POST", "/auth/login", { body: { identifier: "x", password: "y" } }),
      await call(auth, "GET", "/auth/me"),
      await call(auth, "GET", "/auth/nothing"),
      await call(auth, "GET", "/realtime"),
    ]) {
      expect(answer.headers).toMatchObject({
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "x-frame-options": "DENY",
        "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
        "cross-origin-resource-policy": "same-origin",
      });
      expect(
        Object.keys(answer.headers).filter((name) => name.startsWith("access-control-")),
      ).toEqual([]);
      expect(answer.headers["strict-transport-security"]).toBeUndefined();
    }
    const put = await call(auth, "PUT", "/auth/login", { body: {} });
    expect(put.status).toBe(404);
    expect(Object.keys(put.headers).filter((name) => name.startsWith("access-control-"))).toEqual(
      [],
    );
  });

  it("TST-AUTH-HTTP-003 an unknown user and a wrong password get byte-identical 401 answers", async () => {
    const auth = edge();
    await registerOver(auth, "Taher");
    const unknown = await call(auth, "POST", "/auth/login", {
      body: { identifier: "nobody", password: PASSWORD },
    });
    const wrong = await call(auth, "POST", "/auth/login", {
      body: { identifier: "taher", password: "wrong horse battery staple" },
    });
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(error("INVALID_CREDENTIALS"));
    expect(wrong.status).toBe(unknown.status);
    expect(wrong.text).toBe(unknown.text);
    expect(wrong.setCookie).toEqual([]);
  });

  it("TST-AUTH-HTTP-004 login by email sets a fresh cookie; /auth/me answers from the cookie alone", async () => {
    const auth = edge();
    const { cookie: first, userId } = await registerOver(auth, "Taher");
    const login = await call(auth, "POST", "/auth/login", {
      body: { identifier: "TAHER@example.test", password: PASSWORD },
    });
    expect(login.status).toBe(200);
    const second = sessionCookie(login);
    expect(second).not.toBe(first);
    const me = await call(auth, "GET", "/auth/me", { cookie: second });
    expect(me.status).toBe(200);
    expect(me.body).toEqual({
      format: "auth_user.v1",
      user: { userId, username: "Taher", status: "active", emailVerified: false },
    });
    expect(await call(auth, "GET", "/auth/me")).toMatchObject({
      status: 401,
      body: error("UNAUTHENTICATED"),
    });
  });
});

describe("TST-AUTH-HTTP sessions", () => {
  it("TST-AUTH-HTTP-005 logout revokes at once, clears the cookie, and is idempotent", async () => {
    const auth = edge();
    const { cookie } = await registerOver(auth, "Taher");
    const logout = await call(auth, "POST", "/auth/logout", { cookie, body: {} });
    expect(logout.status).toBe(204);
    expect(logout.setCookie).toEqual([
      "chess_one_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
    ]);
    const after = await call(auth, "GET", "/auth/me", { cookie });
    expect(after.status).toBe(401);
    expect(after.setCookie).toEqual([
      "chess_one_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
    ]);
    expect((await call(auth, "POST", "/auth/logout", { cookie, body: {} })).status).toBe(204);
    expect((await call(auth, "POST", "/auth/logout", { body: {} })).status).toBe(204);
  });

  it("TST-AUTH-HTTP-006 logout-all ends every session of the user, the current one included", async () => {
    const auth = edge();
    const { cookie: a } = await registerOver(auth, "Taher");
    const b = sessionCookie(
      await call(auth, "POST", "/auth/login", {
        body: { identifier: "taher", password: PASSWORD },
      }),
    );
    expect((await call(auth, "POST", "/auth/logout-all", { cookie: b, body: {} })).status).toBe(
      204,
    );
    expect((await call(auth, "GET", "/auth/me", { cookie: a })).status).toBe(401);
    expect((await call(auth, "GET", "/auth/me", { cookie: b })).status).toBe(401);
    expect((await call(auth, "POST", "/auth/logout-all", { body: {} })).status).toBe(401);
  });

  it("TST-AUTH-HTTP-007 the session list is auth_sessions.v1 with the current session marked; revoking another user's session is 404 (IDOR)", async () => {
    const auth = edge();
    const { cookie: mine } = await registerOver(auth, "Taher");
    const spare = sessionCookie(
      await call(auth, "POST", "/auth/login", {
        body: { identifier: "taher", password: PASSWORD },
      }),
    );
    const { cookie: theirs } = await registerOver(auth, "Victim");
    const list = await call(auth, "GET", "/auth/sessions", { cookie: mine });
    expect(list.status).toBe(200);
    expect(field(list.body, "format")).toBe("auth_sessions.v1");
    const sessions = field(list.body, "sessions");
    if (!Array.isArray(sessions)) throw new Error("no sessions");
    expect(sessions).toHaveLength(2);
    for (const session of sessions) {
      expect(Object.keys(session).sort()).toEqual([
        "createdAt",
        "current",
        "lastSeenAt",
        "sessionId",
      ]);
    }
    const current = sessions.filter((session) => field(session, "current") === true);
    expect(current).toHaveLength(1);
    const victimList = await call(auth, "GET", "/auth/sessions", { cookie: theirs });
    const victimSessions = field(victimList.body, "sessions");
    const victimId = Array.isArray(victimSessions) ? field(victimSessions[0], "sessionId") : null;
    expect(
      await call(auth, "DELETE", `/auth/sessions/${String(victimId)}`, { cookie: mine }),
    ).toMatchObject({ status: 404, body: error("NOT_FOUND") });
    expect((await call(auth, "GET", "/auth/me", { cookie: theirs })).status).toBe(200);
    const spareId = sessions
      .map((session) => field(session, "sessionId"))
      .find((id) => id !== field(current[0], "sessionId"));
    expect(
      (await call(auth, "DELETE", `/auth/sessions/${String(spareId)}`, { cookie: mine })).status,
    ).toBe(204);
    expect((await call(auth, "GET", "/auth/me", { cookie: spare })).status).toBe(401);
    const own = await call(
      auth,
      "DELETE",
      `/auth/sessions/${String(field(current[0], "sessionId"))}`,
      {
        cookie: mine,
      },
    );
    expect(own.status).toBe(204);
    expect(own.setCookie).toHaveLength(1);
    expect((await call(auth, "GET", "/auth/me", { cookie: mine })).status).toBe(401);
  });

  it("TST-AUTH-HTTP-008 a password change needs the current password, rotates the session, and ends all others", async () => {
    const auth = edge();
    const { cookie } = await registerOver(auth, "Taher");
    const other = sessionCookie(
      await call(auth, "POST", "/auth/login", {
        body: { identifier: "taher", password: PASSWORD },
      }),
    );
    expect(
      await call(auth, "POST", "/auth/password", {
        cookie,
        body: { currentPassword: "not my password", newPassword: "brand new passphrase" },
      }),
    ).toMatchObject({ status: 403, body: error("INVALID_CREDENTIALS") });
    const changed = await call(auth, "POST", "/auth/password", {
      cookie,
      body: { currentPassword: PASSWORD, newPassword: "brand new passphrase" },
    });
    expect(changed.status).toBe(200);
    const rotated = sessionCookie(changed);
    expect(rotated).not.toBe(cookie);
    expect((await call(auth, "GET", "/auth/me", { cookie })).status).toBe(401);
    expect((await call(auth, "GET", "/auth/me", { cookie: other })).status).toBe(401);
    expect((await call(auth, "GET", "/auth/me", { cookie: rotated })).status).toBe(200);
  });

  it("TST-AUTH-HTTP-009 a disabled account: the right password gets 403 ACCOUNT_UNAVAILABLE, its cookie gets 401", async () => {
    const auth = edge();
    const { cookie, userId } = await registerOver(auth, "Taher");
    const user = [...(auth.h.memory?.users.values() ?? [])].find((row) => row.userId === userId);
    if (user === undefined) throw new Error("no user");
    await auth.h.accounts.setAccountStatus(user.userId, "disabled");
    expect((await call(auth, "GET", "/auth/me", { cookie })).status).toBe(401);
    expect(
      await call(auth, "POST", "/auth/login", {
        body: { identifier: "taher", password: PASSWORD },
      }),
    ).toMatchObject({ status: 403, body: error("ACCOUNT_UNAVAILABLE") });
    expect(
      await call(auth, "POST", "/auth/login", {
        body: { identifier: "taher", password: "wrong horse battery staple" },
      }),
    ).toMatchObject({ status: 401, body: error("INVALID_CREDENTIALS") });
  });
});

describe("TST-AUTH-HTTP CSRF, origin, and input handling", () => {
  it("TST-AUTH-HTTP-010 state changes need an allowlisted Origin and a JSON body; cross-site fetch metadata is refused", async () => {
    const auth = edge();
    const { cookie } = await registerOver(auth, "Taher");
    const login = { identifier: "taher", password: PASSWORD };
    expect(await call(auth, "POST", "/auth/login", { body: login, origin: null })).toMatchObject({
      status: 403,
      body: error("ORIGIN_NOT_ALLOWED"),
    });
    expect(
      await call(auth, "POST", "/auth/logout", { cookie, body: {}, origin: "http://evil.test" }),
    ).toMatchObject({ status: 403 });
    expect((await call(auth, "GET", "/auth/me", { cookie })).status).toBe(200);
    expect(
      await call(auth, "POST", "/auth/login", {
        rawBody: "identifier=taher&password=x",
        contentType: "application/x-www-form-urlencoded",
      }),
    ).toMatchObject({ status: 415, body: error("UNSUPPORTED_MEDIA_TYPE") });
    expect(
      await call(auth, "POST", "/auth/login", {
        rawBody: JSON.stringify(login),
        contentType: "text/plain",
      }),
    ).toMatchObject({ status: 415 });
    expect(
      await call(auth, "GET", "/auth/me", { cookie, headers: { "sec-fetch-site": "cross-site" } }),
    ).toMatchObject({ status: 403, body: error("ORIGIN_NOT_ALLOWED") });
    expect(
      await call(auth, "DELETE", "/auth/sessions/x", { cookie, origin: "null" }),
    ).toMatchObject({ status: 403 });
    expect(auth.facts.named("auth_request_refused")).toEqual([
      { name: "auth_request_refused", reason: "origin" },
      { name: "auth_request_refused", reason: "origin" },
      { name: "auth_request_refused", reason: "media_type" },
      { name: "auth_request_refused", reason: "media_type" },
      { name: "auth_request_refused", reason: "fetch_site" },
      { name: "auth_request_refused", reason: "origin" },
    ]);
    expect((await call(auth, "GET", "/auth/me", { cookie })).status).toBe(200);
  });

  it("TST-AUTH-HTTP-011 bodies are strict flat JSON with exactly the expected string members", async () => {
    const auth = edge();
    const bad = [
      '{"identifier":"taher","identifier":"x","password":"y"}',
      '{"identifier":"taher","password":"correct horse battery staple","userId":"x"}',
      '{"identifier":"taher","__proto__":"x"}',
      '{"identifier":"taher","password":12345678901234}',
      '{"identifier":{"a":1},"password":"x"}',
      '["taher","x"]',
      '{"identifier":"taher",',
      "",
      "null",
    ];
    for (const rawBody of bad) {
      expect(
        await call(auth, "POST", "/auth/login", { rawBody, contentType: "application/json" }),
        rawBody,
      ).toMatchObject({ status: 400, body: error("INVALID_REQUEST") });
    }
    const huge = JSON.stringify({ identifier: "taher", password: "x".repeat(9_000) });
    expect(await call(auth, "POST", "/auth/login", { rawBody: huge })).toMatchObject({
      status: 413,
      body: error("PAYLOAD_TOO_LARGE"),
    });
  });

  it("TST-AUTH-HTTP-012 validation failures name the field and policy code; taken names are 409", async () => {
    const auth = edge();
    await registerOver(auth, "Taher");
    const register = (username: string, email: string, password = PASSWORD) =>
      call(auth, "POST", "/auth/register", { body: { username, email, password } });
    expect(await register("ab", "a@example.test")).toMatchObject({
      status: 400,
      body: error("VALIDATION_FAILED", { field: "username", reason: "too_short" }),
    });
    expect(await register("valid", "a@example.test", "short")).toMatchObject({
      status: 400,
      body: error("VALIDATION_FAILED", { field: "password", reason: "too_short" }),
    });
    expect(await register("valid", "a@example.test", "fourteen chars")).toMatchObject({
      status: 400,
      body: error("VALIDATION_FAILED", { field: "password", reason: "too_short" }),
    });
    expect(await register("valid", "a@example.test", "x".repeat(257))).toMatchObject({
      status: 400,
      body: error("VALIDATION_FAILED", { field: "password", reason: "too_long" }),
    });
    expect(await register("TAHER", "b@example.test")).toMatchObject({
      status: 409,
      body: error("USERNAME_UNAVAILABLE"),
    });
    const emailTaken = await register("Other", "TAHER@example.test");
    expect(emailTaken.status).toBe(409);
    expect(emailTaken.body).toEqual(error("EMAIL_UNAVAILABLE"));
    expect(await register("valid", "a@example.test", "fifteen letters")).toMatchObject({
      status: 201,
    });
  });

  it("TST-AUTH-HTTP-013 cookies are the only credential: duplicate or malformed session cookies and bearer tokens are refused", async () => {
    const auth = edge();
    const { cookie } = await registerOver(auth, "Taher");
    const token = tokenOf(cookie);
    expect((await call(auth, "GET", "/auth/me", { cookie: `${cookie}; ${cookie}` })).status).toBe(
      401,
    );
    expect((await call(auth, "GET", "/auth/me", { cookie: `${cookie}; junk` })).status).toBe(401);
    expect(
      (await call(auth, "GET", "/auth/me", { headers: { authorization: `Bearer ${token}` } }))
        .status,
    ).toBe(401);
    expect(auth.facts.named("auth_request_refused")).toEqual([
      { name: "auth_request_refused", reason: "malformed_cookie" },
      { name: "auth_request_refused", reason: "malformed_cookie" },
    ]);
  });

  it("TST-AUTH-HTTP-014 rate limits answer 429 with Retry-After; a saturated hasher answers 503 SERVICE_BUSY", async () => {
    const limited = edge({ rateLimits: { client_address: { burst: 2, refillEveryMs: 2_000 } } });
    const attempt = () =>
      call(limited, "POST", "/auth/login", { body: { identifier: "taher", password: PASSWORD } });
    await attempt();
    await attempt();
    const refused = await attempt();
    expect(refused.status).toBe(429);
    expect(refused.headers["retry-after"]).toBe("2");
    expect(refused.body).toEqual(error("RATE_LIMITED", { retryAfterMs: 2_000 }));

    const slow = { ...TEST_ARGON2, memoryKiB: 32_768, passes: 2 };
    const busy = edge({ hasher: testHasher(slow, { maxConcurrent: 1, maxWaiting: 1 }) });
    const answers = await Promise.all(
      ["aaa", "bbb", "ccc", "ddd", "eee", "fff"].map((username) =>
        call(busy, "POST", "/auth/register", {
          body: { username, email: `${username}@example.test`, password: PASSWORD },
        }),
      ),
    );
    const statuses = answers.map((answer) => answer.status);
    expect(statuses).toContain(201);
    expect(statuses).toContain(503);
    expect(statuses.every((status) => status === 201 || status === 503)).toBe(true);
    const overloaded = answers.find((answer) => answer.status === 503);
    expect(overloaded?.body).toEqual(error("SERVICE_BUSY"));
    expect(overloaded?.headers["retry-after"]).toBe("1");
  });

  it("TST-AUTH-HTTP-015 a store failure is 503 SERVICE_UNAVAILABLE with no internal detail, and it is reported", async () => {
    const auth = edge();
    const { cookie } = await registerOver(auth, "Taher");
    if (auth.h.memory === null) throw new Error("memory");
    auth.h.memory.failing = true;
    for (const answer of [
      await call(auth, "GET", "/auth/me", { cookie }),
      await call(auth, "POST", "/auth/login", {
        body: { identifier: "taher", password: PASSWORD },
      }),
    ]) {
      expect(answer.status).toBe(503);
      expect(answer.body).toEqual(error("SERVICE_UNAVAILABLE"));
      expect(answer.text).not.toMatch(/sqlstate|relation|user_sessions|repository|stack|08006/i);
    }
    expect(auth.defects.errors).toHaveLength(2);
  });

  it("TST-AUTH-HTTP-016 unknown routes and methods are 404 auth_error.v1", async () => {
    const auth = edge();
    expect(await call(auth, "GET", "/auth/login")).toMatchObject({
      status: 404,
      body: error("NOT_FOUND"),
    });
    expect(await call(auth, "POST", "/auth/admin", { body: {} })).toMatchObject({ status: 404 });
  });
});

describe("TST-AUTH-HTTP recovery routes", () => {
  it("TST-AUTH-HTTP-017 reset request is 202 for known and unknown addresses alike; the token resets once", async () => {
    const auth = edge();
    const { cookie } = await registerOver(auth, "Taher");
    const known = await call(auth, "POST", "/auth/password-reset/request", {
      body: { email: "taher@example.test" },
    });
    const unknown = await call(auth, "POST", "/auth/password-reset/request", {
      body: { email: "ghost@example.test" },
    });
    expect([known.status, unknown.status]).toEqual([202, 202]);
    expect(unknown.text).toBe(known.text);
    const { token } = auth.h.delivery.last("password_reset");
    const confirm = () =>
      call(auth, "POST", "/auth/password-reset/confirm", {
        body: { token, newPassword: "reset passphrase ok" },
      });
    expect((await confirm()).status).toBe(204);
    expect(await confirm()).toMatchObject({ status: 400, body: error("INVALID_TOKEN") });
    expect((await call(auth, "GET", "/auth/me", { cookie })).status).toBe(401);
    auth.h.clock.advance(MINUTE);
    expect(
      (
        await call(auth, "POST", "/auth/login", {
          body: { identifier: "taher", password: "reset passphrase ok" },
        })
      ).status,
    ).toBe(200);
  });

  it("TST-AUTH-HTTP-018 email verification needs a session to request and a token to confirm", async () => {
    const auth = edge();
    const { cookie } = await registerOver(auth, "Taher");
    expect(
      (await call(auth, "POST", "/auth/email-verification/request", { body: {} })).status,
    ).toBe(401);
    expect(
      (await call(auth, "POST", "/auth/email-verification/request", { cookie, body: {} })).status,
    ).toBe(202);
    const { token } = auth.h.delivery.last("email_verification");
    expect(
      (await call(auth, "POST", "/auth/email-verification/confirm", { body: { token } })).status,
    ).toBe(204);
    expect(
      field((await call(auth, "GET", "/auth/me", { cookie })).body, "user", "emailVerified"),
    ).toBe(true);
    expect(
      await call(auth, "POST", "/auth/email-verification/request", { cookie, body: {} }),
    ).toMatchObject({ status: 409, body: error("ALREADY_VERIFIED") });
  });

  it("TST-AUTH-HTTP-019 without a delivery sink, recovery routes answer 501 FEATURE_UNAVAILABLE", async () => {
    const auth = edge({ delivery: false });
    expect(
      await call(auth, "POST", "/auth/password-reset/request", {
        body: { email: "a@example.test" },
      }),
    ).toMatchObject({ status: 501, body: error("FEATURE_UNAVAILABLE") });
  });
});
