import {
  createSystemClockDomain,
  createSystemWakeScheduler,
  GameWriterRegistry,
  type RuntimeFact,
} from "@chess-one/live-game-runtime";
import { describe, expect, it, vi } from "vitest";
import {
  duration,
  GAME_ID,
  INITIAL_MS,
  LEASES,
  moveCommand,
  newGame,
  OTHER_GAME_ID,
  PLAYERS,
  playMoves,
  START_MS,
} from "../live-game/support/harness.ts";
import { ContractRepository } from "../live-game-persistence/support/contract-repository.ts";
import { activeWithBindings, checkmate } from "../live-game-persistence/support/states.ts";
import { DefectLog, RecordingFacts } from "./support/facts.ts";
import {
  DOMAIN_OLD,
  decided,
  IDLE_MS,
  RecordingSubscriber,
  runtimeHarness,
  store,
  storedState,
  submitAs,
  syncOf,
  viewOf,
  writerOf,
} from "./support/runtime.ts";

describe("TST-RT writer registry and ingress", () => {
  it("TST-RT-001 one writer per game; every caller of a game gets the same writer", async () => {
    const h = runtimeHarness();
    await store(h, newGame());
    const first = h.registry.acquire(GAME_ID);
    const second = h.registry.acquire(GAME_ID);
    const other = h.registry.acquire(OTHER_GAME_ID);
    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(other).not.toBe(first);
    expect(h.registry.size).toBe(2);
    expect(h.facts.count("writer_created")).toBe(2);
  });

  it("TST-RT-002 a burst is processed in ingress order; receivedAt is stamped at ingress and queue delay is not charged", async () => {
    const h = runtimeHarness();
    const s0 = newGame();
    const s1 = playMoves(s0, ["e2e4"]).state;
    const s2 = playMoves(s0, ["e2e4", "e7e5"]).state;
    await store(h, s0);
    const writer = writerOf(h);
    const subscriber = new RecordingSubscriber();
    writer.subscribe(subscriber);

    h.repository.hold();
    h.clock.set(1_100);
    const a = submitAs(writer, s0, "white", moveCommand(s0, "e2e4"));
    h.clock.set(1_200);
    const b = submitAs(writer, s1, "black", moveCommand(s1, "e7e5"));
    h.clock.set(1_300);
    const c = submitAs(writer, s2, "white", moveCommand(s2, "g1f3"));
    expect([a.ingress, b.ingress, c.ingress]).toEqual([
      { accepted: true, receivedAt: 1_100 },
      { accepted: true, receivedAt: 1_200 },
      { accepted: true, receivedAt: 1_300 },
    ]);
    h.clock.set(90_000);
    h.repository.release();

    const responses = await Promise.all([decided(a), decided(b), decided(c)]);
    expect(responses.map((r) => [r.code, r.sequence, r.receivedAtMonotonicMs])).toEqual([
      ["Accepted", 1, 1_100],
      ["Accepted", 2, 1_200],
      ["Accepted", 3, 1_300],
    ]);
    const last = responses[2];
    expect(last?.clock.remainingMs).toEqual({ white: INITIAL_MS - 200, black: INITIAL_MS - 100 });
    expect(last?.clock.anchorMs).toBe(1_300);
    expect(subscriber.sequences()).toEqual([1, 2, 3]);
    expect(h.defects.errors).toEqual([]);
  });

  it("TST-RT-003 a full writer queue refuses with no stamp; a refused command was never received", async () => {
    const h = runtimeHarness({ maxQueuedRequests: 2 });
    const s0 = newGame();
    const s1 = playMoves(s0, ["e2e4"]).state;
    const s2 = playMoves(s0, ["e2e4", "e7e5"]).state;
    await store(h, s0);
    const writer = writerOf(h);
    h.repository.hold();
    const a = submitAs(writer, s0, "white", moveCommand(s0, "e2e4"));
    const b = submitAs(writer, s1, "black", moveCommand(s1, "e7e5"));
    const c = submitAs(writer, s2, "white", moveCommand(s2, "g1f3"));
    expect(c.ingress).toEqual({ accepted: false, reason: "queue_full" });
    expect(h.facts.count("writer_queue_full")).toBe(1);
    h.repository.release();
    await Promise.all([decided(a), decided(b)]);
    expect(h.repository.commits).toBe(2);
    expect((await storedState(h)).sequence).toBe(2);

    h.clock.set(1_500);
    const retried = await decided(submitAs(writer, s2, "white", moveCommand(s2, "g1f3")));
    expect([retried.code, retried.sequence, retried.receivedAtMonotonicMs]).toEqual([
      "Accepted",
      3,
      1_500,
    ]);
  });

  it("TST-RT-004 duplicate submissions of one command execute once; the second is a replay", async () => {
    const h = runtimeHarness();
    const s0 = newGame();
    await store(h, s0);
    const writer = writerOf(h);
    const subscriber = new RecordingSubscriber();
    writer.subscribe(subscriber);
    h.repository.hold();
    const command = moveCommand(s0, "e2e4");
    const first = submitAs(writer, s0, "white", command);
    const second = submitAs(writer, s0, "white", command);
    h.repository.release();
    const [a, b] = await Promise.all([decided(first), decided(second)]);
    expect([a.code, a.replayedResponse, a.sequence]).toEqual(["Accepted", false, 1]);
    expect([b.code, b.replayedResponse, b.sequence]).toEqual(["Accepted", true, 1]);
    expect(h.repository.commits).toBe(1);
    expect(subscriber.sequences()).toEqual([1]);
    expect(h.facts.count("command_replayed")).toBe(1);
  });
});

