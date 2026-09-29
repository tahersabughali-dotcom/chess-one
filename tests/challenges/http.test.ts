import { type ChallengeId, isChallengeId } from "@chess-one/challenge-domain";
import { EdgeConfigError, LOOPBACK_SESSION_COOKIE, resolveEdgeConfig } from "@chess-one/edge";
import { isUserId } from "@chess-one/identity";
import { afterEach, describe, expect, it } from "vitest";
import { call } from "../accounts/support/http.ts";
import { field, ORIGIN } from "../realtime/support/client.ts";
import { DefectLog, RecordingFacts } from "../realtime/support/facts.ts";
import { runtimeHarness } from "../realtime/support/runtime.ts";
import { TestTrustedSessionResolver } from "../realtime/support/sessions.ts";
import { ManualClock } from "../realtime/support/time.ts";
import { challengeHarness, DAY, MINUTE, type Player } from "./support/harness.ts";
import { type ChallengeEdge, challengeEdge, cookieOf, keysOf } from "./support/http.ts";

const open: ChallengeEdge[] = [];

function stack(options: Parameters<typeof challengeEdge>[0] = {}): ChallengeEdge {
  const created = challengeEdge(options);
  open.push(created);
  return created;
}

afterEach(async () => {
  for (const created of open.splice(0)) {
    expect(created.auth.defects.errors).toEqual([]);
    await created.close();
  }
});

const CREATE = {
  opponentUsername: "Bob",
  timeControl: { type: "sudden_death", initialMs: 5 * MINUTE, incrementMs: 0 },
  seatPreference: "random",
};

function idOf(body: unknown): string {
  const id = field(body, "challenge", "challengeId");
  if (typeof id !== "string") throw new Error(`no challenge id in ${JSON.stringify(body)}`);
  return id;
}

async function players(s: ChallengeEdge): Promise<{ alice: Player; bob: Player; mallory: Player }> {
  return {
    alice: await s.h.player("Alice"),
    bob: await s.h.player("Bob"),
    mallory: await s.h.player("Mallory"),
  };
}

async function created(s: ChallengeEdge, from: Player, body: unknown = CREATE): Promise<string> {
  const answer = await call(s.auth, "POST", "/challenges", { cookie: cookieOf(from), body });
  expect(answer.status, answer.text).toBe(201);
  return idOf(answer.body);
}

