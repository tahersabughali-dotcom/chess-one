import { err, ok } from "@chess-one/game-values";
import type { AwaitingGameIndex, ControlLeaseId, GameId, Seat } from "@chess-one/live-game";
import type {
  GameControlPort,
  LeaseOutcome,
  ReadyOutcome,
  ReadyPresence,
} from "@chess-one/live-game-runtime";
import { afterEach, describe, expect, it } from "vitest";
import {
  awaitingGame,
  duration,
  GAME_ID,
  INITIAL_MS,
  LEASES,
  moveCommand,
  PLAYERS,
  ROTATED_WHITE_LEASE,
  resignCommand,
  START_DEADLINE_MS,
  wallClockMs,
} from "../live-game/support/harness.ts";
import {
  DOMAIN_OLD,
  deadlineWakes,
  decided,
  IDLE_MS,
  RecordingSubscriber,
  type RuntimeHarness,
  runtimeHarness,
  store,
  storedState,
  submitAs,
  viewOf,
} from "./support/runtime.ts";
import { ManualWallTime, RUNTIME_WALL_START } from "./support/time.ts";

const WINDOW_MS = START_DEADLINE_MS - RUNTIME_WALL_START;

interface Lifecycle {
  readonly h: RuntimeHarness;
  readonly wall: ManualWallTime;
  readonly writer: GameControlPort;
}

const open: Lifecycle[] = [];

afterEach(async () => {
  for (const { h } of open.splice(0)) {
    expect(h.defects.errors).toEqual([]);
    await h.registry.dispose();
  }
});

function presence(): { open: boolean } {
  return { open: true };
}

function lifecycleHarness(index?: AwaitingGameIndex): Lifecycle {
  const wall = new ManualWallTime();
  const h = runtimeHarness({}, undefined, undefined, wall, index);
  const writer = h.registry.acquire(GAME_ID);
  if (writer === null) throw new Error("no writer");
  const made = { h, wall, writer };
  open.push(made);
  return made;
}

/** A game awaiting its players, created through the registry as the game-access layer does. */
async function created(index?: AwaitingGameIndex): Promise<Lifecycle> {
  const made = lifecycleHarness(index);
  const result = await made.h.registry.createAwaitingGame({
    gameId: GAME_ID,
    players: PLAYERS,
    controlLeases: LEASES,
    timeControl: { kind: "sudden_death", initialMs: duration(INITIAL_MS) },
    startDeadlineAtWallMs: wallClockMs(START_DEADLINE_MS),
  });
  if (!result.ok) throw new Error("not created");
  expect(result.value.activation.kind).toBe("awaiting_players");
  return made;
}

function mark(
  writer: GameControlPort,
  seat: Seat,
  on: ReadyPresence,
  lease: ControlLeaseId = LEASES[seat],
): Promise<ReadyOutcome> {
  const answer = Promise.withResolvers<ReadyOutcome>();
  const ingress = writer.markReady(seat, lease, on, answer.resolve);
  if (!ingress.accepted) throw new Error(`mark refused at ingress: ${ingress.reason}`);
  return answer.promise;
}

function rotate(writer: GameControlPort, seat: Seat, lease: ControlLeaseId): Promise<LeaseOutcome> {
  const answer = Promise.withResolvers<LeaseOutcome>();
  const ingress = writer.applyControlLease(seat, lease, answer.resolve);
  if (!ingress.accepted) throw new Error(`rotation refused: ${ingress.reason}`);
  return answer.promise;
}

function startWakes(h: RuntimeHarness): readonly { readonly delayMs: number }[] {
  return deadlineWakes(h);
}

