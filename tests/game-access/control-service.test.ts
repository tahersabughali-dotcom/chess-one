import type { ControlNotice } from "@chess-one/game-access";
import { type AccountStatus, isUserId } from "@chess-one/identity";
import { type ControlLeaseId, type Seat, suddenDeath } from "@chess-one/live-game-runtime";
import { describe, expect, it } from "vitest";
import { CLIENT, DAY, registered, signedIn } from "../accounts/support/harness.ts";
import {
  GAME_ID,
  INITIAL_MS,
  newGame,
  OTHER_GAME_ID,
  resignCommand,
  STRANGER,
} from "../live-game/support/harness.ts";
import { store, storedState, writerOf } from "../realtime/support/runtime.ts";
import { ManualWallTime, wallMs } from "../realtime/support/time.ts";
import {
  assignedGame,
  type GameAccessHarness,
  gameAccessHarness,
  grantedLease,
  heldLease,
  memoryOf,
  playerOf,
  sessionOf,
  startDeadlineFrom,
  startedGame,
  TIME_CONTROL,
} from "./support/harness.ts";

function control(h: GameAccessHarness, seat: Seat, gameId = GAME_ID) {
  const record = memoryOf(h).control(gameId, seat);
  if (record === undefined) throw new Error("no control record");
  return record;
}

async function writerLease(h: GameAccessHarness, seat: Seat): Promise<ControlLeaseId> {
  return (await storedState(h.runtime)).controlLeases[seat];
}

function noticesOf(
  authority: ReturnType<typeof sessionOf>["authority"],
  seat: Seat,
): ControlNotice[] {
  const notices: ControlNotice[] = [];
  authority.watchControl(GAME_ID, seat, (notice) => notices.push(notice));
  return notices;
}

