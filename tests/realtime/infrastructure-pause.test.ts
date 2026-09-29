import { formatFen } from "@chess-one/chess-rules";
import { executeCommand } from "@chess-one/live-game";
import { describe, expect, it, vi } from "vitest";
import {
  actorFor,
  GAME_ID,
  INITIAL_MS,
  moveCommand,
  ms,
  newGame,
  playMoves,
  resignCommand,
} from "../live-game/support/harness.ts";
import { ContractRepository } from "../live-game-persistence/support/contract-repository.ts";
import { checkmate } from "../live-game-persistence/support/states.ts";
import {
  DOMAIN_A,
  DOMAIN_OLD,
  deadlineWakes,
  IDLE_MS,
  RecordingSubscriber,
  runtimeHarness,
  store,
  storedState,
  storeInPlay,
  submitAs,
  syncOf,
  viewOf,
  writerOf,
} from "./support/runtime.ts";

const PAUSED_REFUSAL = {
  accepted: false,
  reason: "infrastructure_paused",
  recovery: "PERSISTENCE_UNAVAILABLE",
};
const PERSISTENCE_RECOVERY = {
  kind: "recovery_required",
  gameId: GAME_ID,
  reason: "PERSISTENCE_UNAVAILABLE",
};

describe("TST-RT-PAUSE persistence outage pauses play at the last durable balances (LIVE-RETRY-RECEIPT-001)", () => {
  it("TST-RT-PAUSE-001 a legal move whose commit fails: nothing durable changes, the clock stops at the committed balances, and the command id stays reusable", async () => {
    const contract = new ContractRepository();
    const h = runtimeHarness({}, contract);
    const s0 = newGame();
    await store(h, s0);
    const writer = writerOf(h);
    const subscriber = new RecordingSubscriber();
    writer.subscribe(subscriber);
    await viewOf(writer);

    h.clock.set(1_250);
    const command = moveCommand(s0, "e2e4");
    h.repository.commitFault = "fail";
    const outcome = await submitAs(writer, s0, "white", command).outcome;
    expect(outcome).toEqual(PERSISTENCE_RECOVERY);

    const stored = await storedState(h);
    expect(stored.sequence).toBe(0);
    expect(formatFen(stored.position)).toBe(formatFen(s0.position));
    expect(stored.clock).toEqual(s0.clock);
    expect(stored.commandBindings).toEqual([]);
    expect(contract.outbox).toEqual([]);
    expect(contract.writes()).toEqual(["create"]);
    expect(subscriber.views).toEqual([]);
    expect(subscriber.recoveries).toEqual(["PERSISTENCE_UNAVAILABLE"]);
    expect(h.facts.count("command_accepted")).toBe(0);
    expect(h.registry.infrastructurePause(GAME_ID)).toBe("PERSISTENCE_UNAVAILABLE");

    expect(deadlineWakes(h)).toEqual([]);
    expect(h.registry.peek(GAME_ID)?.deadlineArmed).toBe(false);
    h.repository.commitFault = "none";
    h.clock.set(1_000 + INITIAL_MS + 60_000);
    const view = await viewOf(writer);
    expect([view.condition, view.recoveryReason, view.sequence]).toEqual([
      "infrastructure_paused",
      "PERSISTENCE_UNAVAILABLE",
      0,
    ]);
    expect(view.clock).toEqual({
      remainingMs: { white: INITIAL_MS, black: INITIAL_MS },
      activeSide: "white",
      running: false,
    });
    expect(view.status).toEqual({ kind: "active" });
    expect(h.facts.count("deadline_flagged")).toBe(0);

    expect(submitAs(writer, s0, "white", moveCommand(s0, "d2d4")).ingress).toEqual(PAUSED_REFUSAL);
    expect(submitAs(writer, s0, "white", command).ingress).toEqual(PAUSED_REFUSAL);
    expect((await storedState(h)).sequence).toBe(0);

    const resumed = contract.restarted();
    const later = await executeCommand(
      { repository: resumed, clockDomainId: DOMAIN_A },
      actorFor(s0, "white"),
      command,
      { receivedAtMonotonicMs: ms(1_300) },
    );
    if (!later.ok) throw new Error(`core refused: ${later.error.kind}`);
    expect(later.value.decision.response).toMatchObject({
      code: "Accepted",
      replayedResponse: false,
      clientCommandId: command.clientCommandId,
      sequence: 1,
    });
  });

  it("TST-RT-PAUSE-002 commands during the pause reach no queue, no repository, no binding, and no retry; the database coming back resumes nothing", async () => {
    const contract = new ContractRepository();
    const h = runtimeHarness({}, contract);
    const s0 = newGame();
    const s1 = playMoves(s0, ["e2e4"]).state;
    await storeInPlay(h, s0);
    const writer = writerOf(h);
    const subscriber = new RecordingSubscriber();
    writer.subscribe(subscriber);
    h.repository.commitFault = "fail";
    expect(await submitAs(writer, s0, "white", moveCommand(s0, "e2e4")).outcome).toEqual(
      PERSISTENCE_RECOVERY,
    );
    await vi.waitFor(() => expect(h.registry.peek(GAME_ID)?.queuedRequests).toBe(0));
    const loads = h.repository.loads;

    const attempts = [
      submitAs(writer, s0, "white", moveCommand(s0, "e2e4")),
      submitAs(writer, s0, "white", moveCommand(s0, "d2d4", { clientCommandId: "w-d4" })),
      submitAs(writer, s1, "black", moveCommand(s1, "e7e5")),
      submitAs(writer, s0, "black", resignCommand(s0, "black")),
      submitAs(writer, s0, "white", resignCommand(s0, "white")),
    ];
    for (const attempt of attempts) expect(attempt.ingress).toEqual(PAUSED_REFUSAL);
    expect(h.facts.count("command_refused_paused")).toBe(5);
    expect(h.registry.peek(GAME_ID)?.queuedRequests).toBe(0);
    expect(h.repository.loads).toBe(loads);
    expect(h.scheduler.pending()).toEqual([]);

    h.repository.commitFault = "none";
    h.clock.set(90_000);
    const view = await viewOf(writer);
    expect([view.condition, view.clock.running, view.clock.remainingMs.white]).toEqual([
      "infrastructure_paused",
      false,
      INITIAL_MS,
    ]);
    expect(submitAs(writer, s0, "white", moveCommand(s0, "e2e4")).ingress).toEqual(PAUSED_REFUSAL);
    const stored = await storedState(h);
    expect([stored.sequence, stored.commandBindings.length]).toEqual([0, 0]);
    expect(contract.writes()).toEqual(["create"]);
    expect(h.repository.commits).toBe(0);
    expect(h.facts.count("infrastructure_pause_entered")).toBe(1);
    expect(subscriber.recoveries).toEqual(["PERSISTENCE_UNAVAILABLE"]);
    expect(subscriber.views).toEqual([]);
  });

  it("TST-RT-PAUSE-003 commands already queued behind the failing commit are answered recovery_required and never executed", async () => {
    const h = runtimeHarness();
    const s0 = newGame();
    const s1 = playMoves(s0, ["e2e4"]).state;
    await store(h, s0);
    const writer = writerOf(h);
    await viewOf(writer);
    h.repository.commitFault = "fail";
    h.repository.hold();
    const first = submitAs(writer, s0, "white", moveCommand(s0, "e2e4"));
    const second = submitAs(writer, s1, "black", moveCommand(s1, "e7e5"));
    const sync = syncOf(writer);
    expect([first.ingress.accepted, second.ingress.accepted]).toEqual([true, true]);
    h.repository.release();
    expect(await first.outcome).toEqual(PERSISTENCE_RECOVERY);
    expect(await second.outcome).toEqual(PERSISTENCE_RECOVERY);
    const synced = await sync;
    expect(synced.kind === "snapshot" && synced.view.condition).toBe("infrastructure_paused");
    expect(h.repository.commits).toBe(0);
    expect((await storedState(h)).sequence).toBe(0);
  });

  it("TST-RT-PAUSE-004 a deadline check that cannot load pauses play: no flag, no retry, and the player keeps the time of the last commit", async () => {
    const h = runtimeHarness();
    await store(h, newGame({ initialMs: 1_000 }));
    const writer = writerOf(h);
    const subscriber = new RecordingSubscriber();
    writer.subscribe(subscriber);
    await viewOf(writer);
    const wake = h.scheduler.single();
    h.repository.loadFault = true;
    h.clock.set(2_001);
    h.scheduler.fire(wake);
    await vi.waitFor(() => expect(h.facts.count("infrastructure_pause_entered")).toBe(1));
    expect(h.facts.named("persistence_failure")).toEqual([
      { name: "persistence_failure", gameId: GAME_ID, operation: "load" },
    ]);
    expect(subscriber.recoveries).toEqual(["PERSISTENCE_UNAVAILABLE"]);
    expect(h.scheduler.pending()).toEqual([]);
    expect(h.facts.count("deadline_flagged")).toBe(0);

    h.repository.loadFault = false;
    h.clock.set(500_000);
    const view = await viewOf(writer);
    expect(view.status).toEqual({ kind: "active" });
    expect(view.clock).toEqual({
      remainingMs: { white: 1_000, black: 1_000 },
      activeSide: "white",
      running: false,
    });
    expect(h.scheduler.pending()).toEqual([]);
    expect(h.repository.commits).toBe(0);
  });

  it("TST-RT-PAUSE-005 a sync that cannot load pauses a game not known to be stopped; a finished game is only unavailable", async () => {
    const h = runtimeHarness();
    await store(h, newGame());
    h.repository.loadFault = true;
    expect(await syncOf(writerOf(h))).toEqual(PERSISTENCE_RECOVERY);
    h.repository.loadFault = false;
    expect((await viewOf(writerOf(h))).condition).toBe("infrastructure_paused");
    expect(deadlineWakes(h)).toEqual([]);

    const finished = runtimeHarness();
    await store(finished, checkmate().state);
    const writer = writerOf(finished);
    expect((await viewOf(writer)).condition).toBe("finished");
    finished.repository.loadFault = true;
    expect(await syncOf(writer)).toEqual({
      kind: "unavailable",
      reason: "temporarily_unavailable",
    });
    expect(finished.registry.infrastructurePause(GAME_ID)).toBeUndefined();
    finished.repository.loadFault = false;
    expect((await viewOf(writer)).condition).toBe("finished");
  });

  it("TST-RT-PAUSE-006 the pause outlives its writer: after idle retirement the next writer refuses play at once and arms no timer", async () => {
    const h = runtimeHarness();
    const s0 = newGame();
    await storeInPlay(h, s0);
    const writer = writerOf(h);
    const subscriber = new RecordingSubscriber();
    writer.subscribe(subscriber);
    h.repository.commitFault = "fail";
    await submitAs(writer, s0, "white", moveCommand(s0, "e2e4")).outcome;
    h.repository.commitFault = "none";
    writer.unsubscribe(subscriber);
    const idle = await vi.waitFor(() => h.scheduler.single());
    expect(idle.delayMs).toBe(IDLE_MS);
    h.scheduler.fire(idle);
    expect(h.registry.size).toBe(0);

    const next = writerOf(h);
    expect(next).not.toBe(writer);
    const loads = h.repository.loads;
    expect(submitAs(next, s0, "white", moveCommand(s0, "e2e4")).ingress).toEqual(PAUSED_REFUSAL);
    expect(h.repository.loads).toBe(loads);
    const view = await viewOf(next);
    expect([view.condition, view.clock.running]).toEqual(["infrastructure_paused", false]);
    expect(deadlineWakes(h)).toEqual([]);
    expect(h.facts.count("infrastructure_pause_entered")).toBe(1);
  });

  it("TST-RT-PAUSE-007 a writer defect pauses the running game as WRITER_FAULT: no clock is charged and no writer serves play", async () => {
    const h = runtimeHarness();
    const s0 = newGame();
    await store(h, s0);
    const writer = writerOf(h);
    const subscriber = new RecordingSubscriber();
    writer.subscribe(subscriber);
    await viewOf(writer);
    h.repository.loadThrows = true;
    h.clock.set(1_400);
    const outcome = await submitAs(writer, s0, "white", moveCommand(s0, "e2e4")).outcome;
    expect(outcome).toEqual({ kind: "recovery_required", gameId: GAME_ID, reason: "WRITER_FAULT" });
    expect(subscriber.recoveries).toEqual(["WRITER_FAULT"]);
    expect(subscriber.stopped).toBe(1);
    expect(h.defects.errors).toHaveLength(1);
    expect(h.facts.named("writer_fault")).toEqual([
      { name: "writer_fault", gameId: GAME_ID, job: "command" },
    ]);
    expect(h.registry.infrastructurePause(GAME_ID)).toBe("WRITER_FAULT");

    h.repository.loadThrows = false;
    const next = writerOf(h);
    expect(submitAs(next, s0, "white", moveCommand(s0, "e2e4")).ingress).toEqual({
      accepted: false,
      reason: "infrastructure_paused",
      recovery: "WRITER_FAULT",
    });
    h.clock.set(900_000);
    const view = await viewOf(next);
    expect([view.condition, view.recoveryReason, view.clock.remainingMs.white]).toEqual([
      "infrastructure_paused",
      "WRITER_FAULT",
      INITIAL_MS,
    ]);
    expect(deadlineWakes(h)).toEqual([]);
    expect(h.repository.commits).toBe(0);
  });

  it("TST-RT-PAUSE-008 a clock-domain pause and an infrastructure pause stay distinct", async () => {
    const h = runtimeHarness();
    const s0 = newGame();
    await store(h, s0, DOMAIN_OLD);
    const writer = writerOf(h);
    expect((await viewOf(writer)).recoveryReason).toBe("RECOVERY_PAUSED_CLOCK_DOMAIN_CHANGED");
    h.repository.loadFault = true;
    const outcome = await submitAs(writer, s0, "white", moveCommand(s0, "e2e4")).outcome;
    expect(outcome).toEqual({ kind: "unavailable", reason: "temporarily_unavailable" });
    expect(h.registry.infrastructurePause(GAME_ID)).toBeUndefined();
    h.repository.loadFault = false;
    const view = await viewOf(writer);
    expect([view.condition, view.recoveryReason]).toEqual([
      "recovery_paused",
      "RECOVERY_PAUSED_CLOCK_DOMAIN_CHANGED",
    ]);
    expect(await submitAs(writer, s0, "white", moveCommand(s0, "e2e4")).outcome).toEqual({
      kind: "recovery_required",
      gameId: GAME_ID,
      reason: "RECOVERY_PAUSED_CLOCK_DOMAIN_CHANGED",
    });
    expect(h.facts.count("infrastructure_pause_entered")).toBe(0);
  });
});