describe("TST-RT deadlines in the writer's clock domain", () => {
  it("TST-RT-005 a command received exactly at the deadline is timely; 1 ms later is late", async () => {
    const timely = runtimeHarness();
    const s0 = newGame({ initialMs: 1_000 });
    await store(timely, s0);
    timely.clock.set(2_000);
    const atDeadline = await decided(
      submitAs(writerOf(timely), s0, "white", moveCommand(s0, "e2e4")),
    );
    expect([atDeadline.code, atDeadline.receivedAtMonotonicMs]).toEqual(["Accepted", 2_000]);
    expect(atDeadline.clock.remainingMs.white).toBe(0);

    const late = runtimeHarness();
    await store(late, s0);
    late.clock.set(2_001);
    const afterDeadline = await decided(
      submitAs(writerOf(late), s0, "white", moveCommand(s0, "e2e4")),
    );
    expect(afterDeadline.code).toBe("MoveReceivedAfterDeadline");
    const stored = await storedState(late);
    expect(stored.status.kind).not.toBe("active");
    expect(stored.clock.remainingMs.white).toBe(0);
    expect(stored.position.sideToMove).toBe("white");
  });

  it("TST-RT-006 the writer arms deadline + 1 and flags with no subscriber and no connection", async () => {
    const h = runtimeHarness();
    await store(h, newGame({ initialMs: 1_000 }));
    const writer = writerOf(h);
    await viewOf(writer);
    const wake = h.scheduler.single();
    expect(wake.delayMs).toBe(1_001);
    expect(h.registry.peek(GAME_ID)?.subscriberCount).toBe(0);
    h.clock.set(2_001);
    h.scheduler.fire(wake);
    await vi.waitFor(() => expect(h.facts.count("deadline_flagged")).toBe(1));
    const stored = await storedState(h);
    expect(stored.status).toEqual({
      kind: "unresolved",
      reason: "MATING_POSSIBILITY_UNRESOLVED",
      flaggedSide: "white",
    });
    expect([stored.clock.remainingMs.white, stored.clock.running]).toEqual([0, false]);
    expect(h.registry.peek(GAME_ID)?.deadlineArmed).toBe(false);
  });

  it("TST-RT-007 an early wake decides from the clock, flags nothing, and arms again", async () => {
    const h = runtimeHarness();
    await store(h, newGame({ initialMs: 1_000 }));
    const writer = writerOf(h);
    await viewOf(writer);
    h.clock.set(1_990);
    h.scheduler.fire(h.scheduler.single());
    await vi.waitFor(() => expect(h.scheduler.single().delayMs).toBe(11));
    expect(h.repository.commits).toBe(0);
    expect(h.facts.count("deadline_flagged")).toBe(0);
  });

  it("TST-RT-008 timer race: a command stamped at the deadline beats a late wake that ran first in the event loop", async () => {
    const h = runtimeHarness();
    const s0 = newGame({ initialMs: 1_000 });
    await store(h, s0);
    const writer = writerOf(h);
    await viewOf(writer);
    const wake = h.scheduler.single();
    h.repository.hold();
    h.clock.set(2_000);
    const move = submitAs(writer, s0, "white", moveCommand(s0, "e2e4"));
    h.clock.set(2_500);
    h.scheduler.fire(wake);
    h.repository.release();
    const response = await decided(move);
    expect([response.code, response.clock.remainingMs.white]).toEqual(["Accepted", 0]);
    await vi.waitFor(() => expect(h.registry.peek(GAME_ID)?.deadlineArmed).toBe(true));
    await vi.waitFor(() => expect(h.scheduler.single().delayMs).toBe(3_001 - 2_500));
    const stored = await storedState(h);
    expect([stored.sequence, stored.status.kind, stored.clock.activeSide]).toEqual([
      1,
      "active",
      "black",
    ]);
    expect(h.facts.count("deadline_flagged")).toBe(0);
  });

  it("TST-RT-009 timer race: a wake stamped after the deadline flags first; a later command cannot undo it", async () => {
    const h = runtimeHarness();
    const s0 = newGame({ initialMs: 1_000 });
    await store(h, s0);
    const writer = writerOf(h);
    await viewOf(writer);
    h.repository.hold();
    h.clock.set(2_001);
    h.scheduler.fire(h.scheduler.single());
    const move = submitAs(writer, s0, "white", moveCommand(s0, "e2e4"));
    h.repository.release();
    const response = await decided(move);
    expect(response.code).toBe("MatingPossibilityUnresolved");
    expect(h.facts.count("deadline_flagged")).toBe(1);
    expect((await storedState(h)).sequence).toBe(1);
  });

  it("TST-RT-010 timer race: a late command queued before the wake is late by its own stamp", async () => {
    const h = runtimeHarness();
    const s0 = newGame({ initialMs: 1_000 });
    await store(h, s0);
    const writer = writerOf(h);
    await viewOf(writer);
    const wake = h.scheduler.single();
    h.repository.hold();
    h.clock.set(2_001);
    const move = submitAs(writer, s0, "white", moveCommand(s0, "e2e4"));
    h.scheduler.fire(wake);
    h.repository.release();
    const response = await decided(move);
    expect(response.code).toBe("MoveReceivedAfterDeadline");
    await vi.waitFor(() => expect(h.registry.peek(GAME_ID)?.queuedRequests).toBe(0));
    await vi.waitFor(() => expect(h.registry.peek(GAME_ID)?.deadlineArmed).toBe(false));
    expect(h.facts.count("deadline_flagged")).toBe(0);
    expect((await storedState(h)).sequence).toBe(1);
  });
});

