import {
  abortIfStartDeadlinePassed,
  type ClockDomainId,
  gameCondition,
  isClockDomainId,
  isStartDeadlinePassed,
  type LiveGameCommand,
  lifecycleOf,
  type Seat,
  startAwaitingGame,
} from "@chess-one/live-game";
import { describe, expect, it } from "vitest";
import {
  awaitingGame,
  claimCommand,
  INITIAL_MS,
  moveCommand,
  ms,
  offerCommand,
  resignCommand,
  respondCommand,
  START_DEADLINE_MS,
  snapshot,
  submit,
  wallClockMs,
} from "./support/harness.ts";

const BEFORE = wallClockMs(START_DEADLINE_MS - 1);
const AT = wallClockMs(START_DEADLINE_MS);
const SEATS: readonly Seat[] = ["white", "black"];

/** One well-formed command of every family, for `seat`. */
function everyFamily(seat: Seat): readonly LiveGameCommand[] {
  const state = awaitingGame();
  return [
    moveCommand(state, seat === "white" ? "e2e4" : "e7e5", {
      controlLeaseId: state.controlLeases[seat],
    }),
    claimCommand(state, "threefold_current", undefined, {
      controlLeaseId: state.controlLeases[seat],
    }),
    resignCommand(state, seat),
    offerCommand(state, seat),
    respondCommand(state, seat, "accept"),
  ];
}

describe("TST-LIFE core start lifecycle (GAME-START-LIFECYCLE-001)", () => {
  it("TST-LIFE-001 a created game awaits its players: sequence 0, full balances, no clock running, no result", () => {
    const state = awaitingGame();
    expect(state.sequence).toBe(0);
    expect(state.status).toEqual({
      kind: "awaiting_players",
      startDeadlineAtWallMs: START_DEADLINE_MS,
    });
    expect(lifecycleOf(state.status)).toBe("awaiting_players");
    expect(state.clock).toMatchObject({
      running: false,
      activeSide: "white",
      remainingMs: { white: INITIAL_MS, black: INITIAL_MS },
    });
    expect(state.commandBindings).toEqual([]);
    expect(state.pendingDrawOffer).toBeNull();
    expect(JSON.stringify(state.status)).not.toMatch(/result|winner/);
  });

  it("TST-LIFE-002 the start deadline boundary: startable while now < deadline, aborted at and after it", () => {
    expect(isStartDeadlinePassed(AT, BEFORE)).toBe(false);
    expect(isStartDeadlinePassed(AT, AT)).toBe(true);
    expect(isStartDeadlinePassed(AT, wallClockMs(START_DEADLINE_MS + 1))).toBe(true);
    const state = awaitingGame();
    expect(abortIfStartDeadlinePassed(state, BEFORE)).toBeNull();
    expect(startAwaitingGame(state, ms(5_000), BEFORE).kind).toBe("started");
    for (const now of [AT, wallClockMs(START_DEADLINE_MS + 60_000)]) {
      expect(abortIfStartDeadlinePassed(state, now)?.status.kind).toBe("aborted_before_start");
      expect(startAwaitingGame(state, ms(5_000), now).kind).toBe("aborted");
    }
  });

  it("TST-LIFE-003 the start: sequence 0 to 1 exactly once, White's clock running from the start instant, balances untouched", () => {
    const state = awaitingGame();
    const decision = startAwaitingGame(state, ms(7_000), BEFORE);
    if (decision.kind !== "started") throw new Error("not started");
    const started = decision.nextState;
    expect(started.sequence).toBe(1);
    expect(started.status).toEqual({ kind: "active" });
    expect(lifecycleOf(started.status)).toBe("in_progress");
    expect(started.clock).toMatchObject({
      running: true,
      anchorMs: 7_000,
      activeSide: "white",
      remainingMs: { white: INITIAL_MS, black: INITIAL_MS },
    });
    expect(started.commandBindings).toEqual([]);
    expect(startAwaitingGame(started, ms(8_000), BEFORE)).toEqual({ kind: "not_awaiting" });
    expect(abortIfStartDeadlinePassed(started, AT)).toBeNull();
    const move = submit(started, moveCommand(started, "e2e4"), 7_500);
    expect(move.response).toMatchObject({ code: "Accepted", sequence: 2 });
    expect(move.nextState.clock.remainingMs.white).toBe(INITIAL_MS - 500);
  });

  it("TST-LIFE-004 the abort: sequence 0 to 1, no result, no winner, no timeout, balances unchanged, terminal", () => {
    const state = awaitingGame();
    const aborted = abortIfStartDeadlinePassed(state, AT);
    if (aborted === null) throw new Error("not aborted");
    expect(aborted.sequence).toBe(1);
    expect(aborted.status).toEqual({
      kind: "aborted_before_start",
      reason: "START_DEADLINE_PASSED",
      startDeadlineAtWallMs: START_DEADLINE_MS,
    });
    expect(lifecycleOf(aborted.status)).toBe("aborted_before_start");
    expect(aborted.clock).toEqual(state.clock);
    expect(JSON.stringify(aborted.status)).not.toMatch(/result|winner|time|resultCode/i);
    expect(startAwaitingGame(aborted, ms(1), BEFORE)).toEqual({ kind: "not_awaiting" });
    expect(abortIfStartDeadlinePassed(aborted, AT)).toBeNull();
  });

  it("TST-LIFE-005 every command family before the start is GameNotStarted: nothing bound, stamped, or changed", () => {
    for (const seat of SEATS) {
      const state = awaitingGame();
      for (const command of everyFamily(seat)) {
        const decision = submit(state, command, 9_000, seat);
        expect(decision.response.code, `${seat} ${command.command}`).toBe("GameNotStarted");
        expect(decision.response.sequence).toBe(0);
        expect(decision.nextState).toBe(state);
        expect(decision.events).toEqual([]);
        expect(snapshot(decision.nextState)).toEqual(snapshot(awaitingGame()));
      }
    }
  });

  it("TST-LIFE-006 every command family after an abort is GameAbortedBeforeStart and changes nothing", () => {
    const aborted = abortIfStartDeadlinePassed(awaitingGame(), AT);
    if (aborted === null) throw new Error("not aborted");
    for (const command of everyFamily("white")) {
      const decision = submit(aborted, { ...command, expectedGameSequence: 1 }, 9_000, "white");
      expect(decision.response.code, command.command).toBe("GameAbortedBeforeStart");
      expect(decision.nextState).toBe(aborted);
      expect(decision.events).toEqual([]);
    }
  });

  it("TST-LIFE-007 conditions: awaiting and aborted games are never running, whatever the clock domain", () => {
    const awaiting = awaitingGame();
    const aborted = abortIfStartDeadlinePassed(awaiting, AT);
    if (aborted === null) throw new Error("not aborted");
    const stored = domain("boot-a");
    for (const [state, kind] of [
      [awaiting, "awaiting_players"],
      [aborted, "aborted_before_start"],
    ] satisfies [typeof awaiting, string][]) {
      for (const current of [stored, domain("boot-b")]) {
        const condition = gameCondition({ state, clockDomainId: stored }, current);
        expect(condition.kind, `${kind} in ${current}`).toBe(kind);
      }
    }
  });
});

function domain(name: string): ClockDomainId {
  if (!isClockDomainId(name)) throw new Error(`invalid clock domain ${name}`);
  return name;
}