describe("TST-GACC-SVC game access and seat control (in-memory store, real accounts and writer)", () => {
  it("TST-GACC-SVC-001 the production resolver answers from the assignment only", async () => {
    const h = gameAccessHarness();
    const { white, black } = await assignedGame(h);
    expect(h.access.trust).toBe("production");
    expect(await h.access.resolve(white.playerId, GAME_ID)).toBe("player_white");
    expect(await h.access.resolve(black.playerId, GAME_ID)).toBe("player_black");
    expect(await h.access.resolve(STRANGER, GAME_ID)).toBe("no_access");
    expect(await h.access.resolve(white.playerId, OTHER_GAME_ID)).toBe("game_not_found");
    memoryOf(h).failNext("findAssignment", "unavailable");
    expect(await h.access.resolve(white.playerId, GAME_ID)).toBe("unavailable");
    expect(h.facts.named("game_access_unavailable")).toEqual([
      { name: "game_access_unavailable", operation: "resolve", cause: "store_unavailable" },
    ]);
    expect(h.defects.errors).toHaveLength(1);
    memoryOf(h).failNext("findAssignment", "defect");
    await expect(h.access.resolve(white.playerId, GAME_ID)).rejects.toThrow(/injected/);
  });

  it("TST-GACC-SVC-002 access names the seat, never takes control, and denies strangers and missing games alike", async () => {
    const h = gameAccessHarness();
    const { white, black } = await assignedGame(h);
    expect(await white.authority.access(GAME_ID)).toEqual({
      kind: "player",
      seat: "white",
      control: { held: false },
    });
    expect(await black.authority.access(GAME_ID)).toEqual({
      kind: "player",
      seat: "black",
      control: { held: false },
    });
    expect(control(h, "white").controllingSessionId).toBeNull();
    const stranger = sessionOf(h, await registered(h.accounts, "Mallory"));
    expect(await stranger.authority.access(GAME_ID)).toEqual({ kind: "denied" });
    expect(await stranger.authority.access(OTHER_GAME_ID)).toEqual({ kind: "denied" });
    expect(h.facts.named("game_access_denied").map((fact) => fact.reason)).toEqual([
      "no_access",
      "game_not_found",
    ]);
    expect(await h.access.seatsOf(stranger.playerId)).toEqual([]);
    expect(await h.access.seatsOf(white.playerId)).toEqual([{ gameId: GAME_ID, seat: "white" }]);
  });

  it("TST-GACC-SVC-003 a claim rotates the lease into the store and the writer, and changes nothing else of the game", async () => {
    const h = gameAccessHarness();
    const { white } = await assignedGame(h);
    const before = await storedState(h.runtime);
    const initial = control(h, "white");
    const lease = await grantedLease(white.authority);
    expect(lease).not.toBe(initial.controlLeaseId);
    expect(control(h, "white")).toEqual({
      gameId: GAME_ID,
      seat: "white",
      controllingSessionId: white.signedIn.session.sessionId,
      controlLeaseId: lease,
      version: initial.version + 1,
    });
    const after = await storedState(h.runtime);
    expect(after.controlLeases).toEqual({ ...before.controlLeases, white: lease });
    expect(after.sequence).toBe(before.sequence);
    expect(after.clock).toEqual(before.clock);
    expect(after.position).toEqual(before.position);
    expect(after.history).toEqual(before.history);
    expect(after.status).toEqual(before.status);
    expect(after.commandBindings).toEqual(before.commandBindings);
    expect(await heldLease(white.authority)).toBe(lease);
    expect(h.facts.named("game_control_claimed")).toEqual([
      { name: "game_control_claimed", gameId: GAME_ID, seat: "white", rotated: true },
    ]);
    expect(h.facts.count("game_control_revoked")).toBe(0);
  });

  it("TST-GACC-SVC-004 the holder claiming again, or reconnecting, keeps its lease", async () => {
    const h = gameAccessHarness();
    const { white } = await assignedGame(h);
    const lease = await grantedLease(white.authority);
    const version = control(h, "white").version;
    expect(await grantedLease(white.authority)).toBe(lease);
    const reconnected = h.access.forSession(
      { sessionId: white.signedIn.session.sessionId, userId: white.signedIn.account.userId },
      white.playerId,
    );
    expect(await heldLease(reconnected)).toBe(lease);
    expect(control(h, "white").version).toBe(version);
    expect(await writerLease(h, "white")).toBe(lease);
    expect(h.facts.named("game_control_claimed").map((fact) => fact.rotated)).toEqual([
      true,
      false,
    ]);
  });

  it("TST-GACC-SVC-005 a second session of the same player syncs without control, then takes it only by an explicit claim", async () => {
    const h = gameAccessHarness();
    const { white } = await assignedGame(h);
    const leaseA = await grantedLease(white.authority);
    const second = sessionOf(h, await signedIn(h.accounts, "Alice"));
    const noticesA = noticesOf(white.authority, "white");
    const noticesB = noticesOf(second.authority, "white");
    expect(await second.authority.access(GAME_ID)).toEqual({
      kind: "player",
      seat: "white",
      control: { held: false },
    });
    expect(await heldLease(white.authority)).toBe(leaseA);
    const leaseB = await grantedLease(second.authority);
    expect(leaseB).not.toBe(leaseA);
    expect(await writerLease(h, "white")).toBe(leaseB);
    expect(await heldLease(white.authority)).toBeNull();
    expect(noticesA).toEqual([{ kind: "taken" }]);
    expect(noticesB).toEqual([{ kind: "held", controlLeaseId: leaseB }]);
    expect(h.facts.named("game_control_revoked")).toEqual([
      {
        name: "game_control_revoked",
        gameId: GAME_ID,
        seat: "white",
        reason: "claimed_by_other_session",
      },
    ]);
  });

  it("TST-GACC-SVC-006 claims are refused for strangers, ended sessions, and finished games", async () => {
    const h = gameAccessHarness();
    const { white, black } = await assignedGame(h);
    const stranger = sessionOf(h, await registered(h.accounts, "Mallory"));
    expect(await stranger.authority.claim(GAME_ID)).toEqual({
      kind: "refused",
      reason: "no_access",
    });
    expect(await stranger.authority.claim(OTHER_GAME_ID)).toEqual({
      kind: "refused",
      reason: "no_access",
    });
    const second = sessionOf(h, await signedIn(h.accounts, "Bob"));
    await h.accounts.accounts.logout(second.signedIn.session.token);
    await h.access.settled();
    expect(await second.authority.claim(GAME_ID)).toEqual({
      kind: "refused",
      reason: "session_ended",
    });
    const { white: lease } = await startedGame({ white, black, gameId: GAME_ID });
    const state = await storedState(h.runtime);
    const resigned = Promise.withResolvers<unknown>();
    writerOf(h.runtime).submitCommand(
      { gameId: GAME_ID, playerId: white.playerId, seat: "white", controlLeaseId: lease },
      { ...resignCommand(state, "white"), controlLeaseId: lease },
      resigned.resolve,
    );
    await resigned.promise;
    expect((await storedState(h.runtime)).status.kind).not.toBe("active");
    const held = control(h, "black");
    const blackAgain = sessionOf(h, await signedIn(h.accounts, "Bob"));
    expect(await blackAgain.authority.claim(GAME_ID)).toEqual({
      kind: "refused",
      reason: "game_closed",
    });
    expect(control(h, "black")).toEqual(held);
    expect(held.controllingSessionId).toBe(black.signedIn.session.sessionId);
  });

  it("TST-GACC-SVC-007 an expired session cannot claim", async () => {
    const h = gameAccessHarness();
    const { white } = await assignedGame(h);
    h.accounts.clock.advance(400 * DAY);
    expect(await white.authority.claim(GAME_ID)).toEqual({
      kind: "refused",
      reason: "session_ended",
    });
    expect(control(h, "white").controllingSessionId).toBeNull();
  });

  it("TST-GACC-SVC-008 a control record moved by another process is never overwritten: conflict", async () => {
    const h = gameAccessHarness();
    const { white } = await assignedGame(h);
    const store = memoryOf(h);
    const initial = control(h, "white");
    store.beforeTransfer = async () => {
      await store.transferControl({
        gameId: GAME_ID,
        seat: "white",
        expectedVersion: initial.version,
        sessionId: null,
        controlLeaseId: initial.controlLeaseId,
      });
    };
    expect(await white.authority.claim(GAME_ID)).toEqual({ kind: "refused", reason: "conflict" });
    expect(control(h, "white").controllingSessionId).toBeNull();
    expect(control(h, "white").version).toBe(initial.version + 1);
    expect(await writerLease(h, "white")).toBe(initial.controlLeaseId);
    expect(h.facts.named("game_control_conflict")).toEqual([
      { name: "game_control_conflict", gameId: GAME_ID, seat: "white" },
    ]);
  });

  it("TST-GACC-SVC-009 claims are rate limited per session", async () => {
    const h = gameAccessHarness({ limits: { claimBurst: 2, claimRefillEveryMs: 60_000 } });
    const { white } = await assignedGame(h);
    await grantedLease(white.authority);
    await grantedLease(white.authority);
    expect(await white.authority.claim(GAME_ID)).toEqual({
      kind: "refused",
      reason: "rate_limited",
    });
    const second = sessionOf(h, await signedIn(h.accounts, "Alice"));
    await grantedLease(second.authority);
    h.accounts.clock.advance(60_000);
    await grantedLease(white.authority);
  });

  it("TST-GACC-SVC-010 store failures fail closed: nothing granted, a fact, and a reported defect", async () => {
    const h = gameAccessHarness();
    const { white } = await assignedGame(h);
    const store = memoryOf(h);
    store.failNext("findControl", "unavailable");
    expect(await white.authority.claim(GAME_ID)).toEqual({ kind: "unavailable" });
    store.failNext("transferControl", "unavailable");
    expect(await white.authority.claim(GAME_ID)).toEqual({ kind: "unavailable" });
    store.failNext("findControl", "corrupt");
    expect(await white.authority.access(GAME_ID)).toEqual({ kind: "unavailable" });
    store.failNext("seatsOf", "unavailable");
    expect(await h.access.seatsOf(white.playerId)).toEqual([]);
    expect(control(h, "white").controllingSessionId).toBeNull();
    expect(h.facts.named("game_access_unavailable").map((fact) => fact.cause)).toEqual([
      "store_unavailable",
      "store_unavailable",
      "store_corrupt",
      "store_unavailable",
    ]);
    expect(h.defects.errors).toHaveLength(4);
    store.removeControl(GAME_ID, "white");
    expect(await white.authority.access(GAME_ID)).toEqual({ kind: "unavailable" });
    expect(await white.authority.claim(GAME_ID)).toEqual({ kind: "unavailable" });
  });

  it("TST-GACC-SVC-011 logout releases the session's seat: no controller, a fresh lease, and no other session assigned", async () => {
    const h = gameAccessHarness();
    const { white } = await assignedGame(h);
    const second = sessionOf(h, await signedIn(h.accounts, "Alice"));
    const lease = await grantedLease(white.authority);
    const notices = noticesOf(white.authority, "white");
    const secondNotices = noticesOf(second.authority, "white");
    await h.accounts.accounts.logout(white.signedIn.session.token);
    await h.access.settled();
    const record = control(h, "white");
    expect(record.controllingSessionId).toBeNull();
    expect(record.controlLeaseId).not.toBe(lease);
    expect(await writerLease(h, "white")).toBe(record.controlLeaseId);
    expect(notices).toEqual([{ kind: "released" }]);
    expect(secondNotices).toEqual([{ kind: "released" }]);
    expect(await heldLease(second.authority)).toBeNull();
    expect(h.facts.named("game_control_revoked")).toEqual([
      { name: "game_control_revoked", gameId: GAME_ID, seat: "white", reason: "session_revoked" },
    ]);
    expect(h.access.pendingRevocations).toBe(0);
  });

  it("TST-GACC-SVC-012 logout-all releases every seat of every session of the user", async () => {
    const h = gameAccessHarness();
    const { white, black } = await assignedGame(h);
    await h.access.createAssignedGame({
      gameId: OTHER_GAME_ID,
      white: black.signedIn.account.userId,
      black: white.signedIn.account.userId,
      timeControl: TIME_CONTROL,
      startDeadlineAtWallMs: startDeadlineFrom(h.runtime),
    });
    const second = sessionOf(h, await signedIn(h.accounts, "Alice"));
    await grantedLease(white.authority, GAME_ID);
    await grantedLease(second.authority, OTHER_GAME_ID);
    await grantedLease(black.authority, GAME_ID);
    await h.accounts.accounts.logoutAll({
      sessionId: white.signedIn.session.sessionId,
      userId: white.signedIn.account.userId,
    });
    await h.access.settled();
    expect(control(h, "white", GAME_ID).controllingSessionId).toBeNull();
    expect(control(h, "black", OTHER_GAME_ID).controllingSessionId).toBeNull();
    expect(control(h, "black", GAME_ID).controllingSessionId).toBe(
      black.signedIn.session.sessionId,
    );
  });

  it("TST-GACC-SVC-013 disabling or locking an account releases its seats, refuses new claims, and resigns nothing", async () => {
    const closed: readonly AccountStatus[] = ["disabled", "locked"];
    for (const status of closed) {
      const h = gameAccessHarness();
      const { white, black } = await assignedGame(h);
      await grantedLease(white.authority);
      await grantedLease(black.authority);
      const before = await storedState(h.runtime);
      expect(
        await h.accounts.accounts.setAccountStatus(white.signedIn.account.userId, status),
      ).toBe(true);
      await h.access.settled();
      expect(control(h, "white").controllingSessionId).toBeNull();
      expect(control(h, "black").controllingSessionId).toBe(black.signedIn.session.sessionId);
      expect(await white.authority.claim(GAME_ID)).toEqual({
        kind: "refused",
        reason: "session_ended",
      });
      const after = await storedState(h.runtime);
      expect(after.status).toEqual(before.status);
      expect(after.sequence).toBe(before.sequence);
      expect(h.facts.named("game_control_revoked").map((fact) => fact.reason)).toContain(
        "account_closed",
      );
      const login = await h.accounts.accounts.login(
        { identifier: "Alice", password: "correct horse battery staple" },
        CLIENT,
      );
      expect(login.ok).toBe(false);
    }
  });

  it("TST-GACC-SVC-014 the end of a connection's session (liveness) releases its seats", async () => {
    const h = gameAccessHarness();
    const { white } = await assignedGame(h);
    await grantedLease(white.authority);
    white.authority.sessionEnded();
    await h.access.settled();
    expect(control(h, "white").controllingSessionId).toBeNull();
    expect(h.facts.named("game_control_revoked").map((fact) => fact.reason)).toEqual([
      "session_ended",
    ]);
  });

  it("TST-GACC-SVC-015 parallel claims by two sessions run one at a time; the store and the writer agree on the last", async () => {
    const h = gameAccessHarness();
    const { white } = await assignedGame(h);
    const second = sessionOf(h, await signedIn(h.accounts, "Alice"));
    const [a, b] = await Promise.all([
      white.authority.claim(GAME_ID),
      second.authority.claim(GAME_ID),
    ]);
    expect(a.kind).toBe("granted");
    expect(b.kind).toBe("granted");
    const record = control(h, "white");
    expect(record.controllingSessionId).toBe(second.signedIn.session.sessionId);
    expect(record.version).toBe(2);
    expect(await writerLease(h, "white")).toBe(record.controlLeaseId);
    expect(await heldLease(white.authority)).toBeNull();
    expect(await heldLease(second.authority)).toBe(record.controlLeaseId);
  });

  it("TST-GACC-SVC-016 logout racing a claim: the claim never leaves an ended session in control", async () => {
    const h = gameAccessHarness();
    const { white } = await assignedGame(h);
    memoryOf(h).beforeTransfer = () => h.accounts.accounts.logout(white.signedIn.session.token);
    expect(await white.authority.claim(GAME_ID)).toEqual({
      kind: "refused",
      reason: "session_ended",
    });
    await h.access.settled();
    const record = control(h, "white");
    expect(record.controllingSessionId).toBeNull();
    expect(await writerLease(h, "white")).toBe(record.controlLeaseId);
    expect(h.facts.count("game_control_claimed")).toBe(0);
  });

  it("TST-GACC-SVC-017 the holder's next access re-applies a stored lease the writer never received", async () => {
    const h = gameAccessHarness();
    const { white } = await assignedGame(h);
    const lease = await grantedLease(white.authority);
    const second = sessionOf(h, await signedIn(h.accounts, "Alice"));
    const record = control(h, "white");
    const pendingLease = "a".repeat(43);
    if (!isLeaseText(pendingLease)) throw new Error("bad lease");
    memoryOf(h).overwriteControl({
      ...record,
      controllingSessionId: second.signedIn.session.sessionId,
      controlLeaseId: pendingLease,
      version: record.version + 1,
    });
    expect(await writerLease(h, "white")).toBe(lease);
    expect(await heldLease(white.authority)).toBeNull();
    expect(await heldLease(second.authority)).toBe(pendingLease);
    expect(await writerLease(h, "white")).toBe(pendingLease);
  });

  it("TST-GACC-SVC-018 control watchers are bounded and unsubscribe", async () => {
    const h = gameAccessHarness({ limits: { maxControlWatchers: 1 } });
    const { white, black } = await assignedGame(h);
    const stop = white.authority.watchControl(GAME_ID, "white", () => undefined);
    const noop = black.authority.watchControl(GAME_ID, "black", () => undefined);
    expect(h.access.controlWatchers).toBe(1);
    noop();
    expect(h.access.controlWatchers).toBe(1);
    stop();
    expect(h.access.controlWatchers).toBe(0);
    h.access.dispose();
  });

  it("TST-GACC-SVC-020 replay access proves an active session of the seat's player, needs no control, and changes no control", async () => {
    const h = gameAccessHarness();
    const { white, black } = await assignedGame(h);
    const second = sessionOf(h, await signedIn(h.accounts, "Alice"));
    await grantedLease(second.authority);
    const record = control(h, "white");
    expect(await white.authority.replayAccess(GAME_ID)).toEqual({ kind: "player", seat: "white" });
    expect(await black.authority.replayAccess(GAME_ID)).toEqual({ kind: "player", seat: "black" });
    expect(control(h, "white")).toEqual(record);
    expect(control(h, "black").controllingSessionId).toBeNull();
    expect(await heldLease(white.authority)).toBeNull();

    const stranger = sessionOf(h, await registered(h.accounts, "Mallory"));
    expect(await stranger.authority.replayAccess(GAME_ID)).toEqual({ kind: "denied" });
    expect(await white.authority.replayAccess(OTHER_GAME_ID)).toEqual({ kind: "denied" });

    memoryOf(h).failNext("findAssignment", "unavailable");
    expect(await white.authority.replayAccess(GAME_ID)).toEqual({ kind: "unavailable" });
    expect(h.defects.errors).toHaveLength(1);

    await h.accounts.accounts.logout(white.signedIn.session.token);
    await h.access.settled();
    expect(await white.authority.replayAccess(GAME_ID)).toEqual({ kind: "session_ended" });
    expect(await second.authority.replayAccess(GAME_ID)).toEqual({ kind: "player", seat: "white" });
    h.accounts.clock.advance(400 * DAY);
    expect(await second.authority.replayAccess(GAME_ID)).toEqual({ kind: "session_ended" });
  });

  it("TST-GACC-SVC-019 no fact carries a session id, token, lease, user id, or email", async () => {
    const h = gameAccessHarness();
    const { white, black } = await assignedGame(h);
    const second = sessionOf(h, await signedIn(h.accounts, "Alice"));
    const leases = [await grantedLease(white.authority), await grantedLease(second.authority)];
    await h.accounts.accounts.logout(second.signedIn.session.token);
    await h.access.settled();
    await sessionOf(h, await registered(h.accounts, "Mallory")).authority.claim(GAME_ID);
    const text = JSON.stringify(h.facts.facts);
    const secrets = [
      white.signedIn.session.sessionId,
      white.signedIn.session.token,
      second.signedIn.session.sessionId,
      second.signedIn.session.token,
      white.playerId,
      black.playerId,
      "alice@example.test",
      ...leases,
      control(h, "white").controlLeaseId,
      control(h, "black").controlLeaseId,
    ];
    for (const secret of secrets) expect(text).not.toContain(secret);
    expect(h.facts.facts.length).toBeGreaterThan(4);
  });
});

