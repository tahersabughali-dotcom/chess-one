import { processDeadline } from "@chess-one/live-game";
import { describe, expect, it } from "vitest";
import { positionOf } from "../rules/support/positions.ts";
import {
  claimCommand,
  INITIAL_MS,
  moveCommand,
  ms,
  newGame,
  playMoves,
  START_MS,
  snapshot,
  submit,
} from "./support/harness.ts";

const SHORT_MS = 1_000;
const DEADLINE = START_MS + SHORT_MS;

describe("TST-LIVE server clock and received_at", () => {
  it("TST-LIVE-060 elapsed time is received_at minus the anchor, charged only to the side to move", () => {
    const game = newGame();
    const one = submit(game, moveCommand(game, "e2e4"), START_MS + 1_234).nextState;
    const two = submit(one, moveCommand(one, "e7e5"), START_MS + 1_234 + 4_321).nextState;
    const three = submit(two, moveCommand(two, "g1f3"), START_MS + 1_234 + 4_321 + 7).nextState;
    expect(one.clock.remainingMs).toEqual({ white: INITIAL_MS - 1_234, black: INITIAL_MS });
    expect(two.clock.remainingMs).toEqual({ white: INITIAL_MS - 1_234, black: INITIAL_MS - 4_321 });
    expect(three.clock.remainingMs).toEqual({
      white: INITIAL_MS - 1_241,
      black: INITIAL_MS - 4_321,
    });
    expect(three.clock.anchorMs).toBe(START_MS + 5_562);
    expect(three.clock.activeSide).toBe("black");
  });

  it("TST-LIVE-061 scenario A: a move received before the deadline is timely however late it is processed", () => {
    const game = newGame({ initialMs: SHORT_MS });
    // The writer only reaches this command long after DEADLINE; the decision reads receipt time only.
    const decision = submit(game, moveCommand(game, "e2e4"), DEADLINE - 1);
    expect(decision.response.code).toBe("Accepted");
    expect(decision.nextState.clock.remainingMs.white).toBe(1);
    const later = processDeadline(decision.nextState, ms(DEADLINE + 60_000));
    expect(later.flagged).toBe(true);
    expect(later.nextState.status).toMatchObject({ flaggedSide: "black" });
  });

  it("TST-LIVE-062 scenario B: a move received exactly at the deadline is timely (LIVE_GAME_EVENT_ORDERING_V1 section 3)", () => {
    const game = newGame({ initialMs: SHORT_MS });
    const decision = submit(game, moveCommand(game, "e2e4"), DEADLINE);
    expect(decision.response.code).toBe("Accepted");
    expect(decision.nextState.clock.remainingMs.white).toBe(0);
    expect(processDeadline(game, ms(DEADLINE)).flagged).toBe(false);
    expect(processDeadline(game, ms(DEADLINE)).nextState).toBe(game);
  });

  it("TST-LIVE-063 TST-RULE-E01-016e scenario C: a move received after the deadline is not applied; the flag is committed, unresolved", () => {
    const game = newGame({ initialMs: SHORT_MS });
    const command = moveCommand(game, "e2e4");
    const decision = submit(game, command, DEADLINE + 1);
    const next = decision.nextState;
    expect(decision.response).toMatchObject({
      code: "MoveReceivedAfterDeadline",
      san: null,
      sequence: 1,
      receivedAtMonotonicMs: DEADLINE + 1,
    });
    expect(next.status).toEqual({
      kind: "unresolved",
      reason: "MATING_POSSIBILITY_UNRESOLVED",
      flaggedSide: "white",
    });
    expect(next.position).toBe(game.position);
    expect(next.history).toBe(game.history);
    expect(next.sequence).toBe(1);
    expect(next.clock).toMatchObject({
      remainingMs: { white: 0, black: SHORT_MS },
      running: false,
      anchorMs: DEADLINE + 1,
    });
    expect(next.commandBindings).toHaveLength(1);
    expect(next.commandBindings[0]?.response).toBe(decision.response);
    expect(decision.events).toEqual([]);

    const retry = submit(next, command, DEADLINE + 2, "white");
    expect(retry.response).toEqual({ ...decision.response, replayedResponse: true });
    expect(retry.nextState).toBe(next);
    const claim = submit(next, claimCommand(next, "threefold_current"), DEADLINE + 3);
    expect(claim.response.code).toBe("MatingPossibilityUnresolved");
    expect(claim.nextState).toBe(next);
  });

  it("TST-LIVE-064 scenario D: rejected commands consume no clock, so time is charged once, to the next committed transition", () => {
    const game = newGame();
    const illegal = submit(game, moveCommand(game, "e2e5"), START_MS + 400).nextState;
    const early = submit(
      illegal,
      moveCommand(illegal, "e7e5", { clientCommandId: "black-early" }),
      START_MS + 600,
      "black",
    ).nextState;
    expect(early.clock).toBe(game.clock);
    const withRejections = submit(early, moveCommand(early, "e2e4"), START_MS + 900).nextState;
    const direct = submit(game, moveCommand(game, "e2e4"), START_MS + 900).nextState;
    expect(withRejections.clock).toEqual(direct.clock);
    expect(withRejections.clock.remainingMs.white).toBe(INITIAL_MS - 900);
  });

  it("TST-LIVE-065 a late claim is not evaluated: no penalty, no draw, the flag is committed", () => {
    const game = newGame({ initialMs: SHORT_MS });
    const decision = submit(game, claimCommand(game, "threefold_intended", "e2e4"), DEADLINE + 50);
    expect(decision.response.code).toBe("MoveReceivedAfterDeadline");
    expect(decision.nextState.clock.remainingMs).toEqual({ white: 0, black: SHORT_MS });
    expect(decision.nextState.position).toBe(game.position);
  });

  it("TST-LIVE-066 an UNKNOWN opponent mating capability never becomes a win, loss, or draw on time (DEC-064)", () => {
    for (const fen of [
      // Black flags; White's queen can be taken by the only legal reply, so no line is proven.
      "k7/1Q6/8/8/8/8/8/7K b - - 0 1",
      // White flags; Black owns a pawn as well as its king, outside every proven class.
      "4k3/4p3/8/8/8/8/4P3/R3K3 w - - 0 1",
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    ]) {
      const game = newGame({ startPosition: positionOf(fen), initialMs: SHORT_MS });
      const flagged = processDeadline(game, ms(DEADLINE + 1));
      expect(flagged.flagged, fen).toBe(true);
      expect(flagged.nextState.status, fen).toEqual({
        kind: "unresolved",
        reason: "MATING_POSSIBILITY_UNRESOLVED",
        flaggedSide: game.position.sideToMove,
      });
      expect(flagged.events, fen).toEqual([]);
      expect(flagged.nextState.sequence).toBe(1);
    }
  });

  it("TST-LIVE-067 processDeadline leaves active games before the deadline, and stopped games, unchanged", () => {
    const game = newGame({ initialMs: SHORT_MS });
    expect(processDeadline(game, ms(START_MS)).nextState).toBe(game);
    expect(processDeadline(game, ms(DEADLINE - 1)).nextState).toBe(game);
    const flagged = processDeadline(game, ms(DEADLINE + 1)).nextState;
    const again = processDeadline(flagged, ms(DEADLINE + 10_000));
    expect(again).toEqual({ nextState: flagged, flagged: false, events: [] });
    const mated = playMoves(newGame(), ["f2f3", "e7e5", "g2g4", "d8h4"]).state;
    expect(mated.status.kind).toBe("finished");
    expect(processDeadline(mated, ms(START_MS + 10_000_000)).nextState).toBe(mated);
  });

  it("TST-LIVE-069 TST-RULE-E01-016c a mating move received before the deadline is checkmate; processing time is not deducted", () => {
    const quick = newGame({ initialMs: SHORT_MS });
    const { state, time } = playMoves(quick, ["f2f3", "e7e5", "g2g4"], START_MS, 1);
    const blackDeadline = state.clock.anchorMs + state.clock.remainingMs.black;
    expect(blackDeadline).toBe(time + SHORT_MS - 1);
    // Receipt is at the last timely instant; the writer finishing later has no input here.
    const mate = submit(state, moveCommand(state, "d8h4"), blackDeadline);
    expect(mate.response).toMatchObject({ code: "Accepted", san: "Qh4#" });
    expect(mate.nextState.status).toEqual({
      kind: "finished",
      result: { resultCode: "black_win", terminationReason: "checkmate", winner: "black" },
    });
    expect(mate.nextState.clock.remainingMs.black).toBe(0);
    expect(mate.events).toHaveLength(1);
  });

  it("TST-LIVE-070 TST-RULE-E01-016d mating squares received after the deadline are not checkmate; the flag is committed", () => {
    const quick = newGame({ initialMs: SHORT_MS });
    const { state } = playMoves(quick, ["f2f3", "e7e5", "g2g4"], START_MS, 1);
    const late = state.clock.anchorMs + state.clock.remainingMs.black + 1;
    const decision = submit(state, moveCommand(state, "d8h4"), late);
    expect(decision.response).toMatchObject({ code: "MoveReceivedAfterDeadline", san: null });
    expect(decision.nextState.position).toBe(state.position);
    expect(decision.nextState.status).toEqual({
      kind: "unresolved",
      reason: "MATING_POSSIBILITY_UNRESOLVED",
      flaggedSide: "black",
    });
    expect(decision.events).toEqual([]);
  });

  it("TST-LIVE-071 TST-RULE-E01-016b a game that ended as dead_position has a stopped clock and no later flag", () => {
    const game = newGame({ startPosition: positionOf("8/8/8/3k4/4R3/8/8/4K3 b - - 0 1") });
    const dead = submit(game, moveCommand(game, "d5e4"), START_MS + 10).nextState;
    expect(dead.status).toMatchObject({ kind: "finished" });
    expect(dead.clock).toMatchObject({ running: false, anchorMs: START_MS + 10 });
    const far = START_MS + 10 * INITIAL_MS;
    expect(processDeadline(dead, ms(far))).toEqual({ nextState: dead, flagged: false, events: [] });
    const late = submit(dead, moveCommand(dead, "e1d2"), far);
    expect(late.response).toMatchObject({ code: "GameAlreadyFinished" });
    expect(late.nextState).toBe(dead);
    expect(late.nextState.status).toBe(dead.status);
    expect(late.nextState.clock).toBe(dead.clock);
  });

  it("TST-LIVE-068 clock balances stay non-negative integers and the game is stopped after the flag", () => {
    const game = newGame({ initialMs: SHORT_MS });
    const before = snapshot(game);
    const flagged = submit(game, moveCommand(game, "e2e4"), DEADLINE + 999_999).nextState;
    for (const balance of Object.values(flagged.clock.remainingMs)) {
      expect(Number.isSafeInteger(balance) && balance >= 0).toBe(true);
    }
    expect(flagged.clock.running).toBe(false);
    expect(snapshot(game)).toEqual(before);
  });
});
