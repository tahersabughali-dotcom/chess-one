import { type ActiveGameState, isGameId } from "@chess-one/live-game";
import { describe, expect, it } from "vitest";
import { MemoryAccountsRepository } from "../accounts/support/memory-repository.ts";
import { MemoryChallengeStore } from "../challenges/support/memory-store.ts";
import { ContractRepository } from "../live-game-persistence/support/contract-repository.ts";
import { field, ORIGIN, type TestClient } from "../realtime/support/client.ts";
import { domain, IDLE_MS } from "../realtime/support/runtime.ts";
import { START_WINDOW_MS } from "./support/harness.ts";
import { MemoryGameAccessStore } from "./support/memory-store.ts";
import {
  type AccessStack,
  accessStack,
  claimDenied,
  claimGranted,
  expectNoDefects,
  logIn,
  logOut,
  moveMessage,
  readyAnswer,
  signUp,
  socketOf,
} from "./support/stack.ts";

const THREE_MINUTES = 180_000;

/** The durable stores one server process runs over; a second process over them is a restart. */
interface Stores {
  readonly accounts: MemoryAccountsRepository;
  readonly access: MemoryGameAccessStore;
  readonly liveGame: ContractRepository;
  readonly challenges: MemoryChallengeStore;
  readonly names: Map<string, string>;
}

function stores(): Stores {
  const names = new Map<string, string>();
  return {
    accounts: new MemoryAccountsRepository(),
    access: new MemoryGameAccessStore(),
    liveGame: new ContractRepository(),
    challenges: new MemoryChallengeStore((userId) => names.get(userId) ?? "unknown"),
    names,
  };
}

function serverOver(s: Stores, clockDomain = "rt-boot-a"): Promise<AccessStack> {
  return accessStack({
    accountsRepository: s.accounts,
    store: s.access,
    liveGame: s.liveGame,
    challengeStore: s.challenges,
    clockDomain: domain(clockDomain),
  });
}

/** Runs `run`, then closes `stack` and checks it reported no defect. */
async function closing<T>(stack: AccessStack, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } finally {
    await stack.close();
    expectNoDefects(stack);
  }
}

async function running(s: Stores, run: (stack: AccessStack) => Promise<void>): Promise<void> {
  const stack = await serverOver(s);
  await closing(stack, () => run(stack));
}

interface Answer {
  readonly status: number;
  readonly body: unknown;
}

