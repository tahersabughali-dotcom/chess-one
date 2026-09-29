import { afterEach, describe, expect, it } from "vitest";
import { GAME_ID, moveCommand } from "../live-game/support/harness.ts";
import {
  type Closure,
  connect,
  field,
  openClient,
  type TestClient,
} from "../realtime/support/client.ts";
import { commandMessage } from "../realtime/support/edge.ts";
import { store } from "../realtime/support/runtime.ts";
import { DAY, PASSWORD } from "./support/harness.ts";
import {
  type AuthEdge,
  type AuthEdgeOptions,
  authEdge,
  call,
  listening,
  registerOver,
  seatedGame,
  sessionCookie,
  tokenOf,
} from "./support/http.ts";

const CLOSE_WAIT_MS = 2_000;
const open: AuthEdge[] = [];

async function start(
  options: AuthEdgeOptions = {},
): Promise<{ readonly auth: AuthEdge; readonly url: string }> {
  const auth = authEdge(options);
  open.push(auth);
  return { auth, url: await listening(auth) };
}

afterEach(async () => {
  for (const auth of open.splice(0)) {
    await auth.close();
    expect(auth.defects.errors.filter((error) => !String(error).includes("injected"))).toEqual([]);
    expect(auth.runtime.defects.errors).toEqual([]);
  }
});

function withCookie(url: string, cookie: string): Promise<TestClient> {
  return connect(url, { token: null, headers: { cookie } });
}

function closedWithin(client: TestClient, timeoutMs = CLOSE_WAIT_MS): Promise<Closure> {
  return Promise.race([
    client.closed,
    new Promise<Closure>((_resolve, reject) => {
      setTimeout(() => reject(new Error(`socket still open after ${timeoutMs} ms`)), timeoutMs);
    }),
  ]);
}

async function stillOpen(client: TestClient, nonce: string): Promise<void> {
  client.send({ type: "ping", nonce });
  expect(field(await client.next("pong"), "nonce")).toBe(nonce);
  expect(client.isClosed).toBe(false);
}

async function login(auth: AuthEdge, identifier: string): Promise<string> {
  return sessionCookie(
    await call(auth, "POST", "/auth/login", { body: { identifier, password: PASSWORD } }),
  );
}

describe("TST-AUTH-WS the WebSocket handshake trusts only the session cookie", () => {
  it("TST-AUTH-WS-001 a cookie session opens a socket whose actor is the account and whose seats come from game access", async () => {
    const { auth, url } = await start();
    const white = await registerOver(auth, "Whitey");
    const black = await registerOver(auth, "Blacky");
    const game = seatedGame(white.userId, black.userId);
    await store(auth.runtime, game);
    auth.access.seat(game, "white");
    auth.access.seat(game, "black");

    const client = await withCookie(url, white.cookie);
    const ready = await client.hello();
    expect(field(ready, "actorId")).toBe(white.userId);
    expect(field(ready, "games")).toEqual([{ gameId: GAME_ID, seat: "white" }]);
    expect(field(await client.sync(GAME_ID), "snapshot", "sequence")).toBe(0);
    auth.runtime.clock.set(1_500);
    client.send(commandMessage(moveCommand(game, "e2e4"), "mv-1"));
    expect(field(await client.next("command_response"), "response", "code")).toBe("Accepted");
    expect(JSON.stringify(client.received)).not.toMatch(/@|example\.test|whitey@|password/i);
    await client.close();
  });

  it("TST-AUTH-WS-002 no cookie, a bearer token, a malformed or duplicated cookie, or a revoked cookie is refused 401 before upgrade", async () => {
    const { auth, url } = await start();
    const { cookie } = await registerOver(auth, "Taher");
    const token = tokenOf(cookie);
    const attempts = [
      openClient(url, { token: null }),
      openClient(url, { token }),
      openClient(url, { token: null, headers: { cookie: `${cookie}; ${cookie}` } }),
      openClient(url, { token: null, headers: { cookie: `${cookie}; junk` } }),
      openClient(url, { token: null, headers: { cookie: `chess_one_session=${"A".repeat(43)}` } }),
    ];
    for (const attempt of attempts) {
      expect(await attempt).toMatchObject({ kind: "refused", status: 401 });
    }
    expect((await call(auth, "POST", "/auth/logout", { cookie, body: {} })).status).toBe(204);
    expect(await openClient(url, { token: null, headers: { cookie } })).toMatchObject({
      kind: "refused",
      status: 401,
    });
    expect(auth.edge.connectionCount).toBe(0);
  });

  it("TST-AUTH-WS-003 a disabled account cannot open a socket", async () => {
    const { auth, url } = await start();
    const { cookie, userId } = await registerOver(auth, "Taher");
    const row = [...(auth.h.memory?.users.values() ?? [])].find((user) => user.userId === userId);
    if (row === undefined) throw new Error("no user");
    await auth.h.accounts.setAccountStatus(row.userId, "disabled");
    expect(await openClient(url, { token: null, headers: { cookie } })).toMatchObject({
      kind: "refused",
      status: 401,
    });
  });
});