function isLeaseText(value: string): value is ControlLeaseId {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

describe("TST-GACC-ASSIGN trusted creation of an assigned game", () => {
  it("TST-GACC-ASSIGN-001 creates the pending assignment, the game with the same players and leases, then confirms", async () => {
    const h = gameAccessHarness();
    const white = await registered(h.accounts, "Alice");
    const black = await registered(h.accounts, "Bob");
    const created = await h.access.createAssignedGame({
      gameId: GAME_ID,
      white: white.account.userId,
      black: black.account.userId,
      timeControl: TIME_CONTROL,
      startDeadlineAtWallMs: startDeadlineFrom(h.runtime),
    });
    expect(created.ok).toBe(true);
    const assignment = await h.store.findAssignment(GAME_ID);
    expect(assignment).toEqual({
      gameId: GAME_ID,
      players: { white: playerOf(white), black: playerOf(black) },
      state: "confirmed",
    });
    const state = await storedState(h.runtime);
    expect(state.players).toEqual(assignment?.players);
    expect(state.controlLeases).toEqual({
      white: control(h, "white").controlLeaseId,
      black: control(h, "black").controlLeaseId,
    });
    expect(h.runtime.registry.peek(GAME_ID)).toBeDefined();
    expect(h.facts.named("game_assignment_created")).toHaveLength(1);
  });

  it("TST-GACC-ASSIGN-002 refuses the same user, unknown users, inactive users, and a taken game id, writing nothing", async () => {
    const h = gameAccessHarness();
    const alice = await registered(h.accounts, "Alice");
    const bob = await registered(h.accounts, "Bob");
    const carol = await registered(h.accounts, "Carol");
    const request = {
      gameId: GAME_ID,
      timeControl: TIME_CONTROL,
      startDeadlineAtWallMs: startDeadlineFrom(h.runtime),
    };
    expect(
      await h.access.createAssignedGame({
        ...request,
        white: alice.account.userId,
        black: alice.account.userId,
      }),
    ).toEqual({ ok: false, error: { kind: "same_user" } });
    const unknown = "00000000-0000-4000-8000-000000000000";
    if (!isUserId(unknown)) throw new Error("bad id");
    expect(
      await h.access.createAssignedGame({
        ...request,
        white: alice.account.userId,
        black: unknown,
      }),
    ).toEqual({ ok: false, error: { kind: "user_not_found", seat: "black" } });
    await h.accounts.accounts.setAccountStatus(carol.account.userId, "disabled");
    expect(
      await h.access.createAssignedGame({
        ...request,
        white: carol.account.userId,
        black: bob.account.userId,
      }),
    ).toEqual({ ok: false, error: { kind: "user_not_active", seat: "white" } });
    expect(await h.store.findAssignment(GAME_ID)).toBeNull();
    expect(h.runtime.repository.creates).toBe(0);
    const ok = await h.access.createAssignedGame({
      ...request,
      white: alice.account.userId,
      black: bob.account.userId,
    });
    expect(ok.ok).toBe(true);
    expect(
      await h.access.createAssignedGame({
        ...request,
        white: bob.account.userId,
        black: alice.account.userId,
      }),
    ).toEqual({ ok: false, error: { kind: "game_already_assigned" } });
    expect((await h.store.findAssignment(GAME_ID))?.players.white).toBe(playerOf(alice));
    expect(h.runtime.repository.creates).toBe(1);
  });

  it("TST-GACC-ASSIGN-003 the verified-email hook refuses unverified accounts only when enabled", async () => {
    const strict = gameAccessHarness({ assignmentPolicy: { requireVerifiedEmail: true } });
    const a = await registered(strict.accounts, "Alice");
    const b = await registered(strict.accounts, "Bob");
    expect(
      await strict.access.createAssignedGame({
        gameId: GAME_ID,
        white: a.account.userId,
        black: b.account.userId,
        timeControl: TIME_CONTROL,
        startDeadlineAtWallMs: startDeadlineFrom(strict.runtime),
      }),
    ).toEqual({ ok: false, error: { kind: "email_not_verified", seat: "white" } });
    const relaxed = gameAccessHarness();
    await assignedGame(relaxed);
    expect(relaxed.facts.count("game_assignment_created")).toBe(1);
  });

  it("TST-GACC-ASSIGN-004 a start that surely stored nothing discards the pending assignment", async () => {
    const h = gameAccessHarness();
    const white = await registered(h.accounts, "Alice");
    const black = await registered(h.accounts, "Bob");
    h.runtime.repository.createFault = "fail";
    const created = await h.access.createAssignedGame({
      gameId: GAME_ID,
      white: white.account.userId,
      black: black.account.userId,
      timeControl: TIME_CONTROL,
      startDeadlineAtWallMs: startDeadlineFrom(h.runtime),
    });
    expect(created).toEqual({ ok: false, error: { kind: "unavailable" } });
    expect(await h.store.findAssignment(GAME_ID)).toBeNull();
    expect(memoryOf(h).control(GAME_ID, "white")).toBeUndefined();
    expect(await h.access.resolve(playerOf(white), GAME_ID)).toBe("game_not_found");
  });

  it("TST-GACC-ASSIGN-005 a start stored despite a reported failure is confirmed but never reported as success", async () => {
    const h = gameAccessHarness();
    const white = await registered(h.accounts, "Alice");
    const black = await registered(h.accounts, "Bob");
    h.runtime.repository.createFault = "apply_then_fail";
    const created = await h.access.createAssignedGame({
      gameId: GAME_ID,
      white: white.account.userId,
      black: black.account.userId,
      timeControl: TIME_CONTROL,
      startDeadlineAtWallMs: startDeadlineFrom(h.runtime),
    });
    expect(created).toEqual({
      ok: false,
      error: { kind: "creation_unconfirmed", reconciliation: "stored" },
    });
    expect((await h.store.findAssignment(GAME_ID))?.state).toBe("confirmed");
    expect(await h.access.resolve(playerOf(white), GAME_ID)).toBe("player_white");
  });

  it("TST-GACC-ASSIGN-006 an unknown outcome stays pending (access still works) until reconciliation settles it", async () => {
    const h = gameAccessHarness();
    const white = await registered(h.accounts, "Alice");
    const black = await registered(h.accounts, "Bob");
    h.runtime.repository.createFault = "fail";
    h.runtime.repository.loadFault = true;
    const created = await h.access.createAssignedGame({
      gameId: GAME_ID,
      white: white.account.userId,
      black: black.account.userId,
      timeControl: TIME_CONTROL,
      startDeadlineAtWallMs: startDeadlineFrom(h.runtime),
    });
    expect(created).toEqual({
      ok: false,
      error: { kind: "creation_unconfirmed", reconciliation: "unknown" },
    });
    expect((await h.store.findAssignment(GAME_ID))?.state).toBe("pending");
    expect(await h.access.resolve(playerOf(white), GAME_ID)).toBe("player_white");
    expect(await h.access.reconcileAssignment(GAME_ID)).toBe("unknown");
    expect((await h.store.findAssignment(GAME_ID))?.state).toBe("pending");
    h.runtime.repository.loadFault = false;
    expect(await h.access.reconcileAssignment(GAME_ID)).toBe("discarded");
    expect(await h.store.findAssignment(GAME_ID)).toBeNull();
    expect(h.runtime.registry.infrastructurePause(GAME_ID)).toBe("CREATE_RECONCILIATION_REQUIRED");
    expect(h.facts.named("game_assignment_reconciled").map((fact) => fact.outcome)).toEqual([
      "unknown",
      "discarded",
    ]);
  });

  it("TST-GACC-ASSIGN-007 a confirm that fails leaves a pending assignment that reconciliation confirms", async () => {
    const h = gameAccessHarness();
    const white = await registered(h.accounts, "Alice");
    const black = await registered(h.accounts, "Bob");
    memoryOf(h).failNext("confirmAssignment", "unavailable");
    const created = await h.access.createAssignedGame({
      gameId: GAME_ID,
      white: white.account.userId,
      black: black.account.userId,
      timeControl: TIME_CONTROL,
      startDeadlineAtWallMs: startDeadlineFrom(h.runtime),
    });
    expect(created).toEqual({
      ok: false,
      error: { kind: "creation_unconfirmed", reconciliation: "stored" },
    });
    expect((await h.store.findAssignment(GAME_ID))?.state).toBe("pending");
    expect(await h.access.reconcileAssignment(GAME_ID)).toBe("confirmed");
    expect(await h.access.reconcileAssignment(GAME_ID)).toBe("confirmed");
    expect(await h.access.reconcileAssignment(OTHER_GAME_ID)).toBe("none");
    expect(h.defects.errors).toHaveLength(1);
  });

  it("TST-GACC-ASSIGN-008 store and accounts failures fail closed before the game is started", async () => {
    const h = gameAccessHarness();
    const white = await registered(h.accounts, "Alice");
    const black = await registered(h.accounts, "Bob");
    const request = {
      gameId: GAME_ID,
      white: white.account.userId,
      black: black.account.userId,
      timeControl: TIME_CONTROL,
      startDeadlineAtWallMs: startDeadlineFrom(h.runtime),
    };
    memoryOf(h).failNext("reserveAssignment", "unavailable");
    expect(await h.access.createAssignedGame(request)).toEqual({
      ok: false,
      error: { kind: "unavailable" },
    });
    expect(h.runtime.repository.creates).toBe(0);
    expect(h.facts.named("game_assignment_failed").map((fact) => fact.reason)).toEqual([
      "unavailable",
    ]);
    expect(h.defects.errors).toHaveLength(1);
  });

  it("TST-GACC-ASSIGN-009 a live game already stored under the id is refused and the pending assignment discarded", async () => {
    const h = gameAccessHarness();
    await store(h.runtime, newGame());
    const white = await registered(h.accounts, "Alice");
    const black = await registered(h.accounts, "Bob");
    const created = await h.access.createAssignedGame({
      gameId: GAME_ID,
      white: white.account.userId,
      black: black.account.userId,
      timeControl: TIME_CONTROL,
      startDeadlineAtWallMs: startDeadlineFrom(h.runtime),
    });
    expect(created).toEqual({
      ok: false,
      error: { kind: "start_refused", reason: "game_already_exists" },
    });
    expect(await h.store.findAssignment(GAME_ID)).toBeNull();
    expect(await h.access.resolve(playerOf(white), GAME_ID)).toBe("game_not_found");
    expect((await storedState(h.runtime)).players.white).not.toBe(playerOf(white));
    expect(await memoryOf(h).discardPendingAssignment(GAME_ID)).toBe(false);
  });

  it("TST-GACC-ASSIGN-010 the check compares the seats, the initial time, and the start deadline while the game records it, in any lifecycle", async () => {
    const h = gameAccessHarness();
    const white = await registered(h.accounts, "Alice");
    const black = await registered(h.accounts, "Bob");
    const deadline = startDeadlineFrom(h.runtime);
    const request = {
      gameId: GAME_ID,
      white: white.account.userId,
      black: black.account.userId,
      timeControl: TIME_CONTROL,
      startDeadlineAtWallMs: deadline,
    };
    expect(await h.access.checkAssignedGame(request)).toBe("absent");
    expect((await h.access.createAssignedGame(request)).ok).toBe(true);
    expect(await h.access.checkAssignedGame(request)).toBe("matches");
    const longer = suddenDeath(INITIAL_MS + 60_000);
    if (longer === null) throw new Error("time control expected");
    const lateDeadline = { ...request, startDeadlineAtWallMs: wallMs(deadline + 1) };
    const variants: [string, typeof request][] = [
      ["seats swapped", { ...request, white: request.black, black: request.white }],
      ["start deadline", lateDeadline],
      ["initial time", { ...request, timeControl: longer }],
    ];
    for (const [name, variant] of variants) {
      expect(await h.access.checkAssignedGame(variant), name).toBe("mismatch");
    }
    await startedGame({
      white: sessionOf(h, white),
      black: sessionOf(h, black),
      gameId: GAME_ID,
    });
    expect(await h.access.gameLifecycle(GAME_ID)).toBe("in_progress");
    expect(await h.access.checkAssignedGame(request)).toBe("matches");
    expect(await h.access.checkAssignedGame(lateDeadline)).toBe("matches");

    const aborted = gameAccessHarness();
    const a = await registered(aborted.accounts, "Alice");
    const b = await registered(aborted.accounts, "Bob");
    const abortedDeadline = startDeadlineFrom(aborted.runtime);
    const abortedRequest = {
      ...request,
      white: a.account.userId,
      black: b.account.userId,
      startDeadlineAtWallMs: abortedDeadline,
    };
    expect((await aborted.access.createAssignedGame(abortedRequest)).ok).toBe(true);
    const wall = aborted.runtime.wallClock;
    if (!(wall instanceof ManualWallTime)) throw new Error("manual wall time expected");
    wall.set(abortedDeadline);
    expect(await aborted.access.gameLifecycle(GAME_ID)).toBe("aborted_before_start");
    expect(await aborted.access.checkAssignedGame(abortedRequest)).toBe("matches");
    expect(
      await aborted.access.checkAssignedGame({
        ...abortedRequest,
        startDeadlineAtWallMs: wallMs(abortedDeadline - 1),
      }),
    ).toBe("mismatch");
    expect([...h.defects.errors, ...aborted.defects.errors]).toEqual([]);
  });

  it("TST-GACC-ASSIGN-011 a live game stored under the id with no assignment is a mismatch, never absent, and the check assigns nothing", async () => {
    const h = gameAccessHarness();
    await store(h.runtime, newGame());
    const white = await registered(h.accounts, "Alice");
    const black = await registered(h.accounts, "Bob");
    const request = {
      gameId: GAME_ID,
      white: white.account.userId,
      black: black.account.userId,
      timeControl: TIME_CONTROL,
      startDeadlineAtWallMs: startDeadlineFrom(h.runtime),
    };
    expect(await h.access.checkAssignedGame(request)).toBe("mismatch");
    expect(await h.store.findAssignment(GAME_ID)).toBeNull();
    expect(await h.access.checkAssignedGame({ ...request, gameId: OTHER_GAME_ID })).toBe("absent");
    h.runtime.repository.loadFault = true;
    expect(await h.access.checkAssignedGame({ ...request, gameId: OTHER_GAME_ID })).toBe("unknown");
  });

  it("TST-GACC-ASSIGN-012 a check racing the creation of the same id waits for it: it never discards an assignment in flight", async () => {
    const h = gameAccessHarness();
    const white = await registered(h.accounts, "Alice");
    const black = await registered(h.accounts, "Bob");
    const request = {
      gameId: GAME_ID,
      white: white.account.userId,
      black: black.account.userId,
      timeControl: TIME_CONTROL,
      startDeadlineAtWallMs: startDeadlineFrom(h.runtime),
    };
    const [created, checked, reconciled] = await Promise.all([
      h.access.createAssignedGame(request),
      h.access.checkAssignedGame(request),
      h.access.reconcileAssignment(GAME_ID),
    ]);
    expect(created.ok).toBe(true);
    expect(checked).toBe("matches");
    expect(reconciled).toBe("confirmed");
    expect((await h.store.findAssignment(GAME_ID))?.state).toBe("confirmed");
    expect(await h.access.resolve(playerOf(white), GAME_ID)).toBe("player_white");
    expect(h.facts.named("game_assignment_reconciled").map((fact) => fact.outcome)).not.toContain(
      "discarded",
    );

    const other = { ...request, gameId: OTHER_GAME_ID };
    const [checkedFirst, createdSecond] = await Promise.all([
      h.access.checkAssignedGame(other),
      h.access.createAssignedGame(other),
    ]);
    expect([checkedFirst, createdSecond.ok]).toEqual(["absent", true]);
    expect(await h.access.checkAssignedGame(other)).toBe("matches");
    expect(h.defects.errors).toEqual([]);
  });
});
