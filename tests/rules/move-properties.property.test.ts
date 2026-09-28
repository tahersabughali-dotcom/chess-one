import {
  checkPositionConsistency,
  findKing,
  formatFen,
  generateLegalMoves,
  isCanonicalPosition,
  isInCheck,
  isSquareAttacked,
  parseFen,
  pieceAt,
} from "@chess-one/chess-rules";
import {
  type MoveIntent,
  oppositeColor,
  PROMOTION_PIECES,
  SQUARES,
  squareIndex,
} from "@chess-one/game-values";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isAttacked } from "./support/attack-oracle.ts";
import { playLegal } from "./support/perft.ts";
import { playoutArbitrary, playoutPositions as positionsOf } from "./support/playouts.ts";
import { uci } from "./support/positions.ts";

const STARTS = [
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
  "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
  "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1",
  "4k3/1P6/8/8/8/8/6p1/4K3 w - - 0 1",
];

const playout = playoutArbitrary(STARTS, 40);

/** Source index, then destination index, then promotion q, r, b, n. */
function orderKey(move: MoveIntent): number {
  const promotion = move.promotion === undefined ? 0 : PROMOTION_PIECES.indexOf(move.promotion) + 1;
  return squareIndex(move.from) * 1000 + squareIndex(move.to) * 10 + promotion;
}

const RUNS = { numRuns: 60 };

describe("TST-FOUND-MOVEPROP legal move properties over bounded playouts", () => {
  it("TST-FOUND-MOVEPROP-001 every generated move applies to a canonical position with the other side to move, one king each, and the mover not in check", () => {
    fc.assert(
      fc.property(playout, ({ start, choices }) => {
        for (const position of positionsOf(start, choices)) {
          const mover = position.sideToMove;
          for (const move of generateLegalMoves(position)) {
            const next = playLegal(position, move);
            expect(isCanonicalPosition(next)).toBe(true);
            expect(next.sideToMove).toBe(oppositeColor(mover));
            const kings = next.board.filter((cell) => cell?.kind === "king");
            expect(kings.map((king) => king?.color).sort()).toEqual(["black", "white"]);
            expect(isInCheck(next, mover)).toBe(false);
            expect(checkPositionConsistency(next)).not.toContain("non_moving_side_in_check");
          }
        }
      }),
      RUNS,
    );
  });

  it("TST-FOUND-MOVEPROP-002 moves are unique, never capture a king, and follow the documented order", () => {
    fc.assert(
      fc.property(playout, ({ start, choices }) => {
        for (const position of positionsOf(start, choices)) {
          const moves = generateLegalMoves(position).map(uci);
          expect(new Set(moves).size).toBe(moves.length);
          for (const move of generateLegalMoves(position)) {
            expect(pieceAt(position, move.to)?.kind).not.toBe("king");
          }
          const keys = generateLegalMoves(position).map(orderKey);
          expect(keys).toEqual([...keys].sort((a, b) => a - b));
        }
      }),
      RUNS,
    );
  });

  it("TST-FOUND-MOVEPROP-003 generation is deterministic and FEN round trips along the playout", () => {
    fc.assert(
      fc.property(playout, ({ start, choices }) => {
        for (const position of positionsOf(start, choices)) {
          const fen = formatFen(position);
          const reparsed = parseFen(fen);
          expect(reparsed.ok).toBe(true);
          if (!reparsed.ok) return;
          expect(formatFen(reparsed.value)).toBe(fen);
          const moves = generateLegalMoves(position).map(uci);
          expect(generateLegalMoves(position).map(uci)).toEqual(moves);
          expect(generateLegalMoves(reparsed.value).map(uci)).toEqual(moves);
        }
      }),
      RUNS,
    );
  });

  it("TST-FOUND-MOVEPROP-004 production attacks agree with the test oracle along playouts", () => {
    fc.assert(
      fc.property(playout, ({ start, choices }) => {
        for (const position of positionsOf(start, choices)) {
          for (const color of ["white", "black"] as const) {
            for (const square of SQUARES) {
              expect(isSquareAttacked(position, square, color)).toBe(
                isAttacked(position, square, color),
              );
            }
            expect(findKing(position, color)).toBeDefined();
          }
        }
      }),
      { numRuns: 30 },
    );
  });
});