describe("TST-RT persistence failures and consistency", () => {
  it("TST-RT-011 a failed commit is never Accepted and publishes nothing; play pauses and the command id stays unbound", async () => {
    const h = runtimeHarness();
    const s0 = newGame();
    await store(h, s0);
    const writer = writerOf(h);
    const subscriber = new RecordingSubscriber();
    writer.subscribe(subscriber);
    const command = moveCommand(s0, "e2e4");
    h.repository.commitFault = "fail";
    h.clock.set(1_100);
    const failed = await submitAs(writer, s0, "white", command).outcome;
    expect(failed).toEqual({
      kind: "recovery_required",
      gameId: GAME_ID,
      reason: "PERSISTENCE_UNAVAILABLE",
    });
    expect(subscriber.views).toEqual([]);
    expect(subscriber.recoveries).toEqual(["PERSISTENCE_UNAVAILABLE"]);
    const stored = await storedState(h);
    expect([stored.sequence, stored.commandBindings.length]).toEqual([0, 0]);
    expect(h.facts.named("persistence_failure")).toEqual([
      { name: "persistence_failure", gameId: GAME_ID, operation: "commit" },
    ]);

    h.repository.commitFault = "none";
    h.clock.set(1_200);
    expect(submitAs(writer, s0, "white", command).ingress).toEqual({
      accepted: false,
      reason: "infrastructure_paused",
      recovery: "PERSISTENCE_UNAVAILABLE",
    });
    expect(h.repository.commits).toBe(0);
  });

  it("TST-RT-012 an ambiguous commit (applied, reported failed) is not Accepted; the landed transition is served paused and its binding replays later", async () => {
    const h = runtimeHarness();
    const s0 = newGame();
    await store(h, s0);
    const writer = writerOf(h);
    const subscriber = new RecordingSubscriber();
    writer.subscribe(subscriber);
    const command = moveCommand(s0, "e2e4");
    h.repository.commitFault = "apply_then_fail";
    h.clock.set(1_100);
    const first = await submitAs(writer, s0, "white", command).outcome;
    expect(first).toEqual({
      kind: "recovery_required",
      gameId: GAME_ID,
      reason: "PERSISTENCE_UNAVAILABLE",
    });
    expect(subscriber.views).toEqual([]);
    const stored = await storedState(h);
    expect([stored.sequence, stored.commandBindings.length]).toEqual([1, 1]);

    h.repository.commitFault = "none";
    h.clock.set(60_000);
    const view = await viewOf(writer);
    expect([view.sequence, view.condition, view.recoveryReason]).toEqual([
      1,
      "infrastructure_paused",
      "PERSISTENCE_UNAVAILABLE",
    ]);
    expect(view.clock).toEqual({
      remainingMs: stored.clock.remainingMs,
      activeSide: "black",
      running: false,
    });
    expect(subscriber.sequences()).toEqual([1]);
    expect(submitAs(writer, s0, "white", command).ingress.accepted).toBe(false);
    expect(h.repository.commits).toBe(1);
  });

  it("TST-RT-013 a concurrency conflict pauses the game and stops the writer: no overwrite, no retry, waiting requests answered, subscribers told, no writer started by itself", async () => {
    const h = runtimeHarness();
    const s0 = newGame();
    await store(h, s0);
    const writer = writerOf(h);
    const subscriber = new RecordingSubscriber();
    writer.subscribe(subscriber);
    h.repository.commitFault = "conflict";
    h.repository.hold();
    const move = submitAs(writer, s0, "white", moveCommand(s0, "e2e4"));
    const waiting = syncOf(writer);
    h.repository.release();
    expect(await move.outcome).toEqual({
      kind: "recovery_required",
      gameId: GAME_ID,
      reason: "CONCURRENCY_OWNERSHIP_UNCERTAIN",
    });
    expect(await waiting).toEqual({ kind: "unavailable", reason: "temporarily_unavailable" });
    expect(subscriber.recoveries).toEqual(["CONCURRENCY_OWNERSHIP_UNCERTAIN"]);
    expect(subscriber.stopped).toBe(1);
    expect(subscriber.views).toEqual([]);
    expect(h.facts.named("writer_retired")).toEqual([
      { name: "writer_retired", gameId: GAME_ID, reason: "concurrency_conflict" },
    ]);
    expect(h.repository.commits).toBe(0);
    expect(h.registry.infrastructurePause(GAME_ID)).toBe("CONCURRENCY_OWNERSHIP_UNCERTAIN");
    expect(h.registry.size).toBe(0);
    expect(h.facts.count("writer_created")).toBe(1);
    expect(h.scheduler.pending()).toEqual([]);
    expect(h.facts.count("writer_fault")).toBe(0);
    expect(h.defects.errors).toEqual([]);
  });

  it("TST-RT-014 a game stored by another clock domain is recovery-paused: no timer, no play, stored replays still answered", async () => {
    const fixture = activeWithBindings();
    const h = runtimeHarness();
    await store(h, fixture.state, DOMAIN_OLD);
    const writer = writerOf(h);
    const view = await viewOf(writer);
    expect(view.condition).toBe("recovery_paused");
    expect(view.clock).toEqual({
      remainingMs: fixture.state.clock.remainingMs,
      activeSide: fixture.state.clock.activeSide,
      running: false,
    });
    expect(h.scheduler.pending().filter((wake) => wake.delayMs !== IDLE_MS)).toEqual([]);
    expect(h.registry.peek(GAME_ID)?.deadlineArmed).toBe(false);

    const state = fixture.state;
    const fresh = await submitAs(writer, state, "black", moveCommand(state, "g8f6")).outcome;
    expect(fresh).toEqual({
      kind: "recovery_required",
      gameId: GAME_ID,
      reason: "RECOVERY_PAUSED_CLOCK_DOMAIN_CHANGED",
    });
    expect(view.recoveryReason).toBe("RECOVERY_PAUSED_CLOCK_DOMAIN_CHANGED");
    expect(h.registry.infrastructurePause(GAME_ID)).toBeUndefined();

    const replay = await decided(
      submitAs(writer, state, "black", {
        command: "SubmitMoveCommand.v1",
        contractVersion: "1",
        gameId: GAME_ID,
        clientCommandId: "black-3-bad-promotion",
        controlLeaseId: LEASES.black,
        expectedGameSequence: 3,
        fromSquare: "b8",
        toSquare: "c6",
        promotionPiece: "q",
      }),
    );
    expect([replay.code, replay.replayedResponse]).toEqual(["InvalidState", true]);
    expect(h.repository.commits).toBe(0);
    expect(h.facts.count("recovery_pause_encountered")).toBe(1);
  });

  it("TST-RT-015 an unknown game is answered game_not_found and its writer retires", async () => {
    const h = runtimeHarness();
    const outcome = await syncOf(writerOf(h, OTHER_GAME_ID));
    expect(outcome).toEqual({ kind: "unavailable", reason: "game_not_found" });
    await vi.waitFor(() => expect(h.registry.size).toBe(0));
  });
});

