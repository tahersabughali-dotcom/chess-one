import {
  applyLegalMove,
  evaluateMoveExhaustion,
  generateLegalMoves,
  type Position,
  toCanonicalSan,
} from "@chess-one/chess-rules";
import { PROMOTION_PIECES, SQUARES } from "@chess-one/game-values";
import { describe, expect, it } from "vitest";
import { goldenFen } from "./fixtures/golden-positions.ts";
import { checkersOf } from "./support/attack-oracle.ts";
import { play, positionOf } from "./support/positions.ts";

const CHECKMATES: readonly (readonly [fen: string, winner: "white" | "black"])[] = [
  [goldenFen("TST-RULE-E01-012"), "white"],
  ["4R1k1/5ppp/8/8/8/8/8/6K1 b - - 1 1", "white"],
  ["rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3", "black"],
];

const STALEMATES: readonly string[] = [
  goldenFen("TST-RULE-E01-013"),
  "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1",
  "8/8/8/8/8/5k2/5p2/5K2 w - - 0 1",
];

/** Every from/to/promotion combination, independent of the move generator's enumeration. */
function acceptsAnyIntent(position: Position): boolean {
  for (const from of SQUARES) {
    for (const to of SQUARES) {
      for (const promotion of [undefined, ...PROMOTION_PIECES]) {
        const intent = promotion === undefined ? { from, to } : { from, to, promotion };
        if (applyLegalMove(position, intent).ok) return true;
        if (toCanonicalSan(position, intent).ok) return true;
      }
    }
  }
  return false;
}

describe("TST-FOUND-TERMINAL move-exhaustion rule facts", () => {
  it("TST-FOUND-TERMINAL-001 checkmate names the winner and loser and is frozen", () => {
    for (const [fen, winner] of CHECKMATES) {
      const loser = winner === "white" ? "black" : "white";
      const fact = evaluateMoveExhaustion(positionOf(fen));
      expect(fact, fen).toEqual({ kind: "checkmate", winner, loser });
      expect(Object.isFrozen(fact)).toBe(true);
    }
  });

  it("TST-FOUND-TERMINAL-002 stalemate carries no winner and is frozen", () => {
    for (const fen of STALEMATES) {
      const fact = evaluateMoveExhaustion(positionOf(fen));
      expect(fact, fen).toEqual({ kind: "stalemate" });
      expect(Object.isFrozen(fact)).toBe(true);
    }
  });

  it("TST-FOUND-TERMINAL-003 facts agree with brute force and the independent attack oracle", () => {
    for (const [fen] of CHECKMATES) {
      const position = positionOf(fen);
      expect(acceptsAnyIntent(position), fen).toBe(false);
      expect(checkersOf(position, position.sideToMove).length, fen).toBeGreaterThan(0);
    }
    for (const fen of STALEMATES) {
      const position = positionOf(fen);
      expect(acceptsAnyIntent(position), fen).toBe(false);
      expect(checkersOf(position, position.sideToMove), fen).toEqual([]);
    }
  });

  it("TST-FOUND-TERMINAL-004 any position with a legal move has no fact, even in check", () => {
    const cases = [
      goldenFen("TST-RULE-E01-001"),
      "6k1/5pp1/8/8/8/8/8/4R1K1 w - - 0 1",
      "4R1k1/5pp1/8/8/8/8/8/6K1 b - - 1 1",
      "4k3/8/8/8/1b6/P7/2P5/1N2K2R w K - 0 1",
    ];
    for (const fen of cases) {
      const position = positionOf(fen);
      expect(generateLegalMoves(position).length, fen).toBeGreaterThan(0);
      expect(evaluateMoveExhaustion(position), fen).toBeNull();
    }
  });

  it("TST-FOUND-TERMINAL-005 dead positions stay separate: bare kings are not move exhaustion", () => {
    expect(evaluateMoveExhaustion(positionOf("4k3/8/8/8/8/8/8/4K3 w - - 0 1"))).toBeNull();
  });

  it("TST-FOUND-TERMINAL-006 a played mating sequence ends in the checkmate fact", () => {
    const start = positionOf("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    const mated = play(start, "f2f3", "e7e5", "g2g4", "d8h4");
    expect(evaluateMoveExhaustion(mated)).toEqual({
      kind: "checkmate",
      winner: "black",
      loser: "white",
    });
  });
});