describe("TST-RT-LIFE runtime start lifecycle and ready barrier (GAME-START-LIFECYCLE-001)", () => {
  it("TST-RT-LIFE-001 a created game awaits both players: sequence 0, no clock, one start-deadline wake", async () => {
    const { h, writer } = await created();
    const view = await viewOf(writer);
    expect(view).toMatchObject({
      sequence: 0,
      condition: "awaiting_players",
      recoveryReason: null,
      status: { kind: "awaiting_players", startDeadlineAtWallMs: START_DEADLINE_MS },
      clock: { running: false, activeSide: "white", initialMs: INITIAL_MS },
    });
    expect(view.clock.remainingMs).toEqual({ white: INITIAL_MS, black: INITIAL_MS });
    expect(startWakes(h).map((wake) => wake.delayMs)).toEqual([WINDOW_MS]);
    expect(writer.readiness()).toEqual({ white: false, black: false });
    expect(h.facts.count("game_awaiting_players")).toBe(1);
    expect(h.facts.count("game_started")).toBe(0);
  });

  it("TST-RT-LIFE-002 one ready is not enough; the second completes the barrier and the writer starts the game once", async () => {
    const { h, writer } = await created();
    const subscriber = new RecordingSubscriber();
    expect(writer.subscribe(subscriber)).toBe("subscribed");
    const white = presence();
    const first = await mark(writer, "white", white);
    expect(first).toMatchObject({ kind: "ready", readiness: { white: true, black: false } });
    expect(await mark(writer, "white", white)).toMatchObject({ kind: "ready" });
    expect(h.facts.count("game_player_ready")).toBe(1);
    expect((await storedState(h)).sequence).toBe(0);
    expect(h.repository.commits).toBe(0);

    h.clock.advance(250);
    const second = await mark(writer, "black", presence());
    if (second.kind !== "started") throw new Error(`expected a start, got ${second.kind}`);
    expect(second.view).toMatchObject({
      sequence: 1,
      condition: "running",
      status: { kind: "active" },
      clock: { running: true, activeSide: "white" },
    });
    const stored = await storedState(h);
    expect(stored.sequence).toBe(1);
    expect(stored.clock).toMatchObject({ running: true, activeSide: "white" });
    expect(stored.clock.remainingMs).toEqual({ white: INITIAL_MS, black: INITIAL_MS });
    expect(h.repository.commits).toBe(1);
    expect(h.facts.count("game_started")).toBe(1);
    expect(writer.readiness()).toEqual({ white: false, black: false });
    expect(subscriber.readiness).toEqual([
      { white: true, black: false },
      { white: true, black: true },
    ]);
    expect(subscriber.sequences()).toEqual([1]);
    expect(deadlineWakes(h).map((wake) => wake.delayMs)).toEqual([INITIAL_MS + 1]);
    expect(await mark(writer, "white", white)).toMatchObject({
      kind: "refused",
      reason: "game_not_awaiting",
    });
    expect(h.facts.count("game_started")).toBe(1);
  });

  it("TST-RT-LIFE-003 both marks queued together start the game exactly once", async () => {
    const { h, writer } = await created();
    const outcomes = await Promise.all([
      mark(writer, "white", presence()),
      mark(writer, "black", presence()),
      mark(writer, "white", presence()),
    ]);
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(["ready", "started", "refused"]);
    expect(h.repository.commits).toBe(1);
    expect(h.facts.count("game_started")).toBe(1);
    expect((await storedState(h)).sequence).toBe(1);
  });

  it("TST-RT-LIFE-004 a command before the start is refused at ingress: not received, no clock read, nothing bound", async () => {
    const { h, writer } = await created();
    const state = awaitingGame();
    const reads = h.clock.reads;
    for (const command of [moveCommand(state, "e2e4"), resignCommand(state, "white")]) {
      let replied = false;
      const ingress = writer.submitCommand(
        { gameId: GAME_ID, playerId: PLAYERS.white, seat: "white", controlLeaseId: LEASES.white },
        command,
        () => {
          replied = true;
        },
      );
      expect(ingress).toEqual({
        accepted: false,
        reason: "not_in_play",
        lifecycle: "awaiting_players",
      });
      expect(replied).toBe(false);
    }
    expect(h.clock.reads).toBe(reads);
    expect(h.repository.commits).toBe(0);
    expect(h.facts.count("command_refused_not_started")).toBe(2);
    expect((await storedState(h)).commandBindings).toEqual([]);
  });

  it("TST-RT-LIFE-005 marks need the seat's lease and an open connection; a closed connection clears its mark", async () => {
    const { h, writer } = await created();
    expect(await mark(writer, "white", presence(), LEASES.black)).toMatchObject({
      kind: "refused",
      reason: "control_not_held",
    });
    expect(await mark(writer, "white", { open: false })).toMatchObject({
      kind: "refused",
      reason: "connection_closed",
    });
    const white = presence();
    await mark(writer, "white", white);
    writer.clearReady("white", presence());
    expect(writer.readiness()).toEqual({ white: true, black: false });
    writer.clearReady("white", white);
    expect(writer.readiness()).toEqual({ white: false, black: false });
    expect(h.facts.named("game_player_unready")).toEqual([
      { name: "game_player_unready", gameId: GAME_ID, seat: "white", cause: "connection_closed" },
    ]);
    expect(await mark(writer, "black", presence())).toMatchObject({
      kind: "ready",
      readiness: { white: false, black: true },
    });
    expect(h.facts.count("game_started")).toBe(0);
  });

  it("TST-RT-LIFE-006 a mark whose connection closed without a clear never counts toward the start", async () => {
    const { h, writer } = await created();
    const white = presence();
    await mark(writer, "white", white);
    white.open = false;
    expect(writer.readiness()).toEqual({ white: false, black: false });
    expect(await mark(writer, "black", presence())).toMatchObject({ kind: "ready" });
    expect((await storedState(h)).sequence).toBe(0);
  });

  it("TST-RT-LIFE-007 a control transfer clears the old lease's mark; the new lease must mark again", async () => {
    const { h, writer } = await created();
    await mark(writer, "white", presence());
    expect(await rotate(writer, "white", ROTATED_WHITE_LEASE)).toEqual({ kind: "applied" });
    expect(writer.readiness()).toEqual({ white: false, black: false });
    expect(h.facts.named("game_player_unready").map((fact) => fact.cause)).toEqual([
      "control_changed",
    ]);
    expect(await mark(writer, "black", presence())).toMatchObject({ kind: "ready" });
    expect(await mark(writer, "white", presence(), LEASES.white)).toMatchObject({
      kind: "refused",
      reason: "control_not_held",
    });
    expect(await mark(writer, "white", presence(), ROTATED_WHITE_LEASE)).toMatchObject({
      kind: "started",
    });
  });

  it("TST-RT-LIFE-008 exact deadline boundary: the last millisecond before it starts, the deadline itself aborts", async () => {
    const before = await created();
    await mark(before.writer, "white", presence());
    before.wall.set(START_DEADLINE_MS - 1);
    expect(await mark(before.writer, "black", presence())).toMatchObject({ kind: "started" });

    const { h, wall, writer } = await created();
    await mark(writer, "white", presence());
    wall.set(START_DEADLINE_MS);
    const late = await mark(writer, "black", presence());
    expect(late).toMatchObject({
      kind: "refused",
      reason: "start_deadline_passed",
      view: {
        sequence: 1,
        condition: "aborted_before_start",
        status: { kind: "aborted_before_start", reason: "START_DEADLINE_PASSED" },
        clock: { running: false },
      },
    });
    const stored = await storedState(h);
    expect(stored.status).toEqual({
      kind: "aborted_before_start",
      reason: "START_DEADLINE_PASSED",
      startDeadlineAtWallMs: START_DEADLINE_MS,
    });
    expect(stored.clock.remainingMs).toEqual({ white: INITIAL_MS, black: INITIAL_MS });
    expect(h.facts.named("game_start_aborted")).toEqual([
      { name: "game_start_aborted", gameId: GAME_ID, via: "ready" },
    ]);
    expect(h.facts.count("game_started")).toBe(0);
    expect(writer.readiness()).toEqual({ white: false, black: false });
    expect(deadlineWakes(h)).toEqual([]);
  });

  it("TST-RT-LIFE-009 the start-deadline wake aborts on time, and an early wake only re-arms", async () => {
    const { h, wall, writer } = await created();
    const subscriber = new RecordingSubscriber();
    writer.subscribe(subscriber);
    wall.set(START_DEADLINE_MS - 100);
    h.scheduler.fire(h.scheduler.single(IDLE_MS));
    expect((await viewOf(writer)).condition).toBe("awaiting_players");
    expect(startWakes(h).map((wake) => wake.delayMs)).toEqual([100]);

    wall.set(START_DEADLINE_MS);
    h.scheduler.fire(h.scheduler.single(IDLE_MS));
    const view = await viewOf(writer);
    expect(view).toMatchObject({ sequence: 1, condition: "aborted_before_start" });
    expect(subscriber.sequences()).toEqual([1]);
    expect(h.facts.named("game_start_aborted").map((fact) => fact.via)).toEqual(["wake"]);
    expect(deadlineWakes(h)).toEqual([]);
    expect(await mark(writer, "white", presence())).toMatchObject({
      kind: "refused",
      reason: "game_not_awaiting",
    });
  });

  it("TST-RT-LIFE-010 any load after the deadline aborts an overdue game, with no timer or connection needed", async () => {
    const h = lifecycleHarness();
    h.wall.set(START_DEADLINE_MS + 5_000);
    await store(h.h, awaitingGame());
    const view = await viewOf(h.writer);
    expect(view).toMatchObject({ sequence: 1, condition: "aborted_before_start" });
    expect(h.h.facts.named("game_start_aborted").map((fact) => fact.via)).toEqual(["load"]);
    expect(await viewOf(h.writer)).toMatchObject({ sequence: 1 });
    expect(h.h.facts.count("game_start_aborted")).toBe(1);
  });

  it("TST-RT-LIFE-011 expireAwaitingGames aborts only overdue games from its bounded index", async () => {
    const asked: number[] = [];
    let failing = false;
    const index: AwaitingGameIndex = {
      dueAwaitingGames: async (_now, limit) => {
        asked.push(limit);
        if (failing) return err({ kind: "persistence_failure", operation: "load", code: null });
        const readGame: readonly GameId[] = [GAME_ID];
        return ok(readGame);
      },
    };
    const early = await created(index);
    expect(await early.h.registry.expireAwaitingGames(10)).toBe(0);
    expect((await storedState(early.h)).sequence).toBe(0);

    early.wall.set(START_DEADLINE_MS);
    expect(await early.h.registry.expireAwaitingGames(10)).toBe(1);
    expect((await storedState(early.h)).status.kind).toBe("aborted_before_start");
    expect(asked).toEqual([10, 10]);

    failing = true;
    expect(await early.h.registry.expireAwaitingGames(10)).toBe(0);
    expect(early.h.facts.count("awaiting_sweep_failed")).toBe(1);

    const noIndex = await created();
    noIndex.wall.set(START_DEADLINE_MS);
    expect(await noIndex.h.registry.expireAwaitingGames(10)).toBe(0);
  });

  it("TST-RT-LIFE-012 a restart before the start is no recovery pause: the game still awaits both players", async () => {
    const h = lifecycleHarness();
    await store(h.h, awaitingGame(), DOMAIN_OLD);
    const view = await viewOf(h.writer);
    expect(view).toMatchObject({
      condition: "awaiting_players",
      recoveryReason: null,
      sequence: 0,
    });
    await mark(h.writer, "white", presence());
    expect(await mark(h.writer, "black", presence())).toMatchObject({ kind: "started" });
  });

  it("TST-RT-LIFE-013 a restart after the start keeps the existing recovery pause", async () => {
    const first = await created();
    await mark(first.writer, "white", presence());
    await mark(first.writer, "black", presence());
    const started = await storedState(first.h);
    const restarted = lifecycleHarness();
    await store(restarted.h, started, DOMAIN_OLD);
    const view = await viewOf(restarted.writer);
    expect(view).toMatchObject({
      condition: "recovery_paused",
      recoveryReason: "RECOVERY_PAUSED_CLOCK_DOMAIN_CHANGED",
      sequence: 1,
    });
  });

  it("TST-RT-LIFE-014 the final ready and a first move racing it: the move is never received before the start", async () => {
    const { h, writer } = await created();
    await mark(writer, "white", presence());
    h.repository.hold();
    const final = mark(writer, "black", presence());
    const early = writer.submitCommand(
      { gameId: GAME_ID, playerId: PLAYERS.white, seat: "white", controlLeaseId: LEASES.white },
      moveCommand(awaitingGame(), "e2e4"),
      () => {
        throw new Error("a refused command is never answered");
      },
    );
    expect(early).toMatchObject({ accepted: false, reason: "not_in_play" });
    h.repository.release();
    expect(await final).toMatchObject({ kind: "started" });
    const started = await storedState(h);
    h.clock.advance(40);
    const move = submitAs(writer, started, "white", moveCommand(started, "e2e4"));
    expect(move.ingress).toMatchObject({ accepted: true });
    expect(await decided(move)).toMatchObject({ code: "Accepted", sequence: 2 });
    expect((await storedState(h)).clock.remainingMs.white).toBe(INITIAL_MS - 40);
  });

  it("TST-RT-LIFE-015 a start whose commit fails is not a start: no clock runs and the game is not in play", async () => {
    const { h, writer } = await created();
    await mark(writer, "white", presence());
    h.repository.commitFault = "fail";
    const outcome = await mark(writer, "black", presence());
    expect(outcome.kind).not.toBe("started");
    expect(h.facts.count("game_started")).toBe(0);
    const stored = await storedState(h);
    expect(stored.sequence).toBe(0);
    expect(stored.clock.running).toBe(false);
  });
});