async function http(
  stack: AccessStack,
  method: "GET" | "POST",
  path: string,
  cookie: string,
  body?: unknown,
): Promise<Answer> {
  const headers = new Headers({ origin: ORIGIN, cookie });
  if (body !== undefined) headers.set("content-type", "application/json");
  const response = await fetch(`${stack.http}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text === "" ? null : JSON.parse(text) };
}

interface Player {
  readonly username: string;
  readonly cookie: string;
}

async function player(stack: AccessStack, s: Stores, username: string): Promise<Player> {
  const userId = await signUp(stack, username);
  s.names.set(userId, username);
  return { username, cookie: await logIn(stack, username.toLowerCase()) };
}

async function challenge(stack: AccessStack, from: Player, to: Player): Promise<string> {
  const created = await http(stack, "POST", "/challenges", from.cookie, {
    opponentUsername: to.username.toLowerCase(),
    timeControl: { type: "sudden_death", initialMs: THREE_MINUTES, incrementMs: 0 },
    seatPreference: "black",
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = field(created.body, "challenge", "challengeId");
  if (typeof id !== "string") throw new Error("no challenge id");
  return id;
}

async function accept(stack: AccessStack, id: string, by: Player): Promise<string> {
  const accepted = await http(stack, "POST", `/challenges/${id}/accept`, by.cookie, {});
  expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
  const gameId = field(accepted.body, "game", "gameId");
  if (typeof gameId !== "string") throw new Error("no game id");
  return gameId;
}

/** A (the challenger, Black by preference) challenged B (White), and B accepted. */
interface Accepted {
  readonly a: Player;
  readonly b: Player;
  readonly challengeId: string;
  readonly gameId: string;
}

async function accepted(stack: AccessStack, s: Stores): Promise<Accepted> {
  const a = await player(stack, s, "PlayerA");
  const b = await player(stack, s, "PlayerB");
  const challengeId = await challenge(stack, a, b);
  return { a, b, challengeId, gameId: await accept(stack, challengeId, b) };
}

async function stored(stack: AccessStack, gameId: string): Promise<ActiveGameState> {
  if (!isGameId(gameId)) throw new Error("not a game id");
  const loaded = await stack.ga.runtime.contract.loadGame(gameId);
  if (!loaded.ok) throw new Error(`load failed: ${loaded.error.kind}`);
  return loaded.value.state;
}

async function snapshotOf(client: TestClient, gameId: string, requestId: string): Promise<unknown> {
  return field(await client.sync(gameId, requestId), "snapshot");
}

function notice(client: TestClient, myReady: boolean, opponentReady: boolean): Promise<unknown> {
  return client.nextWhere(
    (message) =>
      field(message, "type") === "game_ready_state" &&
      field(message, "requestId") === null &&
      field(message, "myReady") === myReady &&
      field(message, "opponentReady") === opponentReady,
  );
}

describe("TST-GACC-CHAL a direct challenge from acceptance to the first move (GAME-START-LIFECYCLE-001)", () => {
  it("TST-GACC-CHAL-001 (spec 46) register, challenge, accept, one awaiting game, claim, ready, one start, White moves", async () => {
    const s = stores();
    await running(s, async (stack) => {
      const a = await player(stack, s, "PlayerA");
      const b = await player(stack, s, "PlayerB");
      const challengeId = await challenge(stack, a, b);
      const incoming = await http(stack, "GET", "/challenges?direction=incoming", b.cookie);
      const listed = field(incoming.body, "challenges");
      expect(Array.isArray(listed) && listed.map((item) => field(item, "challengeId"))).toEqual([
        challengeId,
      ]);

      const acceptance = await http(
        stack,
        "POST",
        `/challenges/${challengeId}/accept`,
        b.cookie,
        {},
      );
      expect(acceptance.status).toBe(200);
      const gameId = field(acceptance.body, "game", "gameId");
      if (typeof gameId !== "string") throw new Error("no game id");
      expect(field(acceptance.body, "challenge")).toMatchObject({
        status: "accepted",
        createdGameId: gameId,
        viewerSeat: "white",
      });
      expect(field(acceptance.body, "game")).toMatchObject({
        viewerSeat: "white",
        lifecycle: "awaiting_players",
      });
      expect(s.liveGame.games.size).toBe(1);
      const byA = await http(stack, "GET", `/challenges/${challengeId}`, a.cookie);
      expect(field(byA.body, "challenge")).toMatchObject({
        status: "accepted",
        viewerSeat: "black",
      });

      const created = await stored(stack, gameId);
      expect(created.sequence).toBe(0);
      expect(created.status.kind).toBe("awaiting_players");
      expect(created.clock.running).toBe(false);
      expect(created.clock.remainingMs).toEqual({ white: THREE_MINUTES, black: THREE_MINUTES });

      const clientA = await socketOf(stack, a.cookie);
      const clientB = await socketOf(stack, b.cookie);
      const snapA = await snapshotOf(clientA, gameId, "sync-a");
      const snapB = await snapshotOf(clientB, gameId, "sync-b");
      expect(snapA).toMatchObject({
        seat: "black",
        gameLifecycle: "awaiting_players",
        controlHeld: false,
      });
      expect(snapB).toMatchObject({
        seat: "white",
        gameLifecycle: "awaiting_players",
        controlHeld: false,
      });
      expect(field(snapA, "clock", "running")).toBe(false);

      await claimGranted(clientA, "claim-a", gameId);
      await claimGranted(clientB, "claim-b", gameId);
      expect(await readyAnswer(clientA, "ready-a", gameId)).toMatchObject({
        type: "game_ready_state",
        myReady: true,
        opponentReady: false,
        gameLifecycle: "awaiting_players",
      });
      expect((await stored(stack, gameId)).clock.running).toBe(false);
      expect(await readyAnswer(clientB, "ready-b", gameId)).toMatchObject({
        type: "game_ready_state",
        gameLifecycle: "in_progress",
      });

      const started = await stored(stack, gameId);
      expect(stack.ga.runtime.facts.count("game_started")).toBe(1);
      expect(started.sequence).toBe(1);
      expect(started.status.kind).toBe("active");
      expect(started.clock).toMatchObject({ running: true, activeSide: "white" });
      expect(started.clock.remainingMs).toEqual({ white: THREE_MINUTES, black: THREE_MINUTES });
      expect(started.clock.anchorMs).toBe(stack.ga.runtime.clock.now());

      clientB.send(moveMessage("move-1", "b-1", 1, "e2e4", gameId));
      expect(field(await clientB.next("command_response"), "response")).toMatchObject({
        code: "Accepted",
        sequence: 2,
      });

      const c = await player(stack, s, "PlayerC");
      const clientC = await socketOf(stack, c.cookie);
      clientC.send({ type: "sync_game", requestId: "sync-c", gameId });
      expect(await clientC.next("request_failed")).toMatchObject({ code: "GAME_ACCESS_DENIED" });
      expect(await claimDenied(clientC, "claim-c", gameId)).toMatchObject({
        code: "GAME_ACCESS_DENIED",
      });
      const byC = await http(stack, "GET", `/challenges/${challengeId}`, c.cookie);
      expect(byC.status).toBe(404);

      const retry = await http(stack, "POST", `/challenges/${challengeId}/accept`, b.cookie, {});
      expect([retry.status, field(retry.body, "game", "gameId")]).toEqual([200, gameId]);
      expect(s.liveGame.games.size).toBe(1);
      expect(stack.challenges?.facts.count("challenge_accepted")).toBe(1);
    });
  });

  it("TST-GACC-CHAL-002 (spec 47) a player never arrives: at the exact deadline the game is aborted, with no result", async () => {
    const s = stores();
    await running(s, async (stack) => {
      const { b, challengeId, gameId } = await accepted(stack, s);
      const clientB = await socketOf(stack, b.cookie);
      await claimGranted(clientB, "claim-b", gameId);
      await readyAnswer(clientB, "ready-b", gameId);
      stack.ga.accounts.clock.advance(START_WINDOW_MS - 1);
      expect(await snapshotOf(clientB, gameId, "just-before")).toMatchObject({
        gameLifecycle: "awaiting_players",
      });
      stack.ga.accounts.clock.advance(1);
      const wakes = stack.ga.runtime.scheduler
        .pending()
        .filter((wake) => wake.delayMs !== IDLE_MS && wake.delayMs <= START_WINDOW_MS);
      expect(wakes).toHaveLength(1);
      for (const wake of wakes) stack.ga.runtime.scheduler.fire(wake);
      const snapshot = await snapshotOf(clientB, gameId, "after");
      expect(snapshot).toMatchObject({
        gameLifecycle: "aborted_before_start",
        sequence: 1,
        myReady: false,
        playable: false,
        canClaimControl: false,
      });
      expect(JSON.stringify(snapshot)).not.toMatch(/winner|loser|resultCode|timeout/i);
      const aborted = await stored(stack, gameId);
      expect(aborted.status).toMatchObject({
        kind: "aborted_before_start",
        reason: "START_DEADLINE_PASSED",
      });
      expect(aborted.clock.remainingMs).toEqual({ white: THREE_MINUTES, black: THREE_MINUTES });
      expect(stack.ga.runtime.facts.named("game_start_aborted").map((fact) => fact.via)).toEqual([
        "wake",
      ]);
      expect(stack.ga.runtime.facts.count("game_started")).toBe(0);
      expect(await readyAnswer(clientB, "late", gameId)).toMatchObject({
        type: "request_failed",
        code: "GAME_NOT_AWAITING",
      });
      expect((await stored(stack, gameId)).sequence).toBe(1);
      const read = await http(stack, "GET", `/challenges/${challengeId}`, b.cookie);
      expect(field(read.body, "challenge", "status")).toBe("accepted");
    });
  });

  it("TST-GACC-CHAL-003 (spec 48) a disconnect before the start clears that ready; A must reconnect and ready again", async () => {
    const s = stores();
    await running(s, async (stack) => {
      const { a, b, gameId } = await accepted(stack, s);
      const clientA = await socketOf(stack, a.cookie);
      const clientB = await socketOf(stack, b.cookie);
      await claimGranted(clientA, "claim-a", gameId);
      await claimGranted(clientB, "claim-b", gameId);
      await clientB.sync(gameId);
      await readyAnswer(clientA, "ready-a", gameId);
      await notice(clientB, false, true);
      await clientA.close();
      await notice(clientB, false, false);
      expect(await readyAnswer(clientB, "ready-b", gameId)).toMatchObject({
        myReady: true,
        opponentReady: false,
        gameLifecycle: "awaiting_players",
      });
      expect((await stored(stack, gameId)).sequence).toBe(0);
      const back = await socketOf(stack, a.cookie);
      expect(await snapshotOf(back, gameId, "back")).toMatchObject({
        controlHeld: true,
        myReady: false,
        opponentReady: true,
      });
      expect(await readyAnswer(back, "ready-a2", gameId)).toMatchObject({
        gameLifecycle: "in_progress",
      });
      expect(stack.ga.runtime.facts.count("game_started")).toBe(1);
    });
  });

  it("TST-GACC-CHAL-004 (spec 49) a control transfer before the start: stale readiness never starts the game", async () => {
    const s = stores();
    await running(s, async (stack) => {
      const { a, b, gameId } = await accepted(stack, s);
      const session1 = await socketOf(stack, a.cookie);
      const clientB = await socketOf(stack, b.cookie);
      await claimGranted(session1, "claim-1", gameId);
      await claimGranted(clientB, "claim-b", gameId);
      await clientB.sync(gameId);
      await readyAnswer(session1, "ready-1", gameId);
      await notice(clientB, false, true);
      const session2 = await socketOf(stack, await logIn(stack, "playera"));
      await claimGranted(session2, "claim-2", gameId);
      expect(field(await session1.next("control_revoked"), "code")).toBe("CONTROL_TRANSFERRED");
      await notice(clientB, false, false);
      expect(await readyAnswer(clientB, "ready-b", gameId)).toMatchObject({
        gameLifecycle: "awaiting_players",
      });
      expect(await readyAnswer(session1, "stale", gameId)).toMatchObject({
        code: "CONTROL_NOT_HELD",
      });
      expect((await stored(stack, gameId)).sequence).toBe(0);
      expect(await readyAnswer(session2, "ready-2", gameId)).toMatchObject({
        gameLifecycle: "in_progress",
      });
      expect(stack.ga.runtime.facts.count("game_started")).toBe(1);
    });
  });

  it("TST-GACC-CHAL-005 (spec 50) a restart before the start: accepted, awaiting, control kept, readiness reset, no recovery pause", async () => {
    const s = stores();
    const first = await serverOver(s);
    const game = await closing(first, async () => {
      const made = await accepted(first, s);
      const clientA = await socketOf(first, made.a.cookie);
      const clientB = await socketOf(first, made.b.cookie);
      await claimGranted(clientA, "claim-a", made.gameId);
      await claimGranted(clientB, "claim-b", made.gameId);
      await readyAnswer(clientA, "ready-a", made.gameId);
      return made;
    });

    const second = await serverOver(s, "rt-boot-b");
    try {
      const read = await http(second, "GET", `/challenges/${game.challengeId}`, game.a.cookie);
      expect(field(read.body, "challenge")).toMatchObject({
        status: "accepted",
        createdGameId: game.gameId,
      });
      const clientA = await socketOf(second, game.a.cookie);
      const clientB = await socketOf(second, game.b.cookie);
      const snapshot = await snapshotOf(clientA, game.gameId, "after-restart");
      expect(snapshot).toMatchObject({
        gameLifecycle: "awaiting_players",
        sequence: 0,
        controlHeld: true,
        myReady: false,
        opponentReady: false,
        recoveryRequired: false,
        recoveryReason: null,
      });
      expect(field(snapshot, "clock", "running")).toBe(false);
      expect((await stored(second, game.gameId)).clock.running).toBe(false);
      expect(await readyAnswer(clientA, "ready-a", game.gameId)).toMatchObject({
        gameLifecycle: "awaiting_players",
      });
      expect(await readyAnswer(clientB, "ready-b", game.gameId)).toMatchObject({
        gameLifecycle: "in_progress",
      });
      expect((await stored(second, game.gameId)).sequence).toBe(1);
    } finally {
      await second.close();
    }
    expectNoDefects(second);
  });

  it("TST-GACC-CHAL-006 (spec 51) a restart after the start keeps the existing recovery pause", async () => {
    const s = stores();
    const first = await serverOver(s);
    const game = await closing(first, async () => {
      const made = await accepted(first, s);
      const clientA = await socketOf(first, made.a.cookie);
      const clientB = await socketOf(first, made.b.cookie);
      await claimGranted(clientA, "claim-a", made.gameId);
      await claimGranted(clientB, "claim-b", made.gameId);
      await readyAnswer(clientA, "ready-a", made.gameId);
      await readyAnswer(clientB, "ready-b", made.gameId);
      return made;
    });
    const second = await serverOver(s, "rt-boot-b");
    try {
      const clientB = await socketOf(second, game.b.cookie);
      expect(await snapshotOf(clientB, game.gameId, "after-restart")).toMatchObject({
        gameLifecycle: "in_progress",
        sequence: 1,
        recoveryRequired: true,
        recoveryReason: "RECOVERY_PAUSED_CLOCK_DOMAIN_CHANGED",
        playable: false,
      });
    } finally {
      await second.close();
    }
    expectNoDefects(second);
  });

  it("TST-GACC-CHAL-007 (spec 52) start races: simultaneous, duplicate, and late readies give exactly one durable start", async () => {
    const s = stores();
    await running(s, async (stack) => {
      const { a, b, gameId } = await accepted(stack, s);
      const clientA = await socketOf(stack, a.cookie);
      const clientB = await socketOf(stack, b.cookie);
      await claimGranted(clientA, "claim-a", gameId);
      await claimGranted(clientB, "claim-b", gameId);
      const answers = await Promise.all([
        readyAnswer(clientA, "ready-a1", gameId),
        readyAnswer(clientB, "ready-b1", gameId),
      ]);
      expect(answers.map((answer) => field(answer, "type"))).toEqual([
        "game_ready_state",
        "game_ready_state",
      ]);
      expect(answers.map((answer) => field(answer, "gameLifecycle")).sort()).toEqual([
        "awaiting_players",
        "in_progress",
      ]);
      const late = await Promise.all([
        readyAnswer(clientA, "ready-a2", gameId),
        readyAnswer(clientB, "ready-b2", gameId),
      ]);
      for (const answer of late) expect(answer).toMatchObject({ code: "GAME_NOT_AWAITING" });
      expect(stack.ga.runtime.facts.count("game_started")).toBe(1);
      expect((await stored(stack, gameId)).sequence).toBe(1);
    });
  });

  it("TST-GACC-CHAL-008 (spec 52) ready against a session revocation: the revoked seat's ready never counts", async () => {
    const s = stores();
    await running(s, async (stack) => {
      const { a, b, gameId } = await accepted(stack, s);
      const clientA = await socketOf(stack, a.cookie);
      const clientB = await socketOf(stack, b.cookie);
      await claimGranted(clientA, "claim-a", gameId);
      await claimGranted(clientB, "claim-b", gameId);
      await clientB.sync(gameId);
      await readyAnswer(clientA, "ready-a", gameId);
      await notice(clientB, false, true);
      const [ready] = await Promise.all([
        readyAnswer(clientB, "ready-b", gameId),
        logOut(stack, a.cookie),
      ]);
      const state = await stored(stack, gameId);
      if (field(ready, "gameLifecycle") === "in_progress") {
        expect(state.sequence).toBe(1);
      } else {
        expect(state.sequence).toBe(0);
        const writer = isGameId(gameId) ? stack.ga.runtime.registry.acquire(gameId) : null;
        expect(writer?.readiness()).toEqual({ white: true, black: false });
      }
      expect(stack.ga.runtime.facts.count("game_started")).toBeLessThanOrEqual(1);
    });
  });
});

/** Game access logged the one injected store outage and nothing else; the log is then cleared. */
function takeInjectedOutage(stack: AccessStack): void {
  expect(stack.ga.defects.errors).toMatchObject([{ kind: "unavailable", detail: "08006" }]);
  stack.ga.defects.errors.splice(0);
}

describe("TST-GACC-CHAL-REC a stuck acceptance over the real game access (CHALLENGE-ACCEPT-STUCK-001)", () => {
  it("TST-GACC-CHAL-009 the game creation fails outright: 202 processing, then the retried accept recreates the same game once", async () => {
    const s = stores();
    await running(s, async (stack) => {
      const a = await player(stack, s, "PlayerA");
      const b = await player(stack, s, "PlayerB");
      const challengeId = await challenge(stack, a, b);
      s.access.failNext("reserveAssignment", "unavailable");
      const first = await http(stack, "POST", `/challenges/${challengeId}/accept`, b.cookie, {});
      expect(first.status, JSON.stringify(first.body)).toBe(202);
      expect(field(first.body, "challenge", "status")).toBe("processing");
      expect(field(first.body, "game")).toBeNull();
      expect(s.liveGame.games.size).toBe(0);
      takeInjectedOutage(stack);
      const read = await http(stack, "GET", `/challenges/${challengeId}`, a.cookie);
      expect(field(read.body, "challenge", "status")).toBe("processing");

      const gameId = await accept(stack, challengeId, b);
      expect(await accept(stack, challengeId, b)).toBe(gameId);
      expect(s.liveGame.games.size).toBe(1);
      const created = await stored(stack, gameId);
      expect(created.status.kind).toBe("awaiting_players");
      expect(created.clock.remainingMs).toEqual({ white: THREE_MINUTES, black: THREE_MINUTES });
      const byA = await http(stack, "GET", `/challenges/${challengeId}`, a.cookie);
      expect(field(byA.body, "challenge")).toMatchObject({
        status: "accepted",
        createdGameId: gameId,
        viewerSeat: "black",
      });
      expect(stack.challenges?.facts.count("challenge_accepted")).toBe(1);
    });
  });

  it("TST-GACC-CHAL-010 a stuck acceptance survives a restart and the bounded reconciliation settles it; the retried accept then answers the same game", async () => {
    const s = stores();
    const first = await serverOver(s);
    const stuck = await closing(first, async () => {
      const a = await player(first, s, "PlayerA");
      const b = await player(first, s, "PlayerB");
      const challengeId = await challenge(first, a, b);
      s.access.failNext("reserveAssignment", "unavailable");
      const answer = await http(first, "POST", `/challenges/${challengeId}/accept`, b.cookie, {});
      expect(answer.status).toBe(202);
      takeInjectedOutage(first);
      return { a, b, challengeId };
    });

    const second = await serverOver(s, "rt-boot-b");
    try {
      const system = second.challenges?.challenges;
      if (system === undefined) throw new Error("challenge routes expected");
      const pass = await system.reconcileAcceptingChallenges(10);
      expect(pass).toMatchObject({
        listed: true,
        examined: 1,
        accepted: 1,
        failed: 0,
        processing: 0,
      });
      expect(await system.reconcileAcceptingChallenges(10)).toMatchObject({ examined: 0 });
      const read = await http(second, "GET", `/challenges/${stuck.challengeId}`, stuck.b.cookie);
      const gameId = field(read.body, "challenge", "createdGameId");
      expect(field(read.body, "challenge", "status")).toBe("accepted");
      expect(await accept(second, stuck.challengeId, stuck.b)).toBe(gameId);
      expect(s.liveGame.games.size).toBe(1);
      if (typeof gameId !== "string") throw new Error("no game id");
      expect((await stored(second, gameId)).status.kind).toBe("awaiting_players");
      const clientA = await socketOf(second, stuck.a.cookie);
      await claimGranted(clientA, "claim-a", gameId);
    } finally {
      await second.close();
    }
    expectNoDefects(second);
  });
});