describe("TST-RT writer lifecycle", () => {
  it("TST-RT-016 a stopped game's idle writer retires; a running game keeps its writer with no subscriber", async () => {
    const finished = runtimeHarness();
    await store(finished, checkmate().state);
    const writer = writerOf(finished);
    const subscriber = new RecordingSubscriber();
    writer.subscribe(subscriber);
    await viewOf(writer);
    expect(finished.scheduler.pending()).toEqual([]);
    writer.unsubscribe(subscriber);
    const idle = await vi.waitFor(() => finished.scheduler.single());
    expect(idle.delayMs).toBe(IDLE_MS);
    finished.scheduler.fire(idle);
    expect(finished.registry.size).toBe(0);
    expect(finished.facts.named("writer_retired")).toEqual([
      { name: "writer_retired", gameId: GAME_ID, reason: "idle" },
    ]);

    const running = runtimeHarness();
    await store(running, newGame());
    await viewOf(writerOf(running));
    expect(running.scheduler.pending().map((wake) => wake.delayMs)).toEqual([INITIAL_MS + 1]);
    expect(running.registry.size).toBe(1);
  });

  it("TST-RT-017 dispose finishes the job in progress, answers the rest, cancels every timer, and acquires nothing more", async () => {
    const h = runtimeHarness();
    const s0 = newGame();
    await store(h, s0);
    const writer = writerOf(h);
    await viewOf(writer);
    h.repository.hold();
    const move = submitAs(writer, s0, "white", moveCommand(s0, "e2e4"));
    const waiting = syncOf(writer);
    await vi.waitFor(() => expect(h.repository.heldLoads).toBe(1));
    const disposing = h.registry.dispose();
    expect(h.registry.acquire(GAME_ID)).toBeNull();
    h.repository.release();
    await disposing;
    expect((await decided(move)).code).toBe("Accepted");
    expect(await waiting).toEqual({ kind: "unavailable", reason: "temporarily_unavailable" });
    expect(h.scheduler.pending()).toEqual([]);
    expect(submitAs(writer, s0, "white", moveCommand(s0, "d2d4")).ingress).toEqual({
      accepted: false,
      reason: "writer_stopped",
    });
  });

  it("TST-RT-018 subscribers are bounded, and a throwing subscriber is dropped and reported without stopping the writer", async () => {
    const bounded = runtimeHarness({ maxSubscribers: 1 });
    await store(bounded, newGame());
    const writer = writerOf(bounded);
    const a = new RecordingSubscriber();
    expect(writer.subscribe(a)).toBe("subscribed");
    expect(writer.subscribe(a)).toBe("already_subscribed");
    expect(writer.subscribe(new RecordingSubscriber())).toBe("limit_reached");

    const h = runtimeHarness();
    const s0 = newGame();
    await store(h, s0);
    const port = writerOf(h);
    port.subscribe({
      onUpdate: () => {
        throw new Error("subscriber bug");
      },
      onRecoveryRequired: () => undefined,
      onWriterStopped: () => undefined,
    });
    expect((await decided(submitAs(port, s0, "white", moveCommand(s0, "e2e4")))).code).toBe(
      "Accepted",
    );
    expect(h.registry.peek(GAME_ID)?.subscriberCount).toBe(0);
    expect(h.defects.errors).toHaveLength(1);
    const s1 = playMoves(s0, ["e2e4"]).state;
    expect((await decided(submitAs(port, s1, "black", moveCommand(s1, "e7e5")))).sequence).toBe(2);
  });

  it("TST-RT-019 a game started through the registry is watched at once, with no connection", async () => {
    const h = runtimeHarness();
    h.clock.set(5_000);
    const started = await h.registry.startGame({
      gameId: GAME_ID,
      players: PLAYERS,
      controlLeases: LEASES,
      timeControl: newGame().clock.timeControl,
    });
    if (!started.ok) throw new Error("game not started");
    expect(started.value.activation.kind).toBe("watching");
    expect(h.registry.peek(GAME_ID)?.deadlineArmed).toBe(true);
    expect(h.scheduler.single().delayMs).toBe(INITIAL_MS + 1);
    expect((await storedState(h)).clock.anchorMs).toBe(5_000);
  });

  it("TST-RT-020 the writer count is bounded", () => {
    const h = runtimeHarness({ maxWriters: 1 });
    expect(h.registry.acquire(GAME_ID)).not.toBeNull();
    expect(h.registry.acquire(OTHER_GAME_ID)).toBeNull();
    expect(h.facts.count("writer_capacity_reached")).toBe(1);
  });

  it("TST-RT-021 the view shows live balances and nothing internal", async () => {
    const h = runtimeHarness();
    await store(h, newGame());
    h.clock.set(START_MS + 5_000);
    const view = await viewOf(writerOf(h));
    expect(Object.keys(view).sort()).toEqual([
      "clock",
      "condition",
      "gameId",
      "pendingDrawOffer",
      "positionFen",
      "recoveryReason",
      "rulesetId",
      "sequence",
      "sideToMove",
      "status",
    ]);
    expect(view.recoveryReason).toBeNull();
    expect(view.clock).toEqual({
      remainingMs: { white: INITIAL_MS - 5_000, black: INITIAL_MS },
      activeSide: "white",
      running: true,
    });
    expect(JSON.stringify(view)).not.toMatch(/anchor|lease|binding|fingerprint|clockDomain/i);
  });
});

