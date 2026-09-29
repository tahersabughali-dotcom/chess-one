import { isUserId, type UserId } from "@chess-one/identity";
import { RESIGN_GAME_COMMAND_V1 } from "@chess-one/live-game";
import type { ControlLeaseId, Seat } from "@chess-one/live-game-runtime";
import { describe, expect, it } from "vitest";
import { GAME_ID, OTHER_GAME_ID } from "../live-game/support/harness.ts";
import { field, openClient, type TestClient } from "../realtime/support/client.ts";
import { storedState } from "../realtime/support/runtime.ts";
import { memoryOf } from "./support/harness.ts";
import {
  type AccessStack,
  type AccessStackOptions,
  accessStack,
  assign,
  claimDenied,
  claimGranted,
  claimMessage,
  expectNoDefects,
  logIn,
  logOut,
  moveMessage,
  signUp,
  socketOf,
} from "./support/stack.ts";

async function withStack(
  options: AccessStackOptions,
  run: (stack: AccessStack) => Promise<void>,
): Promise<void> {
  const stack = await accessStack(options);
  try {
    await run(stack);
  } finally {
    await stack.close();
  }
  expectNoDefects(stack);
}

interface Players {
  readonly whiteId: string;
  readonly blackId: string;
  readonly whiteCookie: string;
  readonly blackCookie: string;
}

async function players(stack: AccessStack): Promise<Players> {
  const whiteId = await signUp(stack, "Whitey");
  const blackId = await signUp(stack, "Blacky");
  await assign(stack, whiteId, blackId);
  return {
    whiteId,
    blackId,
    whiteCookie: await logIn(stack, "whitey"),
    blackCookie: await logIn(stack, "blacky"),
  };
}

function lease(stack: AccessStack, seat: Seat): ControlLeaseId {
  const record = memoryOf(stack.ga).control(GAME_ID, seat);
  if (record === undefined) throw new Error("no control record");
  return record.controlLeaseId;
}

function tokenOf(cookie: string): string {
  return cookie.slice(cookie.indexOf("=") + 1);
}

async function response(client: TestClient): Promise<unknown> {
  return field(await client.next("command_response"), "response");
}

async function failure(client: TestClient): Promise<unknown> {
  return await client.next("request_failed");
}

/** The stored original, unchanged but for the replay flag. */
function expectReplayOf(original: unknown, replayed: unknown): void {
  if (typeof original !== "object" || original === null) throw new Error("no response");
  expect(field(original, "replayed")).toBe(false);
  expect(replayed).toEqual({ ...original, replayed: true });
}

