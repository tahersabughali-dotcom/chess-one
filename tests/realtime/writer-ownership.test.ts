import { describe, expect, it, vi } from "vitest";
import { GAME_ID, moveCommand, newGame } from "../live-game/support/harness.ts";
import { ContractRepository } from "../live-game-persistence/support/contract-repository.ts";
import {
  DOMAIN_OLD,
  deadlineWakes,
  decided,
  RecordingSubscriber,
  type RuntimeHarness,
  runtimeHarness,
  store,
  storedState,
  storeInPlay,
  submitAs,
  syncOf,
  viewOf,
  writerOf,
} from "./support/runtime.ts";

const OWNERSHIP = "CONCURRENCY_OWNERSHIP_UNCERTAIN";
const OWNERSHIP_RECOVERY = { kind: "recovery_required", gameId: GAME_ID, reason: OWNERSHIP };

/** Two processes over one store, as LIVE-WRITER-OWNERSHIP-001 does not support. */
function twoProcesses(initialMs?: number) {
  const contract = new ContractRepository();
  const a = runtimeHarness({}, contract);
  const b = runtimeHarness({}, contract);
  const s0 = newGame(initialMs === undefined ? {} : { initialMs });
  return { a, b, s0 };
}

function expectNoFault(...harnesses: RuntimeHarness[]): void {
  for (const h of harnesses) {
    expect(h.facts.count("writer_fault")).toBe(0);
    expect(h.defects.errors).toEqual([]);
  }
}

