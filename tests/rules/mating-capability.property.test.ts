import {
  applyLegalMove,
  assessMatingCapability,
  evaluateMoveExhaustion,
  findMatingWitness,
  formatFen,
  generateLegalMoves,
  type Position,
} from "@chess-one/chess-rules";
import { type Color, oppositeColor, type PieceKind } from "@chess-one/game-values";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  anyColor,
  materialPosition as build,
  distinctSquares,
} from "./support/material-positions.ts";

function endsInMate(start: Position, color: Color): boolean {
  const line = findMatingWitness(start, color);
  if (line === null) return false;
  let current = start;
  for (const move of line) {
    const next = applyLegalMove(current, move);
    if (!next.ok) return false;
    current = next.value;
  }
  const end = evaluateMoveExhaustion(current);
  return end?.kind === "checkmate" && end.winner === color;
}

/** The lone king must capture: every legal reply takes the mating side's piece. */
function forcedCapture(position: Position, mating: Color): boolean {
  if (position.sideToMove === mating) return false;
  const pieces = position.board.filter((cell) => cell?.color === mating).length;
  const replies = generateLegalMoves(position);
  return (
    replies.length > 0 &&
    replies.every((move) => {
      const next = applyLegalMove(position, move);
      return next.ok && next.value.board.filter((cell) => cell?.color === mating).length < pieces;
    })
  );
}

const color = anyColor;
const squares = distinctSquares;
const opponentKind = fc.constantFrom<PieceKind>("queen", "rook", "bishop", "knight");

describe("TST-RULE-CAP properties", () => {
  it("TST-RULE-CAP-020 a side that owns only its king is never PROVEN_CAN_MATE", () => {
    fc.assert(
      fc.property(
        squares(6),
        color,
        color,
        fc.array(opponentKind, { maxLength: 4 }),
        (placed, mating, toMove, others) => {
          const start = build(placed, mating, [], others, toMove);
          if (start === null) return;
          expect(assessMatingCapability(start, mating)).toBe("PROVEN_CANNOT_MATE");
        },
      ),
      { numRuns: 200, seed: 20260928 },
    );
  });

  it("TST-RULE-CAP-021 king and queen or rook against a lone king: every PROVEN_CAN_MATE has a line that replays to mate, and a line is found unless the position is terminal or the lone king must capture", () => {
    fc.assert(
      fc.property(
        squares(3),
        color,
        color,
        fc.constantFrom<PieceKind>("queen", "rook"),
        (placed, mating, toMove, major) => {
          const start = build(placed, mating, [major], [], toMove);
          if (start === null) return;
          const answer = assessMatingCapability(start, mating);
          expect(answer).not.toBe("PROVEN_CANNOT_MATE");
          const end = evaluateMoveExhaustion(start);
          const matedAlready = end?.kind === "checkmate" && end.winner === mating;
          const excused = (end !== null && !matedAlready) || forcedCapture(start, mating);
          expect(answer, formatFen(start)).toBe(excused ? "UNKNOWN" : "PROVEN_CAN_MATE");
          if (answer === "PROVEN_CAN_MATE") expect(endsInMate(start, mating)).toBe(true);
        },
      ),
      { numRuns: 150, seed: 20260928 },
    );
  }, 60_000);

  it("TST-RULE-CAP-022 king and two knights against a lone king: never PROVEN_CANNOT_MATE, and on this fixed sample every non-terminal position has a line that replays to mate", () => {
    fc.assert(
      fc.property(squares(4), color, color, (placed, mating, toMove) => {
        const start = build(placed, mating, ["knight", "knight"], [], toMove);
        if (start === null) return;
        expect(assessMatingCapability(start, mating)).not.toBe("PROVEN_CANNOT_MATE");
        if (evaluateMoveExhaustion(start) === null) {
          expect(endsInMate(start, mating), formatFen(start)).toBe(true);
        }
      }),
      { numRuns: 15, seed: 20260928 },
    );
  }, 60_000);

  it("TST-RULE-CAP-023 swapping the asked colour changes the answer, and evaluation never modifies the position", () => {
    fc.assert(
      fc.property(
        squares(3),
        color,
        color,
        fc.constantFrom<PieceKind>("queen", "rook"),
        (placed, mating, toMove, major) => {
          const start = build(placed, mating, [major], [], toMove);
          if (start === null) return;
          const fen = formatFen(start);
          const board = [...start.board];
          const strong = assessMatingCapability(start, mating);
          const lone = assessMatingCapability(start, oppositeColor(mating));
          expect(lone).toBe("PROVEN_CANNOT_MATE");
          expect(strong).not.toBe(lone);
          expect(formatFen(start)).toBe(fen);
          expect(start.board).toEqual(board);
        },
      ),
      { numRuns: 60, seed: 20260928 },
    );
  }, 60_000);
});