describe("TST-GACC-EDGE seat control over the real edge (production resolver, real game access)", () => {
  it("TST-GACC-EDGE-001 claim_game_control grants the seat; snapshots show control, never a lease or session", async () => {
    await withStack({}, async (stack) => {
      const p = await players(stack);
      const white = await socketOf(stack, p.whiteCookie);
      const before = field(await white.sync(GAME_ID), "snapshot");
      expect(field(before, "seat")).toBe("white");
      expect(field(before, "controlHeld")).toBe(false);
      expect(field(before, "canClaimControl")).toBe(true);
      const granted = await claimGranted(white, "claim-1");
      expect(granted).toEqual({
        type: "control_granted",
        requestId: "claim-1",
        gameId: GAME_ID,
        seat: "white",
      });
      const after = field(await white.sync(GAME_ID, "sync-2"), "snapshot");
      expect(field(after, "controlHeld")).toBe(true);
      expect(field(after, "canClaimControl")).toBe(false);
      const wire = JSON.stringify(white.received);
      for (const secret of [
        lease(stack, "white"),
        lease(stack, "black"),
        tokenOf(p.whiteCookie),
        p.blackId,
      ]) {
        expect(wire).not.toContain(secret);
      }
      expect(wire).not.toMatch(/session|lease|version|example\.test/i);
      expect(stack.facts.named("control_claim")).toEqual([
        { name: "control_claim", gameId: GAME_ID, outcome: "granted" },
      ]);
      await white.close();
    });
  });

  it("TST-GACC-EDGE-002 a command without control is never admitted: only a read-only lookup, no stamp, clock, sequence, or binding", async () => {
    await withStack({}, async (stack) => {
      const p = await players(stack);
      const white = await socketOf(stack, p.whiteCookie);
      await white.sync(GAME_ID);
      const before = await storedState(stack.ga.runtime);
      stack.ga.runtime.clock.advance(7_000);
      white.send(moveMessage("mv-1", "w-1", 0, "e2e4"));
      expect(await failure(white)).toEqual({
        type: "request_failed",
        requestId: "mv-1",
        code: "CONTROL_NOT_HELD",
        retryable: false,
        clientCommandId: "w-1",
      });
      expect(stack.ga.runtime.registry.peek(GAME_ID)?.queuedRequests).toBe(0);
      expect(stack.ga.runtime.facts.count("command_refused_control")).toBe(1);
      expect(stack.ga.runtime.facts.count("command_replayed")).toBe(0);
      expect(stack.facts.count("command_refused_control")).toBe(1);
      expect(stack.facts.count("command_submitted")).toBe(0);
      expect(stack.ga.runtime.repository.commits).toBe(0);
      expect(await storedState(stack.ga.runtime)).toEqual(before);
      await claimGranted(white, "claim-1");
      white.send(moveMessage("mv-2", "w-1", 0, "e2e4"));
      expect(field(await response(white), "code")).toBe("Accepted");
      await white.close();
    });
  });

  it("TST-GACC-EDGE-003 a second session syncs without control, takes it only by claiming; the first is told and refused", async () => {
    await withStack({}, async (stack) => {
      const p = await players(stack);
      const a = await socketOf(stack, p.whiteCookie);
      await a.sync(GAME_ID);
      await claimGranted(a, "claim-a");
      const leaseA = lease(stack, "white");
      a.send(moveMessage("mv-a1", "x", 0, "e2e4"));
      expect(field(await response(a), "code")).toBe("Accepted");

      const b = await socketOf(stack, await logIn(stack, "whitey"));
      const synced = field(await b.sync(GAME_ID), "snapshot");
      expect(field(synced, "controlHeld")).toBe(false);
      expect(field(synced, "sequence")).toBe(1);
      b.send(moveMessage("mv-b0", "early", 1, "d2d4"));
      expect(field(await failure(b), "code")).toBe("CONTROL_NOT_HELD");

      await claimGranted(b, "claim-b");
      expect(lease(stack, "white")).not.toBe(leaseA);
      expect(await a.next("control_revoked")).toEqual({
        type: "control_revoked",
        gameId: GAME_ID,
        seat: "white",
        code: "CONTROL_TRANSFERRED",
      });
      expect(a.unread("control_granted")).toEqual([]);
      const black = await socketOf(stack, p.blackCookie);
      await black.sync(GAME_ID);
      await claimGranted(black, "claim-black");
      black.send(moveMessage("mv-k1", "k1", 1, "e7e5"));
      expect(field(await response(black), "code")).toBe("Accepted");

      const commits = stack.ga.runtime.repository.commits;
      a.send(moveMessage("mv-a2", "y", 2, "g1f3"));
      expect(field(await failure(a), "code")).toBe("CONTROL_NOT_HELD");
      expect(stack.ga.runtime.facts.count("command_accepted")).toBe(2);
      expect(stack.ga.runtime.repository.commits).toBe(commits);

      b.send(moveMessage("mv-b1", "y", 2, "g1f3"));
      expect(field(await response(b), "code")).toBe("Accepted");
      expect((await storedState(stack.ga.runtime)).sequence).toBe(3);
      await Promise.all([a.close(), b.close(), black.close()]);
    });
  });

  it("TST-GACC-EDGE-004 replay after transfer on the same connection: the exact resend gets the stored answer; an altered one is an identity conflict; a new one is refused; nothing changes", async () => {
    await withStack({}, async (stack) => {
      const p = await players(stack);
      const a = await socketOf(stack, p.whiteCookie);
      await a.sync(GAME_ID);
      await claimGranted(a, "claim-a");
      a.send(moveMessage("mv-x", "X", 0, "e2e4"));
      const original = await response(a);
      expect(field(original, "code")).toBe("Accepted");

      const b = await socketOf(stack, await logIn(stack, "whitey"));
      await b.sync(GAME_ID);
      await claimGranted(b, "claim-b");
      await a.next("control_revoked");
      const before = await storedState(stack.ga.runtime);
      const commits = stack.ga.runtime.repository.commits;
      const wakes = stack.ga.runtime.scheduler.pending().length;
      stack.ga.runtime.clock.advance(6_000);

      a.send(moveMessage("mv-x-again", "X", 0, "e2e4"));
      const replayed = await response(a);
      expectReplayOf(original, replayed);
      a.send(moveMessage("mv-x-altered", "X", 0, "d2d4"));
      expect(await failure(a)).toEqual({
        type: "request_failed",
        requestId: "mv-x-altered",
        code: "INVALID_COMMAND_IDENTITY",
        retryable: false,
        clientCommandId: "X",
      });
      a.send(moveMessage("mv-y", "Y", 1, "d2d4"));
      expect(field(await failure(a), "code")).toBe("CONTROL_NOT_HELD");
      expect(stack.ga.runtime.repository.commits).toBe(commits);
      expect(await storedState(stack.ga.runtime)).toEqual(before);
      expect(stack.ga.runtime.scheduler.pending().length).toBe(wakes);
      expect(stack.ga.runtime.facts.count("command_replayed")).toBe(1);
      expect(stack.ga.runtime.facts.count("replay_identity_conflict")).toBe(1);
      expect(field(await a.sync(GAME_ID, "sync-a"), "snapshot", "controlHeld")).toBe(false);
      expect(JSON.stringify(a.received)).not.toMatch(/lease|fingerprint/i);

      const black = await socketOf(stack, p.blackCookie);
      await black.sync(GAME_ID);
      await claimGranted(black, "claim-k");
      black.send(moveMessage("mv-k", "K", 1, "e7e5"));
      expect(field(await response(black), "code")).toBe("Accepted");
      b.send(moveMessage("mv-b-y", "Y", 2, "g1f3"));
      expect(field(await response(b), "code")).toBe("Accepted");
      const state = await storedState(stack.ga.runtime);
      expect(state.sequence).toBe(3);
      expect(state.commandBindings.map((binding) => binding.clientCommandId)).toEqual([
        "X",
        "K",
        "Y",
      ]);
      await Promise.all([a.close(), b.close(), black.close()]);
    });
  });

  it("TST-GACC-EDGE-010 replay survives the connection: the same session reconnects and gets the stored answer without control", async () => {
    await withStack({}, async (stack) => {
      const p = await players(stack);
      const a = await socketOf(stack, p.whiteCookie);
      await claimGranted(a, "claim-a");
      a.send(moveMessage("mv-x", "X", 0, "e2e4"));
      const original = await response(a);
      const b = await socketOf(stack, await logIn(stack, "whitey"));
      await claimGranted(b, "claim-b");
      await a.next("control_revoked");
      await a.close();
      const commits = stack.ga.runtime.repository.commits;

      const again = await socketOf(stack, p.whiteCookie);
      again.send(moveMessage("mv-x-again", "X", 0, "e2e4"));
      expectReplayOf(original, await response(again));
      again.send(moveMessage("mv-x-altered", "X", 0, "e2e3"));
      expect(field(await failure(again), "code")).toBe("INVALID_COMMAND_IDENTITY");
      again.send(moveMessage("mv-y", "Y", 1, "d2d4"));
      expect(field(await failure(again), "code")).toBe("CONTROL_NOT_HELD");
      expect(field(await again.sync(GAME_ID), "snapshot", "controlHeld")).toBe(false);
      expect(stack.ga.runtime.repository.commits).toBe(commits);
      expect((await storedState(stack.ga.runtime)).commandBindings).toHaveLength(1);
      expect(b.unread("control_revoked")).toEqual([]);

      await logOut(stack, p.whiteCookie);
      expect(await again.closed).toEqual({ code: 1008, reason: "session_ended" });
      expect(
        await openClient(stack.ws, { token: null, headers: { cookie: p.whiteCookie } }),
      ).toMatchObject({ kind: "refused", status: 401 });
      await b.close();
    });
  });

  it("TST-GACC-EDGE-011 a new session of the same user replays the seat's bound commands, and gains no command authority", async () => {
    await withStack({}, async (stack) => {
      const p = await players(stack);
      const a = await socketOf(stack, p.whiteCookie);
      await claimGranted(a, "claim-a");
      a.send(moveMessage("mv-x", "X", 0, "e2e4"));
      const original = await response(a);
      const b = await socketOf(stack, await logIn(stack, "whitey"));
      await claimGranted(b, "claim-b");
      await a.next("control_revoked");
      await logOut(stack, p.whiteCookie);
      expect(await a.closed).toEqual({ code: 1008, reason: "session_ended" });
      await stack.ga.access.settled();

      const c = await socketOf(stack, await logIn(stack, "whitey"));
      const before = await storedState(stack.ga.runtime);
      const control = memoryOf(stack.ga).control(GAME_ID, "white");
      expect(control?.controllingSessionId).not.toBeNull();
      c.send(moveMessage("mv-x-c", "X", 0, "e2e4"));
      expectReplayOf(original, await response(c));
      c.send(moveMessage("mv-y-c", "Y", 1, "d2d4"));
      expect(field(await failure(c), "code")).toBe("CONTROL_NOT_HELD");
      expect(await storedState(stack.ga.runtime)).toEqual(before);
      expect(memoryOf(stack.ga).control(GAME_ID, "white")).toEqual(control);
      expect(b.unread("control_revoked")).toEqual([]);
      await Promise.all([b.close(), c.close()]);
    });
  });

  it("TST-GACC-EDGE-012 the opponent and a third user never read a seat's stored answers", async () => {
    await withStack({}, async (stack) => {
      const p = await players(stack);
      const white = await socketOf(stack, p.whiteCookie);
      await claimGranted(white, "claim-w");
      white.send(moveMessage("mv-x", "X", 0, "e2e4"));
      const original = await response(white);
      await signUp(stack, "Mallory");
      const mallory = await socketOf(stack, await logIn(stack, "mallory"));
      const black = await socketOf(stack, p.blackCookie);
      const before = await storedState(stack.ga.runtime);

      black.send(moveMessage("mv-x-black", "X", 0, "e2e4"));
      expect(await failure(black)).toEqual({
        type: "request_failed",
        requestId: "mv-x-black",
        code: "CONTROL_NOT_HELD",
        retryable: false,
        clientCommandId: "X",
      });
      const otherSession = await socketOf(stack, await logIn(stack, "blacky"));
      otherSession.send(moveMessage("mv-x-black-2", "X", 0, "e2e4"));
      expect(field(await failure(otherSession), "code")).toBe("CONTROL_NOT_HELD");
      mallory.send(moveMessage("mv-x-mallory", "X", 0, "e2e4"));
      expect(await failure(mallory)).toEqual({
        type: "request_failed",
        requestId: "mv-x-mallory",
        code: "GAME_ACCESS_DENIED",
        retryable: false,
        clientCommandId: "X",
      });
      expect(field(original, "code")).toBe("Accepted");
      for (const client of [black, otherSession, mallory]) {
        expect(client.unread("command_response")).toEqual([]);
        expect(JSON.stringify(client.received)).not.toMatch(/"replayed"|"command_response"/);
      }
      expect(stack.ga.runtime.facts.count("command_replayed")).toBe(0);
      expect(await storedState(stack.ga.runtime)).toEqual(before);
      await Promise.all([white.close(), black.close(), otherSession.close(), mallory.close()]);
    });
  });

  it("TST-GACC-EDGE-013 the current controller replays a command bound under a former lease and an altered one is INVALID_COMMAND_IDENTITY, both never received; a new one plays (GACC-016)", async () => {
    await withStack({}, async (stack) => {
      const p = await players(stack);
      const a = await socketOf(stack, p.whiteCookie);
      await claimGranted(a, "claim-a");
      a.send(moveMessage("mv-x", "X", 0, "e2e4"));
      const original = await response(a);
      const b = await socketOf(stack, await logIn(stack, "whitey"));
      await claimGranted(b, "claim-b");
      await a.next("control_revoked");
      expect(field(await b.sync(GAME_ID), "snapshot", "controlHeld")).toBe(true);
      const before = await storedState(stack.ga.runtime);
      const commits = stack.ga.runtime.repository.commits;
      const wakes = stack.ga.runtime.scheduler.pending().length;
      const submitted = stack.facts.count("command_submitted");
      stack.ga.runtime.clock.advance(3_000);
      const reads = stack.ga.runtime.clock.reads;

      b.send(moveMessage("mv-x-b", "X", 0, "e2e4"));
      expectReplayOf(original, await response(b));
      b.send(moveMessage("mv-x-b-altered", "X", 0, "d2d4"));
      expect(await failure(b)).toEqual({
        type: "request_failed",
        requestId: "mv-x-b-altered",
        code: "INVALID_COMMAND_IDENTITY",
        retryable: false,
        clientCommandId: "X",
      });
      expect(b.unread("command_response")).toEqual([]);
      expect(stack.ga.runtime.clock.reads).toBe(reads);
      expect(stack.facts.count("command_submitted")).toBe(submitted);
      expect(stack.facts.named("command_lookup")).toEqual([
        { name: "command_lookup", gameId: GAME_ID, lookup: "bound" },
        { name: "command_lookup", gameId: GAME_ID, lookup: "bound" },
      ]);
      expect(await storedState(stack.ga.runtime)).toEqual(before);
      expect(stack.ga.runtime.repository.commits).toBe(commits);
      expect(stack.ga.runtime.scheduler.pending().length).toBe(wakes);
      expect(stack.ga.runtime.facts.count("command_refused_control")).toBe(0);
      expect(JSON.stringify(b.received)).not.toMatch(/lease|fingerprint/i);

      const black = await socketOf(stack, p.blackCookie);
      await claimGranted(black, "claim-k");
      black.send(moveMessage("mv-k", "K", 1, "e7e5"));
      expect(field(await response(black), "code")).toBe("Accepted");
      b.send(moveMessage("mv-y-b", "Y", 2, "g1f3"));
      const played = await response(b);
      expect([field(played, "code"), field(played, "replayed")]).toEqual(["Accepted", false]);
      const after = await storedState(stack.ga.runtime);
      expect(after.sequence).toBe(3);
      expect(after.commandBindings.map((binding) => binding.clientCommandId)).toEqual([
        "X",
        "K",
        "Y",
      ]);
      await Promise.all([a.close(), b.close(), black.close()]);
    });
  });

  it("TST-GACC-EDGE-005 the old lease is refused by the writer even when the revocation notice never arrives", async () => {
    await withStack({}, async (stack) => {
      const p = await players(stack);
      const a = await socketOf(stack, p.whiteCookie);
      await a.sync(GAME_ID);
      await claimGranted(a, "claim-a");
      const other = await logIn(stack, "whitey");
      const otherSession = await stack.ga.accounts.accounts.authenticate(tokenOf(other));
      if (otherSession === null) throw new Error("no session");
      const record = memoryOf(stack.ga).control(GAME_ID, "white");
      if (record === undefined) throw new Error("no control record");
      const takenLease = "B".repeat(43);
      if (!isLease(takenLease)) throw new Error("bad lease");
      memoryOf(stack.ga).overwriteControl({
        ...record,
        controllingSessionId: otherSession.sessionId,
        controlLeaseId: takenLease,
        version: record.version + 1,
      });
      const writer = stack.ga.runtime.registry.acquire(GAME_ID);
      if (writer === null) throw new Error("no writer");
      const applied = Promise.withResolvers<unknown>();
      writer.applyControlLease("white", takenLease, applied.resolve);
      expect(await applied.promise).toEqual({ kind: "applied" });

      a.send(moveMessage("mv-1", "w-1", 0, "e2e4"));
      expect(field(await failure(a), "code")).toBe("CONTROL_NOT_HELD");
      expect(stack.ga.runtime.facts.count("command_refused_control")).toBe(2);
      a.send(moveMessage("mv-2", "w-1", 0, "e2e4"));
      expect(field(await failure(a), "code")).toBe("CONTROL_NOT_HELD");
      expect(stack.ga.runtime.facts.count("command_refused_control")).toBe(3);
      expect(stack.ga.runtime.facts.count("command_replayed")).toBe(0);
      expect(field(await a.sync(GAME_ID, "sync-2"), "snapshot", "controlHeld")).toBe(false);
      expect((await storedState(stack.ga.runtime)).sequence).toBe(0);
      expect(a.unread("control_revoked")).toEqual([]);
      await a.close();
    });
  });

  it("TST-GACC-EDGE-006 a third user and a missing game get the same denial for sync, claim, and command, with nothing leaked", async () => {
    await withStack({}, async (stack) => {
      const p = await players(stack);
      await signUp(stack, "Mallory");
      const mallory = await socketOf(stack, await logIn(stack, "mallory"));
      expect(field(mallory.received[0], "games")).toEqual([]);
      for (const gameId of [GAME_ID, OTHER_GAME_ID]) {
        mallory.send({ type: "sync_game", requestId: `s-${gameId}`, gameId });
        expect(field(await failure(mallory), "code")).toBe("GAME_ACCESS_DENIED");
        mallory.send(claimMessage(`c-${gameId}`, gameId));
        const denied = await mallory.next("control_denied");
        expect(denied).toEqual({
          type: "control_denied",
          requestId: `c-${gameId}`,
          gameId,
          code: "GAME_ACCESS_DENIED",
          retryable: false,
        });
        mallory.send(moveMessage(`m-${gameId}`, `m-${gameId}`, 0, "e2e4", gameId));
        expect(field(await failure(mallory), "code")).toBe("GAME_ACCESS_DENIED");
      }
      const wire = JSON.stringify(mallory.received);
      for (const leaked of [p.whiteId, p.blackId, "positionFen", "seat", lease(stack, "white")]) {
        expect(wire).not.toContain(leaked);
      }
      expect(memoryOf(stack.ga).control(GAME_ID, "white")?.controllingSessionId).toBeNull();
      expect(stack.ga.runtime.repository.commits).toBe(0);
      await mallory.close();
    });
  });

  it("TST-GACC-EDGE-007 logout over HTTP closes the socket and releases control to nobody", async () => {
    await withStack({}, async (stack) => {
      const p = await players(stack);
      const a = await socketOf(stack, p.whiteCookie);
      await a.sync(GAME_ID);
      await claimGranted(a, "claim-a");
      const leaseA = lease(stack, "white");
      const b = await socketOf(stack, await logIn(stack, "whitey"));
      await b.sync(GAME_ID);
      await logOut(stack, p.whiteCookie);
      expect(await a.closed).toEqual({ code: 1008, reason: "session_ended" });
      await stack.ga.access.settled();
      expect(memoryOf(stack.ga).control(GAME_ID, "white")?.controllingSessionId).toBeNull();
      expect(lease(stack, "white")).not.toBe(leaseA);
      expect((await storedState(stack.ga.runtime)).controlLeases.white).toBe(lease(stack, "white"));
      const snapshot = field(await b.sync(GAME_ID, "sync-2"), "snapshot");
      expect(field(snapshot, "controlHeld")).toBe(false);
      expect(field(snapshot, "canClaimControl")).toBe(true);
      expect(b.unread("control_granted")).toEqual([]);
      await claimGranted(b, "claim-b");
      await b.close();
    });
  });

  it("TST-GACC-EDGE-008 disabling an account closes its sockets, releases its seats, and resigns nothing", async () => {
    await withStack({}, async (stack) => {
      const p = await players(stack);
      const white = await socketOf(stack, p.whiteCookie);
      const black = await socketOf(stack, p.blackCookie);
      await white.sync(GAME_ID);
      await black.sync(GAME_ID);
      await claimGranted(white, "claim-w");
      await claimGranted(black, "claim-b");
      expect(await stack.ga.accounts.accounts.setAccountStatus(userOf(p.whiteId), "disabled")).toBe(
        true,
      );
      expect(await white.closed).toEqual({ code: 1008, reason: "session_ended" });
      await stack.ga.access.settled();
      expect(memoryOf(stack.ga).control(GAME_ID, "white")?.controllingSessionId).toBeNull();
      expect(memoryOf(stack.ga).control(GAME_ID, "black")?.controllingSessionId).not.toBeNull();
      const state = await storedState(stack.ga.runtime);
      expect(state.status.kind).toBe("active");
      expect(
        await openClient(stack.ws, { token: null, headers: { cookie: p.whiteCookie } }),
      ).toMatchObject({ kind: "refused", status: 401 });
      black.send({ type: "ping", nonce: "alive" });
      expect(field(await black.next("pong"), "nonce")).toBe("alive");
      await black.close();
    });
  });

  it("TST-GACC-EDGE-009 claim denials: a finished game, and the per-session claim rate", async () => {
    await withStack(
      { accessLimits: { claimBurst: 2, claimRefillEveryMs: 60_000 } },
      async (stack) => {
        const p = await players(stack);
        const white = await socketOf(stack, p.whiteCookie);
        await white.sync(GAME_ID);
        await claimGranted(white, "c-1");
        await claimGranted(white, "c-2");
        expect(await claimDenied(white, "c-3")).toMatchObject({
          code: "RATE_LIMITED",
          retryable: true,
        });
        const black = await socketOf(stack, p.blackCookie);
        await black.sync(GAME_ID);
        white.send({
          type: "game_command",
          requestId: "resign",
          command: {
            command: RESIGN_GAME_COMMAND_V1,
            contractVersion: "1",
            gameId: GAME_ID,
            clientCommandId: "resign-1",
            expectedGameSequence: 0,
          },
        });
        expect(field(await response(white), "code")).toBe("Accepted");
        expect(await claimDenied(black, "c-b")).toMatchObject({
          code: "GAME_CLOSED",
          retryable: false,
        });
        const snapshot = field(await black.sync(GAME_ID, "sync-2"), "snapshot");
        expect(field(snapshot, "canClaimControl")).toBe(false);
        await Promise.all([white.close(), black.close()]);
      },
    );
  });
});

function isLease(value: string): value is ControlLeaseId {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

function userOf(value: string): UserId {
  if (!isUserId(value)) throw new Error("not a user id");
  return value;
}