describe("TST-RT-OWN concurrency conflicts stop the writer and pause the game (LIVE-WRITER-OWNERSHIP-001)", () => {
  it("TST-RT-OWN-001 a real sequence conflict: writer A stops, no writer B, no timer, no charge, no false update, recovery required, the store stays the truth", async () => {
    const { a, b, s0 } = twoProcesses();
    await store(a, s0);

    // 1. Writer A runs the game and watches its deadline; so does writer B.
    expect((await a.registry.activate(GAME_ID)).kind).toBe("watching");
    expect((await b.registry.activate(GAME_ID)).kind).toBe("watching");
    const writerA = writerOf(a);
    const subscriber = new RecordingSubscriber();
    writerA.subscribe(subscriber);
    expect(deadlineWakes(a)).toHaveLength(1);

    // 2. Another writer commits between A's load and A's commit.
    const foreign = moveCommand(s0, "d2d4");
    a.repository.beforeCommit = async () => {
      expect((await decided(submitAs(writerOf(b), s0, "white", foreign))).code).toBe("Accepted");
    };
    a.clock.set(1_200);
    const move = submitAs(writerA, s0, "white", moveCommand(s0, "e2e4"));
    const queuedCommand = submitAs(writerA, s0, "white", moveCommand(s0, "g1f3"));
    const queuedSync = syncOf(writerA);
    expect(await move.outcome).toEqual(OWNERSHIP_RECOVERY);
    expect(await queuedCommand.outcome).toEqual(OWNERSHIP_RECOVERY);
    expect(await queuedSync).toEqual({ kind: "unavailable", reason: "temporarily_unavailable" });
    expect(a.facts.named("concurrency_conflict")).toEqual([
      { name: "concurrency_conflict", gameId: GAME_ID, detectedBy: "commit" },
    ]);

    // 3. Writer A stops.
    await vi.waitFor(() => expect(a.registry.size).toBe(0));
    expect(a.facts.named("writer_retired")).toEqual([
      { name: "writer_retired", gameId: GAME_ID, reason: "concurrency_conflict" },
    ]);
    // 4. No writer B is started by itself.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(a.registry.size).toBe(0);
    expect(a.facts.count("writer_created")).toBe(1);
    // 5. No competitive timer runs.
    expect(a.scheduler.pending()).toEqual([]);
    // 7. No false game_update.
    expect(subscriber.views).toEqual([]);
    // 8. Subscribers are told recovery is required, then to sync.
    expect(subscriber.recoveries).toEqual([OWNERSHIP]);
    expect(subscriber.stopped).toBe(1);
    expect(a.registry.infrastructurePause(GAME_ID)).toBe(OWNERSHIP);

    // 9. The store is the truth: the other writer's move, never overwritten.
    const stored = await storedState(a);
    expect(stored.sequence).toBe(1);
    expect(stored.commandBindings.map((binding) => binding.clientCommandId)).toEqual([
      foreign.clientCommandId,
    ]);
    expect(a.repository.commits).toBe(0);

    // 6. Nothing is charged after the conflict: much later, a client's own
    // sync reads the stored balances, stopped, and play stays refused.
    a.clock.set(900_000);
    const reader = writerOf(a);
    const view = await viewOf(reader);
    expect([view.sequence, view.condition, view.recoveryReason]).toEqual([
      1,
      "infrastructure_paused",
      OWNERSHIP,
    ]);
    expect(view.clock).toEqual({
      remainingMs: stored.clock.remainingMs,
      activeSide: "black",
      running: false,
    });
    expect(submitAs(reader, stored, "black", moveCommand(stored, "e7e5")).ingress).toEqual({
      accepted: false,
      reason: "infrastructure_paused",
      recovery: OWNERSHIP,
    });
    expect(deadlineWakes(a)).toEqual([]);
    expect(await storedState(a)).toEqual(stored);
    expect(subscriber.views).toEqual([]);
    expectNoFault(a, b);
  });

  it("TST-RT-OWN-002 a command decided on a sequence the writer never published is refused before the store: no commit on top of another writer", async () => {
    const { a, b, s0 } = twoProcesses();
    await store(a, s0);
    await a.registry.activate(GAME_ID);
    await b.registry.activate(GAME_ID);
    const writerA = writerOf(a);
    const subscriber = new RecordingSubscriber();
    writerA.subscribe(subscriber);
    const foreign = moveCommand(s0, "d2d4");
    expect((await decided(submitAs(writerOf(b), s0, "white", foreign))).code).toBe("Accepted");
    const afterForeign = await storedState(a);

    a.clock.set(1_300);
    const reply = submitAs(writerA, afterForeign, "black", moveCommand(afterForeign, "e7e5"));
    expect(await reply.outcome).toEqual(OWNERSHIP_RECOVERY);
    expect(a.facts.named("concurrency_conflict")).toEqual([
      { name: "concurrency_conflict", gameId: GAME_ID, detectedBy: "load" },
    ]);
    expect(await storedState(a)).toEqual(afterForeign);
    expect(a.repository.commits).toBe(0);
    expect(subscriber.views).toEqual([]);
    expect(subscriber.recoveries).toEqual([OWNERSHIP]);
    await vi.waitFor(() => expect(a.registry.size).toBe(0));
    expect(a.scheduler.pending()).toEqual([]);
    expectNoFault(a, b);
  });

  it("TST-RT-OWN-003 a stale deadline wake after another writer's commit flags nothing and pauses", async () => {
    const { a, b, s0 } = twoProcesses(1_000);
    await store(a, s0);
    await a.registry.activate(GAME_ID);
    await b.registry.activate(GAME_ID);
    const wake = a.scheduler.single();
    b.clock.set(1_500);
    expect((await decided(submitAs(writerOf(b), s0, "white", moveCommand(s0, "d2d4")))).code).toBe(
      "Accepted",
    );
    const afterForeign = await storedState(a);

    a.clock.set(3_000);
    a.scheduler.fire(wake);
    await vi.waitFor(() => expect(a.registry.size).toBe(0));
    expect(a.facts.count("deadline_flagged")).toBe(0);
    expect(a.facts.named("concurrency_conflict")).toEqual([
      { name: "concurrency_conflict", gameId: GAME_ID, detectedBy: "load" },
    ]);
    expect(await storedState(a)).toEqual(afterForeign);
    expect(a.registry.infrastructurePause(GAME_ID)).toBe(OWNERSHIP);
    expect(a.scheduler.pending()).toEqual([]);
    expectNoFault(a, b);
  });

  it("TST-RT-OWN-004 a sync that finds a sequence the writer never published pauses instead of serving it", async () => {
    const { a, b, s0 } = twoProcesses();
    await store(a, s0);
    await a.registry.activate(GAME_ID);
    await b.registry.activate(GAME_ID);
    const writerA = writerOf(a);
    const subscriber = new RecordingSubscriber();
    writerA.subscribe(subscriber);
    expect((await decided(submitAs(writerOf(b), s0, "white", moveCommand(s0, "d2d4")))).code).toBe(
      "Accepted",
    );
    expect(await syncOf(writerA)).toEqual(OWNERSHIP_RECOVERY);
    expect(subscriber.views).toEqual([]);
    expect(subscriber.recoveries).toEqual([OWNERSHIP]);
    await vi.waitFor(() => expect(subscriber.stopped).toBe(1));
    expect(a.facts.named("concurrency_conflict")).toEqual([
      { name: "concurrency_conflict", gameId: GAME_ID, detectedBy: "load" },
    ]);
    expectNoFault(a, b);
  });

  it("TST-RT-OWN-005 WRITER_FAULT is only an unexpected exception: rejections, persistence failures, conflicts, and clock-domain pauses keep their own paths", async () => {
    const rejected = runtimeHarness();
    const s0 = newGame();
    await storeInPlay(rejected, s0);
    const illegal = await decided(
      submitAs(writerOf(rejected), s0, "white", moveCommand(s0, "e2e5")),
    );
    expect(illegal.code).not.toBe("Accepted");
    expect(rejected.registry.infrastructurePause(GAME_ID)).toBeUndefined();

    const persistence = runtimeHarness();
    await storeInPlay(persistence, s0);
    persistence.repository.commitFault = "fail";
    expect(
      await submitAs(writerOf(persistence), s0, "white", moveCommand(s0, "e2e4")).outcome,
    ).toEqual({ kind: "recovery_required", gameId: GAME_ID, reason: "PERSISTENCE_UNAVAILABLE" });

    const conflict = runtimeHarness();
    await storeInPlay(conflict, s0);
    conflict.repository.commitFault = "conflict";
    expect(
      await submitAs(writerOf(conflict), s0, "white", moveCommand(s0, "e2e4")).outcome,
    ).toEqual(OWNERSHIP_RECOVERY);

    const domain = runtimeHarness();
    await store(domain, s0, DOMAIN_OLD);
    expect(await submitAs(writerOf(domain), s0, "white", moveCommand(s0, "e2e4")).outcome).toEqual({
      kind: "recovery_required",
      gameId: GAME_ID,
      reason: "RECOVERY_PAUSED_CLOCK_DOMAIN_CHANGED",
    });
    expectNoFault(rejected, persistence, conflict, domain);

    const defect = runtimeHarness();
    await storeInPlay(defect, s0);
    defect.repository.loadThrows = true;
    expect(await submitAs(writerOf(defect), s0, "white", moveCommand(s0, "e2e4")).outcome).toEqual({
      kind: "recovery_required",
      gameId: GAME_ID,
      reason: "WRITER_FAULT",
    });
    expect(defect.facts.named("writer_fault")).toEqual([
      { name: "writer_fault", gameId: GAME_ID, job: "command" },
    ]);
    expect(defect.defects.errors).toHaveLength(1);
    expect(JSON.stringify(defect.facts.facts)).not.toMatch(/injected|Error|stack/);
  });
});
