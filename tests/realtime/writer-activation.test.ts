import { describe, expect, it, vi } from "vitest";
import {
  GAME_ID,
  LEASES,
  moveCommand,
  newGame,
  OTHER_GAME_ID,
  PLAYERS,
} from "../live-game/support/harness.ts";
import { checkmate } from "../live-game-persistence/support/states.ts";
import { positionOf } from "../rules/support/positions.ts";
import {
  DOMAIN_OLD,
  deadlineWakes,
  type RuntimeHarness,
  runtimeHarness,
  store,
  storedState,
  submitAs,
  writerOf,
} from "./support/runtime.ts";

const QUEEN_VS_KING_BLACK_TO_MOVE = "4k3/8/8/8/8/8/8/3QK3 b - - 0 1";
const SHORT = newGame({ initialMs: 1_000 }).clock.timeControl;

function start(h: RuntimeHarness, fen?: string) {
  return h.registry.startGame({
    gameId: GAME_ID,
    players: PLAYERS,
    controlLeases: LEASES,
    timeControl: SHORT,
    ...(fen === undefined ? {} : { startPosition: positionOf(fen) }),
  });
}

describe("TST-RT-ACT writer activation (LIVE-WRITER-ACTIVATION-001)", () => {
  it("TST-RT-ACT-001 an activated game flags at its deadline with no WebSocket, no subscriber, and no command; UNKNOWN capability stays unresolved", async () => {
    const h = runtimeHarness();
    await store(h, newGame({ initialMs: 1_000 }));
    const activation = await h.registry.activate(GAME_ID);
    expect(activation.kind).toBe("watching");
    expect(h.registry.peek(GAME_ID)?.subscriberCount).toBe(0);
    const [wake] = deadlineWakes(h);
    expect(deadlineWakes(h)).toHaveLength(1);
    expect(wake?.delayMs).toBe(1_001);
    h.clock.set(2_001);
    if (wake === undefined) throw new Error("no deadline wake");
    h.scheduler.fire(wake);
    await vi.waitFor(() => expect(h.facts.count("deadline_flagged")).toBe(1));
    const stored = await storedState(h);
    expect(stored.status).toEqual({
      kind: "unresolved",
      reason: "MATING_POSSIBILITY_UNRESOLVED",
      flaggedSide: "white",
    });
    expect(h.registry.peek(GAME_ID)?.deadlineArmed).toBe(false);
  });

  it("TST-RT-ACT-002 a game started through the registry is watched before startGame returns; a flag with proven capability is a result", async () => {
    const h = runtimeHarness();
    h.clock.set(5_000);
    const started = await start(h, QUEEN_VS_KING_BLACK_TO_MOVE);
    if (!started.ok) throw new Error("game not started");
    expect(started.value.activation.kind).toBe("watching");
    const wake = h.scheduler.single();
    expect(wake.delayMs).toBe(1_001);
    h.clock.set(6_001);
    h.scheduler.fire(wake);
    await vi.waitFor(() => expect(h.facts.count("deadline_flagged")).toBe(1));
    expect((await storedState(h)).status).toEqual({
      kind: "finished",
      result: { resultCode: "white_win", terminationReason: "time", winner: "white" },
    });
  });

  it("TST-RT-ACT-003 activation is idempotent: one writer, one deadline timer, however often and however concurrently", async () => {
    const h = runtimeHarness();
    const started = await start(h);
    expect(started.ok).toBe(true);
    const outcomes = await Promise.all([
      h.registry.activate(GAME_ID),
      h.registry.activate(GAME_ID),
      h.registry.activate(GAME_ID),
    ]);
    outcomes.push(await h.registry.activate(GAME_ID));
    expect(outcomes.map((outcome) => outcome.kind)).toEqual([
      "watching",
      "watching",
      "watching",
      "watching",
    ]);
    expect(h.registry.size).toBe(1);
    expect(h.facts.count("writer_created")).toBe(1);
    expect(h.scheduler.wakes).toHaveLength(1);
    expect(deadlineWakes(h)).toHaveLength(1);
  });

  it("TST-RT-ACT-004 a finished game activates with no timer", async () => {
    const h = runtimeHarness();
    await store(h, checkmate().state);
    const activation = await h.registry.activate(GAME_ID);
    expect(activation.kind).toBe("stopped");
    expect(activation.kind === "stopped" && activation.view.condition).toBe("finished");
    expect(deadlineWakes(h)).toEqual([]);
    expect(h.registry.peek(GAME_ID)?.deadlineArmed).toBe(false);
  });

  it("TST-RT-ACT-005 a paused game activates with no competitive timer: clock domain changed, persistence unavailable, or an outage during activation", async () => {
    const domainPaused = runtimeHarness();
    await store(domainPaused, newGame(), DOMAIN_OLD);
    expect(await domainPaused.registry.activate(GAME_ID)).toEqual({
      kind: "recovery_required",
      reason: "RECOVERY_PAUSED_CLOCK_DOMAIN_CHANGED",
    });
    expect(deadlineWakes(domainPaused)).toEqual([]);

    const persistencePaused = runtimeHarness();
    const s0 = newGame();
    await store(persistencePaused, s0);
    persistencePaused.repository.commitFault = "fail";
    await submitAs(writerOf(persistencePaused), s0, "white", moveCommand(s0, "e2e4")).outcome;
    persistencePaused.repository.commitFault = "none";
    expect(await persistencePaused.registry.activate(GAME_ID)).toEqual({
      kind: "recovery_required",
      reason: "PERSISTENCE_UNAVAILABLE",
    });
    expect(deadlineWakes(persistencePaused)).toEqual([]);

    const outage = runtimeHarness();
    await store(outage, newGame());
    outage.repository.loadFault = true;
    expect((await outage.registry.activate(GAME_ID)).kind).toBe("recovery_required");
    expect(outage.registry.infrastructurePause(GAME_ID)).toBe("PERSISTENCE_UNAVAILABLE");
    outage.repository.loadFault = false;
    expect(await outage.registry.activate(GAME_ID)).toEqual({
      kind: "recovery_required",
      reason: "PERSISTENCE_UNAVAILABLE",
    });
    expect(deadlineWakes(outage)).toEqual([]);
  });

  it("TST-RT-ACT-006 startGame holds the writer before storing: with no writer available nothing is created", async () => {
    const h = runtimeHarness({ maxWriters: 1 });
    expect(h.registry.acquire(OTHER_GAME_ID)).not.toBeNull();
    expect(await start(h)).toEqual({
      ok: false,
      error: { kind: "writer_refused", reason: "writer_capacity" },
    });
    expect(h.repository.creates).toBe(0);
    expect((await h.contract.loadGame(GAME_ID)).ok).toBe(false);
    expect(await h.registry.activate(GAME_ID)).toEqual({
      kind: "unavailable",
      reason: "writer_capacity",
    });
  });

  it("TST-RT-ACT-007 an invalid new game releases its writer reservation; a duplicate game id keeps the stored game watched by one writer", async () => {
    const invalid = runtimeHarness();
    expect(
      await invalid.registry.startGame({
        gameId: GAME_ID,
        players: { white: PLAYERS.white, black: PLAYERS.white },
        controlLeases: LEASES,
        timeControl: SHORT,
      }),
    ).toEqual({ ok: false, error: "same_player_on_both_seats" });
    expect(invalid.registry.size).toBe(0);
    expect(invalid.scheduler.pending()).toEqual([]);
    expect(invalid.repository.creates).toBe(0);

    const duplicate = runtimeHarness();
    expect((await start(duplicate)).ok).toBe(true);
    expect(await start(duplicate)).toEqual({
      ok: false,
      error: { kind: "game_already_exists" },
    });
    expect(duplicate.registry.size).toBe(1);
    expect(duplicate.facts.count("writer_created")).toBe(1);
    expect(deadlineWakes(duplicate)).toHaveLength(1);
  });

  it("TST-RT-ACT-008 a disposed registry activates nothing", async () => {
    const h = runtimeHarness();
    await store(h, newGame());
    await h.registry.dispose();
    expect(await h.registry.activate(GAME_ID)).toEqual({
      kind: "unavailable",
      reason: "writer_stopped",
    });
    expect(await start(h)).toEqual({
      ok: false,
      error: { kind: "writer_refused", reason: "writer_stopped" },
    });
    expect(h.repository.creates).toBe(0);
    expect(h.scheduler.pending()).toEqual([]);
  });
});