describe("TST-CHAL-HTTP routes", () => {
  it("TST-CHAL-HTTP-001 create, list, read, decline over HTTP with versioned bodies and no internal ids", async () => {
    const s = stack();
    const { alice, bob } = await players(s);
    const create = await call(s.auth, "POST", "/challenges", {
      cookie: cookieOf(alice),
      body: CREATE,
    });
    expect(create.status).toBe(201);
    expect(field(create.body, "format")).toBe("challenge.v1");
    expect(field(create.body, "challenge")).toMatchObject({
      status: "pending",
      viewerRole: "challenger",
      challenger: { username: "Alice" },
      challenged: { username: "Bob" },
      rulesetId: "FIDE-E01-2023",
      timeControl: { type: "sudden_death", initialMs: 300_000, incrementMs: 0 },
      seatPreference: "random",
      resolvedAt: null,
      createdGameId: null,
    });
    const id = idOf(create.body);

    const incoming = await call(s.auth, "GET", "/challenges?direction=incoming", {
      cookie: cookieOf(bob),
    });
    expect(incoming.status).toBe(200);
    expect(field(incoming.body, "format")).toBe("challenge_page.v1");
    expect(field(incoming.body, "nextCursor")).toBeNull();
    const listed = field(incoming.body, "challenges");
    expect(Array.isArray(listed) && listed.map((item) => field(item, "challengeId"))).toEqual([id]);

    const read = await call(s.auth, "GET", `/challenges/${id}`, { cookie: cookieOf(bob) });
    expect(read.status).toBe(200);
    expect(field(read.body, "challenge", "viewerRole")).toBe("challenged");

    const declined = await call(s.auth, "POST", `/challenges/${id}/decline`, {
      cookie: cookieOf(bob),
      body: {},
    });
    expect(declined.status).toBe(200);
    expect(field(declined.body, "challenge", "status")).toBe("declined");

    for (const answer of [create, incoming, read, declined]) {
      const keys = keysOf(answer.body);
      for (const forbidden of [
        "userId",
        "email",
        "sessionId",
        "status_internal",
        "controlLeaseId",
      ]) {
        expect(keys).not.toContain(forbidden);
      }
      for (const secret of [alice.userId, bob.userId, alice.token, bob.token, "@example.test"]) {
        expect(answer.text).not.toContain(secret);
      }
      expect(answer.headers["cache-control"]).toBe("no-store");
      expect(answer.headers["access-control-allow-origin"]).toBeUndefined();
    }
  });

  it("TST-CHAL-HTTP-002 every route needs a live session: absent, malformed, revoked, or disabled is 401", async () => {
    const s = stack();
    const { alice, bob } = await players(s);
    const id = await created(s, alice);
    const routes: ["GET" | "POST", string, unknown][] = [
      ["POST", "/challenges", CREATE],
      ["GET", "/challenges?direction=incoming", undefined],
      ["GET", `/challenges/${id}`, undefined],
      ["POST", `/challenges/${id}/decline`, {}],
      ["POST", `/challenges/${id}/cancel`, {}],
      ["POST", `/challenges/${id}/accept`, {}],
    ];
    for (const [method, url, body] of routes) {
      const absent = await call(s.auth, method, url, body === undefined ? {} : { body });
      expect(absent.status, `${method} ${url}`).toBe(401);
      expect(absent.body).toEqual({ format: "challenge_error.v1", code: "UNAUTHENTICATED" });
      const stale = await call(s.auth, method, url, {
        cookie: `${LOOPBACK_SESSION_COOKIE}=not-a-real-token`,
        ...(body === undefined ? {} : { body }),
      });
      expect(stale.status).toBe(401);
      expect(stale.setCookie.join(";")).toContain("Max-Age=0");
    }
    await s.h.accounts.accounts.logout(bob.token);
    const revoked = await call(s.auth, "POST", `/challenges/${id}/decline`, {
      cookie: cookieOf(bob),
      body: {},
    });
    expect(revoked.status).toBe(401);
    const aliceId = alice.userId;
    if (!isUserId(aliceId)) throw new Error("user id expected");
    await s.h.accounts.accounts.setAccountStatus(aliceId, "disabled");
    const disabled = await call(s.auth, "POST", `/challenges/${id}/cancel`, {
      cookie: cookieOf(alice),
      body: {},
    });
    expect(disabled.status).toBe(401);
    expect(s.h.memory?.rows.get(idOrThrow(id))?.status).toBe("pending");
  });

  it("TST-CHAL-HTTP-003 the Batch 10 browser protections hold: Origin, Sec-Fetch-Site, JSON media type", async () => {
    const s = stack();
    const { alice } = await players(s);
    const cookie = cookieOf(alice);
    const noOrigin = await call(s.auth, "POST", "/challenges", {
      cookie,
      body: CREATE,
      origin: null,
    });
    expect([noOrigin.status, field(noOrigin.body, "code")]).toEqual([403, "ORIGIN_NOT_ALLOWED"]);
    const foreign = await call(s.auth, "POST", "/challenges", {
      cookie,
      body: CREATE,
      origin: "https://evil.example",
    });
    expect(foreign.status).toBe(403);
    const crossSite = await call(s.auth, "GET", "/challenges?direction=incoming", {
      cookie,
      headers: { "sec-fetch-site": "cross-site" },
    });
    expect([crossSite.status, field(crossSite.body, "code")]).toEqual([403, "ORIGIN_NOT_ALLOWED"]);
    const form = await call(s.auth, "POST", "/challenges", {
      cookie,
      rawBody: "opponentUsername=Bob",
      contentType: "application/x-www-form-urlencoded",
    });
    expect([form.status, field(form.body, "code")]).toEqual([415, "UNSUPPORTED_MEDIA_TYPE"]);
    const plain = await call(s.auth, "POST", "/challenges", {
      cookie,
      rawBody: JSON.stringify(CREATE),
      contentType: "text/plain",
    });
    expect(plain.status).toBe(415);
    expect(
      s.auth.facts
        .named("challenge_request_refused")
        .map((fact) => fact.reason)
        .sort(),
    ).toEqual(["fetch_site", "media_type", "media_type", "origin", "origin"]);
    expect(s.h.memory?.rows.size).toBe(0);
  });

  it("TST-CHAL-HTTP-004 bodies are strict: unknown or missing members, wrong types, duplicates, and oversize are refused", async () => {
    const s = stack();
    const { alice } = await players(s);
    const cookie = cookieOf(alice);
    const invalid: unknown[] = [
      { ...CREATE, challengerUserId: alice.userId },
      { ...CREATE, challengedUserId: alice.userId },
      { ...CREATE, gameId: "g1" },
      { opponentUsername: "Bob", seatPreference: "white" },
      { ...CREATE, timeControl: { ...CREATE.timeControl, initialMs: "300000" } },
      { ...CREATE, timeControl: { ...CREATE.timeControl, extra: 1 } },
      { ...CREATE, timeControl: { type: "sudden_death", initialMs: 300_000 } },
      { ...CREATE, timeControl: null },
      { ...CREATE, opponentUsername: 7 },
      { ...CREATE, rulesetId: 1 },
      [CREATE],
      "Bob",
    ];
    for (const body of invalid) {
      const answer = await call(s.auth, "POST", "/challenges", { cookie, body });
      expect([answer.status, field(answer.body, "code")], JSON.stringify(body)).toEqual([
        400,
        "INVALID_REQUEST",
      ]);
    }
    const duplicate = await call(s.auth, "POST", "/challenges", {
      cookie,
      rawBody:
        '{"opponentUsername":"Bob","opponentUsername":"Carol","seatPreference":"white","timeControl":{"type":"sudden_death","initialMs":300000,"incrementMs":0}}',
    });
    expect(duplicate.status).toBe(400);
    const broken = await call(s.auth, "POST", "/challenges", { cookie, rawBody: "{" });
    expect(broken.status).toBe(400);
    const huge = await call(s.auth, "POST", "/challenges", {
      cookie,
      rawBody: JSON.stringify({ ...CREATE, opponentUsername: "b".repeat(2_000) }),
    });
    expect([huge.status, field(huge.body, "code")]).toEqual([413, "PAYLOAD_TOO_LARGE"]);
    for (const answer of [duplicate, broken, huge]) {
      expect(answer.text).not.toMatch(/stack|Error:|at .*\.ts/);
    }
    expect(s.h.memory?.rows.size).toBe(0);
  });

  it("TST-CHAL-HTTP-005 application errors map to typed codes and statuses", async () => {
    const s = stack({ rateLimit: { burst: 12, refillEveryMs: 60_000 } });
    const { alice, bob } = await players(s);
    const carol = await s.h.player("Carol");
    const post = (body: unknown, who: Player = alice) =>
      call(s.auth, "POST", "/challenges", { cookie: cookieOf(who), body });
    const expectCode = async (
      answer: Promise<{ status: number; body: unknown }>,
      status: number,
      code: string,
    ): Promise<void> => {
      const done = await answer;
      expect([done.status, field(done.body, "code")], code).toEqual([status, code]);
    };
    await expectCode(post({ ...CREATE, opponentUsername: "nobody" }), 404, "PLAYER_NOT_FOUND");
    await expectCode(post({ ...CREATE, opponentUsername: "alice" }), 400, "CANNOT_CHALLENGE_SELF");
    await expectCode(
      post({ ...CREATE, timeControl: { ...CREATE.timeControl, incrementMs: 2_000 } }),
      400,
      "INVALID_TIME_CONTROL",
    );
    await expectCode(post({ ...CREATE, seatPreference: "any" }), 400, "INVALID_SEAT_PREFERENCE");
    await expectCode(post({ ...CREATE, rulesetId: "FIDE-E01-2018" }), 400, "INVALID_RULESET");
    const id = idOf((await post(CREATE)).body);
    await expectCode(post(CREATE), 409, "CHALLENGE_ALREADY_PENDING");
    await expectCode(
      post({ ...CREATE, opponentUsername: "Alice" }, bob),
      409,
      "CHALLENGE_ALREADY_PENDING",
    );
    const carolId = carol.userId;
    if (!isUserId(carolId)) throw new Error("user id expected");
    await s.h.accounts.accounts.setAccountStatus(carolId, "locked");
    await expectCode(post({ ...CREATE, opponentUsername: "Carol" }), 409, "PLAYER_UNAVAILABLE");
    await expectCode(
      call(s.auth, "POST", `/challenges/${id}/decline`, { cookie: cookieOf(alice), body: {} }),
      403,
      "NOT_CHALLENGE_PARTICIPANT",
    );
    const cancelled = await call(s.auth, "POST", `/challenges/${id}/cancel`, {
      cookie: cookieOf(alice),
      body: {},
    });
    expect(field(cancelled.body, "challenge", "status")).toBe("cancelled");
    const cancelledAgainByBob = await call(s.auth, "POST", `/challenges/${id}/decline`, {
      cookie: cookieOf(bob),
      body: {},
    });
    expect([cancelledAgainByBob.status, field(cancelledAgainByBob.body, "code")]).toEqual([
      409,
      "CHALLENGE_NOT_PENDING",
    ]);
    const later = idOf((await post({ ...CREATE, opponentUsername: "Alice" }, bob)).body);
    s.h.accounts.clock.advance(DAY);
    await expectCode(
      call(s.auth, "POST", `/challenges/${later}/decline`, { cookie: cookieOf(alice), body: {} }),
      409,
      "CHALLENGE_EXPIRED",
    );
    for (let index = 0; index < 12; index += 1)
      await post({ ...CREATE, opponentUsername: "nobody" });
    const limited = await post(CREATE);
    expect([limited.status, field(limited.body, "code")]).toEqual([429, "RATE_LIMITED"]);
    expect(limited.headers["retry-after"]).toBe("60");
    expect(field(limited.body, "retryAfterMs")).toBe(60_000);
  });

  it("TST-CHAL-HTTP-006 IDOR: a third user gets the same 404 as for an id that does not exist", async () => {
    const s = stack();
    const { alice, mallory } = await players(s);
    const id = await created(s, alice);
    const unknownId = "AAAAAAAAAAAAAAAAAAAAAA";
    const targets: ["GET" | "POST", string][] = [
      ["GET", `/challenges/${id}`],
      ["GET", `/challenges/${unknownId}`],
      ["GET", "/challenges/not-an-id"],
      ["POST", `/challenges/${id}/decline`],
      ["POST", `/challenges/${id}/cancel`],
      ["POST", `/challenges/${unknownId}/cancel`],
    ];
    const bodies = new Set<string>();
    for (const [method, url] of targets) {
      const answer = await call(s.auth, method, url, {
        cookie: cookieOf(mallory),
        ...(method === "POST" ? { body: {} } : {}),
      });
      expect(answer.status, url).toBe(404);
      bodies.add(answer.text);
    }
    expect([...bodies]).toEqual([
      JSON.stringify({ format: "challenge_error.v1", code: "CHALLENGE_NOT_FOUND" }),
    ]);
    expect(s.h.memory?.rows.get(idOrThrow(id))?.status).toBe("pending");
  });

  it("TST-CHAL-HTTP-007 list parameters: direction required, known names once each, page size 1 to 50, cursor pages", async () => {
    const s = stack();
    const target = await s.h.player("Target");
    for (let index = 0; index < 3; index += 1) {
      const sender = await s.h.player(`Sender${index}`);
      s.h.accounts.clock.advance(1_000);
      await created(s, sender, { ...CREATE, opponentUsername: "Target" });
    }
    const cookie = cookieOf(target);
    for (const query of [
      "",
      "?direction=up",
      "?direction=incoming&direction=outgoing",
      "?direction=incoming&status=pending",
      "?direction=incoming&limit=0",
      "?direction=incoming&limit=51",
      "?direction=incoming&limit=abc",
      "?direction=incoming&limit=1.5",
      "?direction=incoming&cursor=bogus",
    ]) {
      const answer = await call(s.auth, "GET", `/challenges${query}`, { cookie });
      expect([answer.status, field(answer.body, "code")], query).toEqual([400, "INVALID_REQUEST"]);
    }
    const first = await call(s.auth, "GET", "/challenges?direction=incoming&limit=2", { cookie });
    const cursor = field(first.body, "nextCursor");
    expect(typeof cursor).toBe("string");
    const second = await call(
      s.auth,
      "GET",
      `/challenges?direction=incoming&limit=2&cursor=${encodeURIComponent(String(cursor))}`,
      { cookie },
    );
    const names = [first, second].flatMap((answer) => {
      const items = field(answer.body, "challenges");
      return Array.isArray(items) ? items.map((item) => field(item, "challenger", "username")) : [];
    });
    expect(names).toEqual(["Sender2", "Sender1", "Sender0"]);
    expect(field(second.body, "nextCursor")).toBeNull();
  });

  it("TST-CHAL-HTTP-008 decline and cancel carry exactly an empty JSON object", async () => {
    const s = stack();
    const { alice, bob } = await players(s);
    const id = await created(s, alice);
    const noBody = await call(s.auth, "POST", `/challenges/${id}/decline`, {
      cookie: cookieOf(bob),
    });
    expect(noBody.status).toBe(415);
    const extra = await call(s.auth, "POST", `/challenges/${id}/decline`, {
      cookie: cookieOf(bob),
      body: { reason: "busy" },
    });
    expect([extra.status, field(extra.body, "code")]).toEqual([400, "INVALID_REQUEST"]);
    expect(s.h.memory?.rows.get(idOrThrow(id))?.status).toBe("pending");
  });

  it("TST-CHAL-HTTP-009 accept: 200 with the created game awaiting its players; a retry answers the same game", async () => {
    const s = stack();
    const { alice, bob } = await players(s);
    const id = await created(s, alice, { ...CREATE, seatPreference: "white" });
    const accept = await call(s.auth, "POST", `/challenges/${id}/accept`, {
      cookie: cookieOf(bob),
      body: {},
    });
    expect(accept.status, accept.text).toBe(200);
    expect(field(accept.body, "format")).toBe("challenge_accept.v1");
    const gameId = field(accept.body, "game", "gameId");
    expect(typeof gameId).toBe("string");
    expect(field(accept.body, "challenge")).toMatchObject({
      status: "accepted",
      viewerRole: "challenged",
      createdGameId: gameId,
      viewerSeat: "black",
    });
    expect(field(accept.body, "game")).toMatchObject({
      viewerSeat: "black",
      lifecycle: "awaiting_players",
    });
    const stored = s.h.memory?.rows.get(idOrThrow(id));
    expect(field(accept.body, "game", "startDeadlineAt")).toBe(stored?.acceptance?.startDeadlineAt);
    const again = await call(s.auth, "POST", `/challenges/${id}/accept`, {
      cookie: cookieOf(bob),
      body: {},
    });
    expect([again.status, field(again.body, "game", "gameId")]).toEqual([200, gameId]);
    const read = await call(s.auth, "GET", `/challenges/${id}`, { cookie: cookieOf(alice) });
    expect(field(read.body, "challenge")).toMatchObject({
      status: "accepted",
      createdGameId: gameId,
      viewerSeat: "white",
    });
    expect(s.h.fakeGames?.games.size).toBe(1);
    for (const answer of [accept, again, read]) {
      expect(keysOf(answer.body)).not.toContain("userId");
      for (const secret of [alice.userId, bob.userId, alice.token, bob.token]) {
        expect(answer.text).not.toContain(secret);
      }
      expect(answer.headers["cache-control"]).toBe("no-store");
    }
  });

  it("TST-CHAL-HTTP-012 accept while the game is unconfirmed: 202 processing, no game id; the retry completes the same game", async () => {
    const s = stack();
    const { alice, bob } = await players(s);
    const id = await created(s, alice);
    const games = s.h.fakeGames;
    if (games === null) throw new Error("fake games expected");
    games.createFaults.push("stored_unconfirmed");
    games.checkFaults.push("unknown");
    const first = await call(s.auth, "POST", `/challenges/${id}/accept`, {
      cookie: cookieOf(bob),
      body: {},
    });
    expect(first.status, first.text).toBe(202);
    expect(field(first.body, "game")).toBeNull();
    expect(field(first.body, "challenge")).toMatchObject({
      status: "processing",
      createdGameId: null,
      viewerSeat: null,
      resolvedAt: null,
    });
    const reserved = s.h.memory?.rows.get(idOrThrow(id))?.acceptance?.gameId;
    expect(first.text).not.toContain(String(reserved));
    const retry = await call(s.auth, "POST", `/challenges/${id}/accept`, {
      cookie: cookieOf(bob),
      body: {},
    });
    expect([retry.status, field(retry.body, "game", "gameId")]).toEqual([200, reserved]);
    expect(games.games.size).toBe(1);
  });

  it("TST-CHAL-HTTP-013 accept is guarded like every challenge route: session, Origin, media type, empty body, IDOR, roles", async () => {
    const s = stack();
    const { alice, bob, mallory } = await players(s);
    const id = await created(s, alice);
    const url = `/challenges/${id}/accept`;
    const absent = await call(s.auth, "POST", url, { body: {} });
    expect([absent.status, field(absent.body, "code")]).toEqual([401, "UNAUTHENTICATED"]);
    const foreign = await call(s.auth, "POST", url, {
      cookie: cookieOf(bob),
      body: {},
      origin: "https://evil.example",
    });
    expect([foreign.status, field(foreign.body, "code")]).toEqual([403, "ORIGIN_NOT_ALLOWED"]);
    const crossSite = await call(s.auth, "POST", url, {
      cookie: cookieOf(bob),
      body: {},
      headers: { "sec-fetch-site": "cross-site" },
    });
    expect(crossSite.status).toBe(403);
    const noBody = await call(s.auth, "POST", url, { cookie: cookieOf(bob) });
    expect(noBody.status).toBe(415);
    for (const body of [
      { gameId: "game-1" },
      { white: "Bob" },
      { seat: "white" },
      { startDeadlineAt: 1 },
      { rulesetId: "FIDE-E01-2023" },
      [],
    ]) {
      const answer = await call(s.auth, "POST", url, { cookie: cookieOf(bob), body });
      expect([answer.status, field(answer.body, "code")], JSON.stringify(body)).toEqual([
        400,
        "INVALID_REQUEST",
      ]);
    }
    const stranger = await call(s.auth, "POST", url, { cookie: cookieOf(mallory), body: {} });
    const unknown = await call(s.auth, "POST", "/challenges/AAAAAAAAAAAAAAAAAAAAAA/accept", {
      cookie: cookieOf(mallory),
      body: {},
    });
    expect([stranger.status, stranger.text]).toEqual([unknown.status, unknown.text]);
    expect([stranger.status, field(stranger.body, "code")]).toEqual([404, "CHALLENGE_NOT_FOUND"]);
    const own = await call(s.auth, "POST", url, { cookie: cookieOf(alice), body: {} });
    expect([own.status, field(own.body, "code")]).toEqual([403, "NOT_CHALLENGE_PARTICIPANT"]);
    expect(s.h.memory?.rows.get(idOrThrow(id))).toMatchObject({
      status: "pending",
      acceptance: null,
      createdGameId: null,
    });
    expect(s.h.fakeGames?.creates).toBe(0);
  });

  it("TST-CHAL-HTTP-014 accept errors: expired 409, declined 409, player unavailable 409, store outage 503", async () => {
    const s = stack();
    const { alice, bob } = await players(s);
    const carol = await s.h.player("Carol");
    const accept = (id: string, who: Player = bob) =>
      call(s.auth, "POST", `/challenges/${id}/accept`, { cookie: cookieOf(who), body: {} });
    const declinedId = await created(s, alice);
    await call(s.auth, "POST", `/challenges/${declinedId}/decline`, {
      cookie: cookieOf(bob),
      body: {},
    });
    const declined = await accept(declinedId);
    expect([declined.status, field(declined.body, "code")]).toEqual([409, "CHALLENGE_NOT_PENDING"]);
    const outageId = await created(s, alice, { ...CREATE, opponentUsername: "Carol" });
    const memory = s.h.memory;
    if (memory === null) throw new Error("memory store expected");
    memory.failNext = "unavailable";
    const outage = await accept(outageId, carol);
    expect([outage.status, field(outage.body, "code")]).toEqual([503, "TEMPORARILY_UNAVAILABLE"]);
    expect(outage.text).not.toMatch(/08006|sqlstate|store/i);
    const aliceId = alice.userId;
    if (!isUserId(aliceId)) throw new Error("user id expected");
    const lateId = await created(s, bob, { ...CREATE, opponentUsername: "Carol" });
    s.h.accounts.clock.advance(DAY);
    const late = await accept(lateId, carol);
    expect([late.status, field(late.body, "code")]).toEqual([409, "CHALLENGE_EXPIRED"]);
    const lockedId = await created(s, alice, { ...CREATE, opponentUsername: "Carol" });
    await s.h.accounts.accounts.setAccountStatus(aliceId, "locked");
    const unavailable = await accept(lockedId, carol);
    expect([unavailable.status, field(unavailable.body, "code")]).toEqual([
      409,
      "PLAYER_UNAVAILABLE",
    ]);
    expect(s.h.fakeGames?.creates).toBe(0);
  });

  it("TST-CHAL-HTTP-015 a failed acceptance is 409 CHALLENGE_ACCEPT_FAILED with one body whatever the cause, and reads as accept_failed with no game", async () => {
    const s = stack();
    const { alice, bob } = await players(s);
    const games = s.h.fakeGames;
    const memory = s.h.memory;
    if (games === null || memory === null) throw new Error("in-memory stack expected");
    const accept = (id: string, who: Player = bob) =>
      call(s.auth, "POST", `/challenges/${id}/accept`, { cookie: cookieOf(who), body: {} });
    const failures: Awaited<ReturnType<typeof accept>>[] = [];
    const ids: string[] = [];

    const refusedId = await created(s, alice);
    games.createFaults.push("refused");
    failures.push(await accept(refusedId));
    ids.push(refusedId);

    for (const [status, name] of [
      ["disabled", "Dora"],
      ["locked", "Lara"],
    ] satisfies ["disabled" | "locked", string][]) {
      const challenger = await s.h.player(name);
      const challengerId = challenger.userId;
      if (!isUserId(challengerId)) throw new Error("user id expected");
      const id = await created(s, challenger);
      games.createFaults.push("lost");
      const processing = await accept(id);
      expect([processing.status, field(processing.body, "challenge", "status")]).toEqual([
        202,
        "processing",
      ]);
      await s.h.accounts.accounts.setAccountStatus(challengerId, status);
      failures.push(await accept(id));
      ids.push(id);
    }

    const mismatchId = await created(s, alice);
    games.createFaults.push("lost");
    await accept(mismatchId);
    const reserved = memory.rows.get(idOrThrow(mismatchId));
    const acceptance = reserved?.acceptance;
    if (reserved === undefined || acceptance === null || acceptance === undefined) {
      throw new Error("reservation expected");
    }
    games.games.set(acceptance.gameId, {
      gameId: acceptance.gameId,
      white: acceptance.black,
      black: acceptance.white,
      rulesetId: reserved.rulesetId,
      timeControl: reserved.timeControl,
      startDeadlineAt: acceptance.startDeadlineAt,
    });
    failures.push(await accept(mismatchId));
    ids.push(mismatchId);
    expect(s.h.defects.errors).toHaveLength(1);
    s.h.defects.errors.splice(0);

    for (const failure of failures) {
      expect(failure.status, failure.text).toBe(409);
      expect(failure.body).toEqual({
        format: "challenge_error.v1",
        code: "CHALLENGE_ACCEPT_FAILED",
      });
      expect(failure.text).not.toMatch(/disabled|locked|mismatch|sqlstate|08006|intended/i);
    }
    expect(new Set(failures.map((failure) => failure.text)).size).toBe(1);

    for (const id of ids) {
      const stored = memory.rows.get(idOrThrow(id));
      expect(stored?.status).toBe("accept_failed");
      const again = await accept(id);
      expect([again.status, again.text]).toEqual([409, failures[0]?.text]);
      const read = await call(s.auth, "GET", `/challenges/${id}`, { cookie: cookieOf(bob) });
      expect(read.status).toBe(200);
      expect(field(read.body, "challenge")).toMatchObject({
        status: "accept_failed",
        createdGameId: null,
        viewerSeat: null,
        resolvedAt: stored?.resolvedAt,
      });
      expect(read.text).not.toContain(String(stored?.acceptance?.gameId));
      expect(read.text).not.toMatch(/disabled|locked|userId|white|black/i);
      const declined = await call(s.auth, "POST", `/challenges/${id}/decline`, {
        cookie: cookieOf(bob),
        body: {},
      });
      expect([declined.status, field(declined.body, "code")]).toEqual([
        409,
        "CHALLENGE_NOT_PENDING",
      ]);
    }
    expect(games.games.size).toBe(1);
  });

  it("TST-CHAL-HTTP-010 a store outage is 503 TEMPORARILY_UNAVAILABLE with no internal detail", async () => {
    const s = stack();
    const { alice, bob } = await players(s);
    const id = await created(s, alice);
    const memory = s.h.memory;
    if (memory === null) throw new Error("memory store expected");
    memory.failNext = "unavailable";
    const answer = await call(s.auth, "GET", `/challenges/${id}`, { cookie: cookieOf(bob) });
    expect([answer.status, field(answer.body, "code")]).toEqual([503, "TEMPORARILY_UNAVAILABLE"]);
    expect(answer.text).not.toMatch(/08006|sqlstate|store/i);
  });

  it("TST-CHAL-HTTP-011 challenge routes need the auth configuration", async () => {
    const runtime = runtimeHarness();
    expect(() =>
      resolveEdgeConfig({
        environment: "test",
        allowedOrigins: [ORIGIN],
        sessionResolver: new TestTrustedSessionResolver({}),
        writers: runtime.registry,
        clock: new ManualClock(0),
        facts: new RecordingFacts(),
        reportDefect: new DefectLog().report,
        challenges: { challenges: challengeHarness().challenges },
      }),
    ).toThrow(EdgeConfigError);
    await runtime.registry.dispose();
  });
});

function idOrThrow(id: string): ChallengeId {
  if (!isChallengeId(id)) throw new Error("challenge id expected");
  return id;
}
