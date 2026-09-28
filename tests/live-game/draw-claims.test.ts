import { formatFen } from "@chess-one/chess-rules";
import type { ActiveGameState, CommandDecision } from "@chess-one/live-game";
import { describe, expect, it } from "vitest";
import {
  FIFTY_MOVE_INCORRECT_INTENDED,
  FIFTY_MOVE_INTENDED,
  THREEFOLD_INTENDED,
} from "../rules/fixtures/claim-histories.ts";
import { play, positionOf } from "../rules/support/positions.ts";
import {
  claimCommand,
  INITIAL_MS,
  LEASES,
  newGame,
  PENALTY_MS,
  type Played,
  playMoves,
  START_MS,
  snapshot,
  submit,
} from "./support/harness.ts";

const KNIGHT_CYCLE = ["g1f3", "g8f6", "f3g1", "f6g8"];

function drawn(detail: string): unknown {
  return {
    kind: "finished",
    result: { resultCode: "draw", terminationReason: "draw_rule", drawRuleDetails: [detail] },
  };
}

function balances(state: ActiveGameState): Readonly<Record<"white" | "black", number>> {
  return state.clock.remainingMs;
}

/** A correct claim: drawn at receipt, nothing played, one transition, one event. */
function expectCorrectClaim(
  decision: CommandDecision,
  before: Played,
  receivedAt: number,
  detail: string,
): void {
  const { state } = before;
  const next = decision.nextState;
  const claimant = state.position.sideToMove;
  expect(decision.response).toMatchObject({ code: "Accepted", san: null, replayedResponse: false });
  expect(next.status).toEqual(drawn(detail));
  expect(next.sequence).toBe(state.sequence + 1);
  expect(next.position).toBe(state.position);
  expect(next.history).toBe(state.history);
  expect(next.clock.running).toBe(false);
  expect(next.clock.anchorMs).toBe(receivedAt);
  expect(next.clock.remainingMs[claimant]).toBe(
    state.clock.remainingMs[claimant] - (receivedAt - state.clock.anchorMs),
  );
  expect(decision.events).toHaveLength(1);
  expect({ kind: "finished", result: decision.events[0]?.result }).toEqual(drawn(detail));
  expect(decision.events[0]).toMatchObject({
    gameSequence: next.sequence,
    finalClock: next.clock,
    provenance: { command: "ClaimDrawCommand.v1", seat: claimant },
  });
}

function h50(): Played {
  return playMoves(newGame(), FIFTY_MOVE_INTENDED.plies);
}

describe("TST-LIVE ClaimDrawCommand.v1, correct claims", () => {
  it("TST-LIVE-040 TST-RULE-E01-018 a correct threefold_current claim draws as threefold_claim", () => {
    const played = playMoves(newGame(), [...KNIGHT_CYCLE, ...KNIGHT_CYCLE]);
    expect(played.state.status).toEqual({ kind: "active" });
    const t = played.time + 250;
    const decision = submit(played.state, claimCommand(played.state, "threefold_current"), t);
    expectCorrectClaim(decision, played, t, "threefold_claim");
    const replay = submit(
      decision.nextState,
      claimCommand(played.state, "threefold_current"),
      t + 99,
    );
    expect(replay.response).toEqual({ ...decision.response, replayedResponse: true });
    expect(replay.nextState).toBe(decision.nextState);
    expect(replay.events).toEqual([]);
  });

  it("TST-LIVE-041 TST-RULE-E01-018b a correct threefold_intended claim draws and the intended move is not applied", () => {
    const played = playMoves(newGame(), THREEFOLD_INTENDED.plies);
    const fen = formatFen(played.state.position);
    const t = played.time + 40;
    const command = claimCommand(
      played.state,
      THREEFOLD_INTENDED.claim,
      THREEFOLD_INTENDED.intended,
    );
    const decision = submit(played.state, command, t);
    expectCorrectClaim(decision, played, t, "threefold_claim");
    expect(formatFen(decision.nextState.position)).toBe(fen);
    expect(decision.nextState.position.sideToMove).toBe("black");
  });

  it("TST-LIVE-042 TST-RULE-E01-020 a correct fifty_move_current claim draws as fifty_move_claim; without it play continues", () => {
    const history = h50();
    const played = playMoves(history.state, ["g8f6"], history.time);
    expect(played.state.position.halfmoveClock).toBe(100);
    expect(played.state.status).toEqual({ kind: "active" });
    const t = played.time + 5;
    const decision = submit(played.state, claimCommand(played.state, "fifty_move_current"), t);
    expectCorrectClaim(decision, played, t, "fifty_move_claim");
  });

  it("TST-LIVE-043 TST-RULE-E01-020b a correct fifty_move_intended claim draws and g8f6 is not applied", () => {
    const played = h50();
    const t = played.time + 5;
    const command = claimCommand(
      played.state,
      FIFTY_MOVE_INTENDED.claim,
      FIFTY_MOVE_INTENDED.intended,
    );
    const decision = submit(played.state, command, t);
    expectCorrectClaim(decision, played, t, "fifty_move_claim");
    expect(decision.nextState.position.halfmoveClock).toBe(99);
  });
});