describe("TST-RT the system clock domain", () => {
  it("TST-RT-022 each system domain has a fresh boot id and an integer clock that never goes backwards", () => {
    const a = createSystemClockDomain();
    const b = createSystemClockDomain();
    expect(a.id).toMatch(
      /^boot-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(b.id).not.toBe(a.id);
    const readings = Array.from({ length: 1_000 }, () => a.clock.now());
    expect(
      readings.every((value, i) => Number.isSafeInteger(value) && value >= (readings[i - 1] ?? 0)),
    ).toBe(true);
    expect(readings[0]).toBeLessThan(1_000);
  });

  it("TST-RT-023 on real timers a registry-started game flags at its deadline with no subscriber and no connection", async () => {
    const clockDomain = createSystemClockDomain();
    const facts = new RecordingFacts<RuntimeFact>();
    const defects = new DefectLog();
    const contract = new ContractRepository();
    const registry = new GameWriterRegistry({
      repository: contract,
      clockDomain,
      scheduler: createSystemWakeScheduler(),
      facts,
      reportDefect: defects.report,
    });
    const created = await registry.startGame({
      gameId: GAME_ID,
      players: PLAYERS,
      controlLeases: LEASES,
      timeControl: { kind: "sudden_death", initialMs: duration(60) },
    });
    expect(created.ok).toBe(true);
    await vi.waitFor(() => expect(facts.count("deadline_flagged")).toBe(1), { timeout: 5_000 });
    const loaded = await contract.loadGame(GAME_ID);
    expect(loaded.ok && loaded.value.state.status.kind).toBe("unresolved");
    expect(loaded.ok && loaded.value.clockDomainId).toBe(clockDomain.id);
    expect(registry.peek(GAME_ID)?.subscriberCount).toBe(0);
    const cancelled = vi.fn();
    createSystemWakeScheduler().wakeAfter(10, cancelled).cancel();
    await registry.dispose();
    expect(cancelled).not.toHaveBeenCalled();
    expect(defects.errors).toEqual([]);
  });
});
