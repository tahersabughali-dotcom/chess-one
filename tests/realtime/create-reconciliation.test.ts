import { describe, expect, it } from "vitest";
import { GAME_ID, LEASES, moveCommand, newGame, PLAYERS } from "../live-game/support/harness.ts";
import {
  deadlineWakes,
  type RuntimeHarness,
  runtimeHarness,
  storedState,
  submitAs,
  syncOf,
  viewOf,
  writerOf,
} from "./support/runtime.ts";

const SHORT = newGame({ initialMs: 1_000 }).clock.timeControl;
const GAME_PAUSED = { ok: false, error: { kind: "writer_refused", reason: "game_paused" } };

function start(h: RuntimeHarness) {
  return h.registry.startGame({
    gameId: GAME_ID,
    players: PLAYERS,
    controlLeases: LEASES,
    timeControl: SHORT,
  });
}

describe("TST-RT-CREATE a create reported failed is reconciled by a fresh read, never assumed", () => {
  it("TST-RT-CREATE-001 the insert landed but its acknowledgement failed: the read finds the game, which is held paused with no clock and no play", async () => {
    const h = runtimeHarness();
    h.repository.createFault = "apply_then_fail";
    expect(await start(h)).toEqual({
      ok: false,
      error: {
        kind: "create_unconfirmed",
        reconciliation: "stored",
        activation: { kind: "recovery_required", reason: "PERSISTENCE_UNAVAILABLE" },
      },
    });
    expect(h.facts.named("create_reconciled")).toEqual([
      { name: "create_reconciled", gameId: GAME_ID, outcome: "stored" },
    ]);
    expect(h.registry.infrastructurePause(GAME_ID)).toBe("PERSISTENCE_UNAVAILABLE");
    expect(h.registry.size).toBe(1);
    expect(h.registry.peek(GAME_ID)?.deadlineArmed).toBe(false);
    expect(deadlineWakes(h)).toEqual([]);

    const stored = await storedState(h);
    h.clock.set(900_000);
    const writer = writerOf(h);
    const view = await viewOf(writer);
    expect([view.condition, view.recoveryReason, view.clock]).toEqual([
      "infrastructure_paused",
      "PERSISTENCE_UNAVAILABLE",
      {
        initialMs: 1_000,
        remainingMs: { white: 1_000, black: 1_000 },
        activeSide: "white",
        running: false,
      },
    ]);
    expect(submitAs(writer, stored, "white", moveCommand(stored, "e2e4")).ingress).toEqual({
      accepted: false,
      reason: "infrastructure_paused",
      recovery: "PERSISTENCE_UNAVAILABLE",
    });
    expect(await start(h)).toEqual(GAME_PAUSED);
    expect(h.repository.creates).toBe(1);
    expect(await storedState(h)).toEqual(stored);
    expect(h.facts.count("deadline_flagged")).toBe(0);
    expect(h.defects.errors).toEqual([]);
  });

  it("TST-RT-CREATE-002 the insert did not happen: the read finds nothing, and the reservation is released with no writer, timer, or pause left", async () => {
    const h = runtimeHarness();
    h.repository.createFault = "fail";
    expect(await start(h)).toEqual({
      ok: false,
      error: { kind: "create_unconfirmed", reconciliation: "not_stored" },
    });
    expect(h.facts.named("create_reconciled")).toEqual([
      { name: "create_reconciled", gameId: GAME_ID, outcome: "not_stored" },
    ]);
    expect(h.registry.size).toBe(0);
    expect(h.registry.peek(GAME_ID)).toBeUndefined();
    expect(h.scheduler.pending()).toEqual([]);
    expect(h.registry.infrastructurePause(GAME_ID)).toBeUndefined();
    expect(h.facts.named("writer_retired")).toEqual([
      { name: "writer_retired", gameId: GAME_ID, reason: "disposed" },
    ]);
    expect((await h.contract.loadGame(GAME_ID)).ok).toBe(false);

    h.repository.createFault = "none";
    const retried = await start(h);
    expect(retried.ok && retried.value.activation.kind).toBe("watching");
    expect(h.registry.size).toBe(1);
    expect(deadlineWakes(h)).toHaveLength(1);
    expect(h.defects.errors).toEqual([]);
  });

  it("TST-RT-CREATE-003 the database is unreadable after the failure: outcome unknown, no gameplay, no competitive timer, reconciliation required", async () => {
    const h = runtimeHarness();
    h.repository.createFault = "apply_then_fail";
    h.repository.loadFault = true;
    const loadsBefore = h.repository.loads;
    expect(await start(h)).toEqual({
      ok: false,
      error: { kind: "create_unconfirmed", reconciliation: "unknown" },
    });
    expect(h.repository.loads).toBe(loadsBefore + 1);
    expect(h.facts.named("create_reconciled")).toEqual([
      { name: "create_reconciled", gameId: GAME_ID, outcome: "unknown" },
    ]);
    expect(h.facts.named("infrastructure_pause_entered")).toEqual([
      {
        name: "infrastructure_pause_entered",
        gameId: GAME_ID,
        reason: "CREATE_RECONCILIATION_REQUIRED",
      },
    ]);
    expect(h.registry.infrastructurePause(GAME_ID)).toBe("CREATE_RECONCILIATION_REQUIRED");
    expect(h.registry.size).toBe(0);
    expect(h.scheduler.pending()).toEqual([]);
    expect(await start(h)).toEqual(GAME_PAUSED);
    expect(h.repository.creates).toBe(1);

    h.repository.loadFault = false;
    const stored = await storedState(h);
    h.clock.set(900_000);
    const writer = writerOf(h);
    const view = await viewOf(writer);
    expect([view.condition, view.recoveryReason, view.clock]).toEqual([
      "infrastructure_paused",
      "CREATE_RECONCILIATION_REQUIRED",
      {
        initialMs: 1_000,
        remainingMs: { white: 1_000, black: 1_000 },
        activeSide: "white",
        running: false,
      },
    ]);
    expect(submitAs(writer, stored, "white", moveCommand(stored, "e2e4")).ingress).toEqual({
      accepted: false,
      reason: "infrastructure_paused",
      recovery: "CREATE_RECONCILIATION_REQUIRED",
    });
    expect(deadlineWakes(h)).toEqual([]);
    expect(await storedState(h)).toEqual(stored);
    expect(h.facts.count("deadline_flagged")).toBe(0);

    const lost = runtimeHarness();
    lost.repository.createFault = "fail";
    lost.repository.loadFault = true;
    expect(await start(lost)).toEqual({
      ok: false,
      error: { kind: "create_unconfirmed", reconciliation: "unknown" },
    });
    expect(await start(lost)).toEqual(GAME_PAUSED);
    lost.repository.loadFault = false;
    expect(await syncOf(writerOf(lost))).toEqual({ kind: "unavailable", reason: "game_not_found" });
    expect(lost.scheduler.pending()).toEqual([]);
    expect(h.defects.errors).toEqual([]);
    expect(lost.defects.errors).toEqual([]);
  });
});