describe("TST-LIVE ClaimDrawCommand.v1, incorrect claims", () => {
  it("TST-LIVE-044 TST-RULE-E01-022a a false current claim adds 120000 ms to the opponent once and play continues", () => {
    const game = newGame();
    const t = START_MS + 700;
    const decision = submit(game, claimCommand(game, "threefold_current"), t);
    const next = decision.nextState;
    expect(decision.response).toMatchObject({ code: "IncorrectClaim", detail: null, san: null });
    expect(balances(next)).toEqual({ white: INITIAL_MS - 700, black: INITIAL_MS + PENALTY_MS });
    expect(next.clock).toMatchObject({ activeSide: "white", running: true, anchorMs: t });
    expect(next.status).toEqual({ kind: "active" });
    expect(next.sequence).toBe(1);
    expect(next.position).toBe(game.position);
    expect(next.history).toBe(game.history);
    expect(decision.events).toEqual([]);

    const fifty = submit(game, claimCommand(game, "fifty_move_current"), t);
    expect(fifty.response.code).toBe("IncorrectClaim");
    expect(balances(fifty.nextState)).toEqual(balances(next));
  });

  it("TST-LIVE-045 TST-RULE-E01-022b a false claim with a legal intended move adds the time, then applies e2e4 once", () => {
    const game = newGame();
    const t = START_MS + 300;
    const decision = submit(game, claimCommand(game, "threefold_intended", "e2e4"), t);
    const next = decision.nextState;
    expect(decision.response).toMatchObject({ code: "IncorrectClaim", san: "e4", sequence: 1 });
    expect(formatFen(next.position)).toBe(formatFen(play(game.position, "e2e4")));
    expect(next.history).toHaveLength(2);
    expect(next.sequence).toBe(1);
    expect(balances(next)).toEqual({ white: INITIAL_MS - 300, black: INITIAL_MS + PENALTY_MS });
    expect(next.clock).toMatchObject({ activeSide: "black", running: true, anchorMs: t });
    expect(decision.events).toEqual([]);
  });

  it("TST-LIVE-046 TST-RULE-E01-022c a false claim with an illegal intended move adds the time; e2e5 is not applied", () => {
    const game = newGame();
    const t = START_MS + 300;
    const decision = submit(game, claimCommand(game, "threefold_intended", "e2e5"), t);
    const next = decision.nextState;
    expect(decision.response).toMatchObject({
      code: "IllegalMove",
      detail: "illegal_move",
      san: null,
      sequence: 1,
    });
    expect(next.position).toBe(game.position);
    expect(next.history).toBe(game.history);
    expect(next.sequence).toBe(1);
    expect(balances(next)).toEqual({ white: INITIAL_MS - 300, black: INITIAL_MS + PENALTY_MS });
    expect(next.clock).toMatchObject({ activeSide: "white", running: true, anchorMs: t });
  });

  it("TST-LIVE-047 TST-RULE-E01-020c a false fifty_move_intended claim with a7a6 adds the time, then applies a7a6", () => {
    const played = h50();
    const { state } = played;
    const t = played.time + 20;
    const command = claimCommand(state, FIFTY_MOVE_INTENDED.claim, FIFTY_MOVE_INCORRECT_INTENDED);
    const decision = submit(state, command, t);
    const next = decision.nextState;
    expect(decision.response).toMatchObject({ code: "IncorrectClaim", san: "a6" });
    expect(formatFen(next.position)).toBe(formatFen(play(state.position, "a7a6")));
    expect(next.position.halfmoveClock).toBe(0);
    expect(next.history).toHaveLength(state.history.length + 1);
    expect(next.sequence).toBe(state.sequence + 1);
    expect(balances(next)).toEqual({
      white: state.clock.remainingMs.white + PENALTY_MS,
      black: state.clock.remainingMs.black - 20,
    });
    expect(next.clock).toMatchObject({ activeSide: "white", running: true, anchorMs: t });
  });

  it("TST-LIVE-048 replaying an incorrect claim never adds the penalty twice", () => {
    const game = newGame();
    for (const [kind, intended] of [
      ["threefold_current", undefined],
      ["threefold_intended", "e2e4"],
      ["threefold_intended", "e2e5"],
    ] as const) {
      const command = claimCommand(game, kind, intended);
      const first = submit(game, command, START_MS + 10);
      const replay = submit(first.nextState, command, START_MS + 20, "white");
      expect(replay.response).toEqual({ ...first.response, replayedResponse: true });
      expect(replay.nextState).toBe(first.nextState);
      expect(balances(replay.nextState).black).toBe(INITIAL_MS + PENALTY_MS);
    }
  });

  it("TST-LIVE-049 an intended move with a missing promotion is InvalidState with no penalty", () => {
    const game = newGame({ startPosition: positionOf("4k3/P7/8/8/8/8/8/4K3 w - - 0 1") });
    const decision = submit(game, claimCommand(game, "fifty_move_intended", "a7a8"), START_MS + 5);
    expect(decision.response).toMatchObject({ code: "InvalidState", detail: "promotion_required" });
    expect(decision.nextState.clock).toBe(game.clock);
    expect(decision.nextState.sequence).toBe(0);
    expect(decision.nextState.position).toBe(game.position);
    expect(decision.nextState.commandBindings).toHaveLength(1);
  });

  it("TST-LIVE-050 only the side to move may claim, and claim shapes are validated", () => {
    const game = newGame();
    const early = claimCommand(game, "threefold_current", undefined, {
      clientCommandId: "black-claim",
      controlLeaseId: LEASES.black,
    });
    const notYourTurn = submit(game, early, START_MS + 1, "black");
    expect(notYourTurn.response.code).toBe("NotYourTurn");
    expect(notYourTurn.nextState.clock).toBe(game.clock);
    for (const [command, detail] of [
      [claimCommand(game, "threefold_current", "e2e4"), "unexpected_intended_move"],
      [claimCommand(game, "threefold_intended"), "missing_intended_move"],
      [claimCommand(game, "insufficient_material"), "unknown_claim_kind"],
    ] as const) {
      const decision = submit(game, command, START_MS + 1);
      expect(decision.response, detail).toMatchObject({ code: "InvalidState", detail });
      expect(decision.nextState).toBe(game);
    }
    expect(snapshot(game)).toEqual(snapshot(newGame()));
  });
});
