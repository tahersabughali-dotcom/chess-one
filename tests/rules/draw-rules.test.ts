import {
  assessMatingPossibility,
  createInitialPosition,
  type DrawClaim,
  type DrawClaimAssessment,
  evaluateAutomaticDraws,
  evaluateDrawClaim,
  evaluateMoveExhaustion,
  formatFen,
  generateLegalMoves,
  INCORRECT_CLAIM_BONUS_MS,
  pieceAt,
  repetitionCount,
  repetitionKey,
  samePositionForRepetition,
} from "@chess-one/chess-rules";
import { describe, expect, it } from "vitest";
import {
  FIFTY_MOVE_INCORRECT_INTENDED,
  FIFTY_MOVE_INTENDED,
  THREEFOLD_INTENDED,
} from "./fixtures/claim-histories.ts";
import { goldenFen } from "./fixtures/golden-positions.ts";
import { intentOf, play, positionOf, sanOf } from "./support/positions.ts";
import { prefix, quietWalk, type RuleHistory, ruleHistory } from "./support/rule-history.ts";

const INITIAL = createInitialPosition();
const CYCLE = ["g1f3", "g8f6", "f3g1", "f6g8"];
const H50 = FIFTY_MOVE_INTENDED.plies;

function claim(history: RuleHistory, drawClaim: DrawClaim): DrawClaimAssessment {
  const result = evaluateDrawClaim(history.keys, history.current, drawClaim);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function intended(kind: "threefold_intended" | "fifty_move_intended", uci: string): DrawClaim {
  return { kind, intended: intentOf(uci) };
}

function automatic(history: RuleHistory) {
  const result = evaluateAutomaticDraws(history.keys, history.current);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe("Golden ledger draw claim and automatic draw rows", () => {
  it("TST-RULE-E01-018 threefold_current is correct on the third appearance, which alone ends nothing", () => {
    const history = ruleHistory(INITIAL, [...CYCLE, ...CYCLE]);
    expect(samePositionForRepetition(history.current, INITIAL)).toBe(true);
    expect(history.current.sideToMove).toBe("white");
    expect(repetitionCount(history.keys, history.current)).toBe(3);
    const assessment = claim(history, { kind: "threefold_current" });
    expect(assessment).toMatchObject({ verdict: "correct", kind: "threefold_current" });
    expect(assessment.evidence).toEqual({ position: history.current, repetitionCount: 3 });
    expect(assessment.intendedMove).toBeNull();
    expect(automatic(history)).toEqual({ fivefold: false, seventyFiveMove: false });
    expect(evaluateMoveExhaustion(history.current)).toBeNull();
    expect(generateLegalMoves(history.current)).toHaveLength(20);
  });

  it("TST-RULE-E01-018b threefold_intended f6g8 is correct and the move is not applied", () => {
    const history = ruleHistory(INITIAL, THREEFOLD_INTENDED.plies);
    const fen = formatFen(history.current);
    expect(history.current.sideToMove).toBe("black");
    expect(repetitionCount(history.keys, INITIAL)).toBe(2);
    expect(claim(history, { kind: "threefold_current" }).verdict).toBe("incorrect");
    const assessment = claim(history, intended("threefold_intended", THREEFOLD_INTENDED.intended));
    expect(assessment.verdict).toBe("correct");
    expect(assessment.intendedMove).toEqual({
      disposition: "not_applied",
      move: { from: "f6", to: "g8" },
    });
    expect(assessment.evidence?.repetitionCount).toBe(3);
    const hypothetical = assessment.evidence?.position;
    if (hypothetical === undefined) throw new Error("missing evidence");
    expect(samePositionForRepetition(hypothetical, INITIAL)).toBe(true);
    expect(formatFen(history.current)).toBe(fen);
    expect(history.keys).toHaveLength(THREEFOLD_INTENDED.plies.length + 1);
    expect(repetitionCount(history.keys, INITIAL)).toBe(2);
  });

  it("TST-RULE-E01-019 fivefold is an automatic fact on the fifth appearance, without a claim", () => {
    const fourth = ruleHistory(INITIAL, [...CYCLE, ...CYCLE, ...CYCLE]);
    const fifth = ruleHistory(INITIAL, [...CYCLE, ...CYCLE, ...CYCLE, ...CYCLE]);
    expect(repetitionCount(fourth.keys, fourth.current)).toBe(4);
    expect(automatic(fourth).fivefold).toBe(false);
    expect(repetitionCount(fifth.keys, fifth.current)).toBe(5);
    expect(automatic(fifth)).toEqual({ fivefold: true, seventyFiveMove: false });
  });

  it("TST-RULE-E01-020 fifty_move_current after 100 verified quiet halfmoves; 100 is not automatic", () => {
    const history = ruleHistory(INITIAL, [...H50, "g8f6"]);
    expect(history.positions.map((position) => position.halfmoveClock)).toEqual(
      Array.from({ length: 101 }, (_, ply) => ply),
    );
    expect(assessMatingPossibility(history.current)).not.toBe("PROVEN_DEAD");
    expect(claim(history, { kind: "fifty_move_current" }).verdict).toBe("correct");
    expect(claim(prefix(history, 100), { kind: "fifty_move_current" }).verdict).toBe("incorrect");
    expect(automatic(history).seventyFiveMove).toBe(false);
    expect(generateLegalMoves(history.current).length).toBeGreaterThan(0);
  });

  it("TST-RULE-E01-020b fifty_move_intended g8f6 completes 100 halfmoves; the position is unchanged", () => {
    const history = ruleHistory(INITIAL, H50);
    const fen = formatFen(history.current);
    expect([history.current.halfmoveClock, history.current.sideToMove]).toEqual([99, "black"]);
    const assessment = claim(
      history,
      intended("fifty_move_intended", FIFTY_MOVE_INTENDED.intended),
    );
    expect(assessment.verdict).toBe("correct");
    expect(assessment.evidence?.position.halfmoveClock).toBe(100);
    expect(assessment.intendedMove?.disposition).toBe("not_applied");
    expect(formatFen(history.current)).toBe(fen);
  });

  it("TST-RULE-E01-020c fifty_move_intended a7a6 is incorrect: the pawn move resets the count and must be applied", () => {
    const history = ruleHistory(INITIAL, H50);
    const fen = formatFen(history.current);
    expect(pieceAt(history.current, "a7")).toEqual({ color: "black", kind: "pawn" });
    const assessment = claim(
      history,
      intended("fifty_move_intended", FIFTY_MOVE_INCORRECT_INTENDED),
    );
    expect(assessment).toMatchObject({ verdict: "incorrect", opponentBonusMs: 120000 });
    expect(assessment.evidence?.position.halfmoveClock).toBe(0);
    const consequence = assessment.intendedMove;
    if (consequence?.disposition !== "must_apply") throw new Error("expected must_apply");
    expect(formatFen(consequence.resultingPosition)).toBe(
      formatFen(play(history.current, FIFTY_MOVE_INCORRECT_INTENDED)),
    );
    expect(formatFen(history.current)).toBe(fen);
  });

  it("TST-RULE-E01-021a seventy-five-move is automatic at 150 quiet halfmoves when the move is not mate", () => {
    const history = quietWalk(INITIAL, 150);
    expect(history.positions.map((position) => position.halfmoveClock)).toEqual(
      Array.from({ length: 151 }, (_, ply) => ply),
    );
    expect(evaluateMoveExhaustion(history.current)).toBeNull();
    expect(automatic(history)).toEqual({ fivefold: false, seventyFiveMove: true });
    expect(automatic(prefix(history, 150)).seventyFiveMove).toBe(false);
  });

  it("TST-RULE-E01-021b mate on the 150th halfmove wins; the seventy-five-move fact is suppressed", () => {
    const fen = goldenFen("TST-RULE-E01-021b");
    const history = ruleHistory(positionOf(fen), ["b2b7"]);
    expect(history.current.halfmoveClock).toBe(150);
    expect(evaluateMoveExhaustion(history.current)).toEqual({
      kind: "checkmate",
      winner: "white",
      loser: "black",
    });
    expect(automatic(history)).toEqual({ fivefold: false, seventyFiveMove: false });
    expect(sanOf(fen, "b2b7")).toBe("Qb7#");
    const quiet = ruleHistory(positionOf(fen), ["b2b3"]);
    expect(quiet.current.halfmoveClock).toBe(150);
    expect(evaluateMoveExhaustion(quiet.current)).toBeNull();
    expect(automatic(quiet).seventyFiveMove).toBe(true);
  });

  it("TST-RULE-E01-022a a false threefold_current is incorrect with the 120000 ms rule fact", () => {
    const assessment = claim(ruleHistory(INITIAL, []), { kind: "threefold_current" });
    expect(assessment).toEqual({
      verdict: "incorrect",
      kind: "threefold_current",
      opponentBonusMs: INCORRECT_CLAIM_BONUS_MS,
      evidence: { position: INITIAL, repetitionCount: 1 },
      intendedMove: null,
    });
    expect(INCORRECT_CLAIM_BONUS_MS).toBe(120000);
  });

  it("TST-RULE-E01-022b a false threefold_intended e2e4 is incorrect and e2e4 must be applied", () => {
    const history = ruleHistory(INITIAL, []);
    const assessment = claim(history, intended("threefold_intended", "e2e4"));
    expect(assessment).toMatchObject({ verdict: "incorrect", opponentBonusMs: 120000 });
    expect(assessment.evidence?.repetitionCount).toBe(1);
    const consequence = assessment.intendedMove;
    if (consequence?.disposition !== "must_apply") throw new Error("expected must_apply");
    expect(consequence.move).toEqual({ from: "e2", to: "e4" });
    expect(formatFen(consequence.resultingPosition)).toBe(
      "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
    );
    expect(formatFen(history.current)).toBe(formatFen(createInitialPosition()));
  });

  it("TST-RULE-E01-022c a false claim with illegal e2e5 is incorrect and e2e5 is not applied", () => {
    const assessment = claim(ruleHistory(INITIAL, []), intended("threefold_intended", "e2e5"));
    expect(assessment).toEqual({
      verdict: "incorrect",
      kind: "threefold_intended",
      opponentBonusMs: 120000,
      evidence: null,
      intendedMove: { disposition: "illegal", error: "illegal_move" },
    });
  });
});

describe("TST-FOUND-DRAW pure draw rule facts", () => {
  it("TST-FOUND-DRAW-001 the history must end with the current position", () => {
    const history = ruleHistory(INITIAL, ["g1f3"]);
    for (const keys of [[], history.keys.slice(0, 1)]) {
      expect(evaluateDrawClaim(keys, history.current, { kind: "threefold_current" })).toEqual({
        ok: false,
        error: "history_not_current",
      });
      expect(evaluateAutomaticDraws(keys, history.current)).toEqual({
        ok: false,
        error: "history_not_current",
      });
    }
  });

  it("TST-FOUND-DRAW-002 thresholds: 3 and 100 only by claim, 5 and 150 automatic", () => {
    for (const [cycles, count] of [
      [2, 3],
      [3, 4],
    ] as const) {
      const history = ruleHistory(INITIAL, Array.from({ length: cycles }, () => CYCLE).flat());
      expect(repetitionCount(history.keys, history.current)).toBe(count);
      expect(automatic(history).fivefold).toBe(false);
    }
    for (const [clock, fifty, seventyFive] of [
      [99, "incorrect", false],
      [100, "correct", false],
      [149, "correct", false],
      [150, "correct", true],
    ] as const) {
      const position = positionOf(`4k3/8/8/8/8/8/8/R3K3 w - - ${clock} 90`);
      const history = { positions: [position], keys: [repetitionKey(position)], current: position };
      expect(claim(history, { kind: "fifty_move_current" }).verdict, `${clock}`).toBe(fifty);
      expect(automatic(history).seventyFiveMove, `${clock}`).toBe(seventyFive);
    }
  });

  it("TST-FOUND-DRAW-003 an intended claim preserves promotion errors and never applies the move", () => {
    const fen = goldenFen("TST-RULE-E01-011a");
    const assessment = claim(
      ruleHistory(positionOf(fen), []),
      intended("fifty_move_intended", "a7a8"),
    );
    expect(assessment.intendedMove).toEqual({
      disposition: "illegal",
      error: "promotion_required",
    });
    expect(assessment.verdict).toBe("incorrect");
  });

  it("TST-FOUND-DRAW-004 assessments are frozen and inputs are not mutated", () => {
    const history = ruleHistory(INITIAL, THREEFOLD_INTENDED.plies);
    const assessment = claim(history, intended("threefold_intended", "f6g8"));
    expect(Object.isFrozen(assessment)).toBe(true);
    expect(Object.isFrozen(assessment.evidence)).toBe(true);
    expect(Object.isFrozen(assessment.intendedMove)).toBe(true);
    expect(Object.isFrozen(automatic(history))).toBe(true);
    expect(Object.isFrozen(history.keys)).toBe(true);
  });
});
