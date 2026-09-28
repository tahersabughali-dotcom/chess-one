import {
  createPosition,
  formatFen,
  generateLegalMoves,
  type Position,
  type PositionFields,
  repetitionKey,
  samePositionForRepetition,
} from "@chess-one/chess-rules";
import { oppositeColor } from "@chess-one/game-values";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { goldenFen } from "./fixtures/golden-positions.ts";
import { playoutArbitrary, playoutPositions } from "./support/playouts.ts";
import { positionOf } from "./support/positions.ts";

const STARTS = [
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
  "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
  goldenFen("TST-RULE-E01-009"),
  goldenFen("TST-RULE-E01-010"),
  "4k3/8/3b4/4P3/8/8/8/4K3 w - d6 0 1",
  "4k3/8/8/8/4p3/3B4/8/4K3 b - d3 0 1",
];

const playout = playoutArbitrary(STARTS, 30);

function rebuilt(position: Position, changes: Partial<PositionFields>): Position {
  const next = createPosition({
    board: position.board,
    sideToMove: position.sideToMove,
    castling: position.castling,
    enPassantTarget: position.enPassantTarget,
    halfmoveClock: position.halfmoveClock,
    fullmoveNumber: position.fullmoveNumber,
    ...changes,
  });
  if (!next.ok) throw new Error(next.error.message);
  return next.value;
}

function legalMoveSet(position: Position): string {
  const moves = generateLegalMoves(position).map(
    (move) => `${move.from}${move.to}${move.promotion ?? ""}`,
  );
  return JSON.stringify(moves.sort());
}

/**
 * Test oracle, independent of the package's en passant helpers: the target is
 * effective exactly when clearing it changes the public legal move set.
 */
function targetIsEffective(position: Position): boolean {
  if (position.enPassantTarget === null) return false;
  const cleared = rebuilt(position, { enPassantTarget: null });
  return legalMoveSet(position) !== legalMoveSet(cleared);
}

function oracleIdentity(position: Position): string {
  return JSON.stringify([
    position.board,
    position.sideToMove,
    position.castling,
    targetIsEffective(position) ? position.enPassantTarget : null,
  ]);
}

describe("TST-FOUND-REPPROP repetition identity properties over bounded playouts", () => {
  it("TST-FOUND-REPPROP-001 clocks never change the identity; the side to move always does", () => {
    fc.assert(
      fc.property(playout, fc.nat(500), fc.nat(500), ({ start, choices }, halfmove, fullmove) => {
        for (const position of playoutPositions(start, choices)) {
          const key = repetitionKey(position);
          const clocks = rebuilt(position, {
            halfmoveClock: halfmove,
            fullmoveNumber: fullmove + 1,
          });
          expect(repetitionKey(clocks).equals(key)).toBe(true);
          const flipped = rebuilt(position, { sideToMove: oppositeColor(position.sideToMove) });
          expect(repetitionKey(flipped).equals(key)).toBe(false);
          expect(repetitionKey(positionOf(formatFen(position))).text).toBe(key.text);
        }
      }),
      { numRuns: 40 },
    );
  });

  it("TST-FOUND-REPPROP-002 an en passant target matters exactly when clearing it changes the legal moves", () => {
    fc.assert(
      fc.property(playout, ({ start, choices }) => {
        for (const position of playoutPositions(start, choices)) {
          if (position.enPassantTarget === null) continue;
          const cleared = rebuilt(position, { enPassantTarget: null });
          expect(samePositionForRepetition(position, cleared)).toBe(!targetIsEffective(position));
        }
      }),
      { numRuns: 60 },
    );
  });

  it("TST-FOUND-REPPROP-003 identity equality agrees with the oracle for every pair along a playout", () => {
    fc.assert(
      fc.property(playout, ({ start, choices }) => {
        const positions = playoutPositions(start, choices);
        const keys = positions.map((position) => repetitionKey(position).text);
        const oracle = positions.map(oracleIdentity);
        for (let i = 0; i < positions.length; i += 1) {
          for (let j = i; j < positions.length; j += 1) {
            expect(keys[i] === keys[j]).toBe(oracle[i] === oracle[j]);
          }
        }
      }),
      { numRuns: 40 },
    );
  });
});