describe("TST-AUTH-WS open sockets end with their session", () => {
  it("TST-AUTH-WS-004 logout closes the open socket at once with 1008 session_ended; other sessions stay open", async () => {
    const { auth, url } = await start();
    const { cookie } = await registerOver(auth, "Taher");
    const other = await login(auth, "taher");
    const a = await withCookie(url, cookie);
    const b = await withCookie(url, other);
    await a.hello();
    await b.hello();
    expect((await call(auth, "POST", "/auth/logout", { cookie, body: {} })).status).toBe(204);
    expect(await closedWithin(a)).toEqual({ code: 1008, reason: "session_ended" });
    await stillOpen(b, "b-alive");
    expect(auth.edge.connectionCount).toBe(1);
    await b.close();
  });

  it("TST-AUTH-WS-005 logout-all, a password change, revoking a session, and disabling the account each close the affected sockets", async () => {
    const { auth, url } = await start();
    const { cookie, userId } = await registerOver(auth, "Taher");
    const spare = await login(auth, "taher");

    const target = await withCookie(url, spare);
    await target.hello();
    const list = await call(auth, "GET", "/auth/sessions", { cookie });
    const sessions = field(list.body, "sessions");
    if (!Array.isArray(sessions)) throw new Error("no sessions");
    const spareId = sessions
      .filter((session) => field(session, "current") === false)
      .map((session) => field(session, "sessionId"))[0];
    expect(
      (await call(auth, "DELETE", `/auth/sessions/${String(spareId)}`, { cookie })).status,
    ).toBe(204);
    expect(await closedWithin(target)).toEqual({ code: 1008, reason: "session_ended" });

    const beforeChange = await withCookie(url, cookie);
    await beforeChange.hello();
    const changed = await call(auth, "POST", "/auth/password", {
      cookie,
      body: { currentPassword: PASSWORD, newPassword: "a brand new passphrase" },
    });
    expect(changed.status).toBe(200);
    expect(await closedWithin(beforeChange)).toEqual({ code: 1008, reason: "session_ended" });

    const rotated = sessionCookie(changed);
    const x = await withCookie(url, rotated);
    await x.hello();
    expect(
      (await call(auth, "POST", "/auth/logout-all", { cookie: rotated, body: {} })).status,
    ).toBe(204);
    expect(await closedWithin(x)).toEqual({ code: 1008, reason: "session_ended" });

    const fresh = sessionCookie(
      await call(auth, "POST", "/auth/login", {
        body: { identifier: "taher", password: "a brand new passphrase" },
      }),
    );
    const y = await withCookie(url, fresh);
    await y.hello();
    const row = [...(auth.h.memory?.users.values() ?? [])].find((user) => user.userId === userId);
    if (row === undefined) throw new Error("no user");
    expect(await auth.h.accounts.setAccountStatus(row.userId, "disabled")).toBe(true);
    expect(await closedWithin(y)).toEqual({ code: 1008, reason: "session_ended" });
    expect(auth.h.accounts.watcherCount).toBe(0);
  });

  it("TST-AUTH-WS-006 the periodic recheck closes a socket whose session was revoked outside this process", async () => {
    const { auth, url } = await start({ limits: { sessionRecheckIntervalMs: 50 } });
    const { cookie, userId } = await registerOver(auth, "Taher");
    const client = await withCookie(url, cookie);
    await client.hello();
    await stillOpen(client, "before");
    for (const session of auth.h.memory?.sessions.values() ?? []) {
      if (session.userId === userId) {
        session.revokedAt = auth.h.clock.now();
        session.reason = "logout";
      }
    }
    expect(await closedWithin(client)).toEqual({ code: 1008, reason: "session_ended" });
  });

  it("TST-AUTH-WS-007 the recheck closes a socket whose session idled out", async () => {
    const { auth, url } = await start({ limits: { sessionRecheckIntervalMs: 50 } });
    const { cookie } = await registerOver(auth, "Taher");
    const client = await withCookie(url, cookie);
    await client.hello();
    auth.h.clock.advance(8 * DAY);
    expect(await closedWithin(client)).toEqual({ code: 1008, reason: "session_ended" });
  });

  it("TST-AUTH-WS-008 a store failure during the recheck closes 1008 session_unverifiable and is reported", async () => {
    const { auth, url } = await start({ limits: { sessionRecheckIntervalMs: 50 } });
    const { cookie } = await registerOver(auth, "Taher");
    const client = await withCookie(url, cookie);
    await client.hello();
    if (auth.h.memory === null) throw new Error("memory");
    auth.h.memory.failing = true;
    expect(await closedWithin(client)).toEqual({ code: 1008, reason: "session_unverifiable" });
    expect(auth.defects.errors.length).toBeGreaterThan(0);
    auth.h.memory.failing = false;
  });

  it("TST-AUTH-WS-009 with the default interval an active socket is not rechecked per message", async () => {
    const { auth, url } = await start();
    const { cookie } = await registerOver(auth, "Taher");
    const client = await withCookie(url, cookie);
    await client.hello();
    if (auth.h.memory === null) throw new Error("memory");
    auth.h.memory.failing = true;
    for (let index = 0; index < 5; index += 1) await stillOpen(client, `n-${index}`);
    auth.h.memory.failing = false;
    await client.close();
  });
});
