import {
  checkPositionConsistency,
  createInitialPosition,
  findKing,
  isInCheck,
  isSquareAttacked,
  type Position,
} from "@chess-one/chess-rules";
import { type Color, SQUARES, type Square } from "@chess-one/game-values";
import { describe, expect, it } from "vitest";
import { GOLDEN_POSITIONS, goldenFen } from "./fixtures/golden-positions.ts";
import { isAttacked } from "./support/attack-oracle.ts";
import { positionOf } from "./support/positions.ts";

function attackedBy(position: Position, color: Color): Square[] {
  return SQUARES.filter((square) => isSquareAttacked(position, square, color));
}

function sorted(squares: readonly Square[]): Square[] {
  return [...squares].sort();
}

describe("TST-FOUND-ATTACK geometric attack relation (Articles 3.1-3.7)", () => {
  it("TST-FOUND-ATTACK-001 pawns attack diagonally forward, never straight ahead", () => {
    const white = positionOf("4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1");
    expect(isSquareAttacked(white, "d5", "white")).toBe(true);
    expect(isSquareAttacked(white, "f5", "white")).toBe(true);
    expect(isSquareAttacked(white, "e5", "white")).toBe(false);
    expect(isSquareAttacked(white, "d3", "white")).toBe(false);
    expect(isSquareAttacked(white, "c4", "black")).toBe(true);
    expect(isSquareAttacked(white, "e4", "black")).toBe(true);
    expect(isSquareAttacked(white, "d4", "black")).toBe(false);
    expect(isSquareAttacked(white, "c6", "black")).toBe(false);
  });

  it("TST-FOUND-ATTACK-002 knights attack their eight jumps where on the board", () => {
    const centre = positionOf("k7/8/8/8/3N4/8/8/7K w - - 0 1");
    const kingZone: Square[] = ["g1", "g2", "h2"];
    expect(sorted(attackedBy(centre, "white"))).toEqual(
      sorted(["b3", "b5", "c2", "c6", "e2", "e6", "f3", "f5", ...kingZone]),
    );
    const corner = positionOf("k7/8/8/8/8/8/8/N6K w - - 0 1");
    expect(sorted(attackedBy(corner, "white"))).toEqual(sorted(["b3", "c2", ...kingZone]));
  });

  it("TST-FOUND-ATTACK-003 bishops attack along diagonals and stop at the first piece", () => {
    const position = positionOf("k7/8/8/8/3B4/8/1p6/7K w - - 0 1");
    for (const square of ["c3", "b2", "e5", "h8", "c5", "a7", "e3", "f2"] as const) {
      expect(isSquareAttacked(position, square, "white"), square).toBe(true);
    }
    expect(isSquareAttacked(position, "a1", "white")).toBe(false);
    expect(isSquareAttacked(position, "d5", "white")).toBe(false);
  });

  it("TST-FOUND-ATTACK-004 rooks attack along ranks and files and stop at the first piece", () => {
    const position = positionOf("k7/8/8/3p4/8/8/8/3R3K w - - 0 1");
    for (const square of ["d2", "d5", "a1", "c1", "e1"] as const) {
      expect(isSquareAttacked(position, square, "white"), square).toBe(true);
    }
    expect(isSquareAttacked(position, "d6", "white")).toBe(false);
    expect(isSquareAttacked(position, "e2", "white")).toBe(false);
  });

  it("TST-FOUND-ATTACK-005 queens attack as bishop plus rook", () => {
    const position = positionOf("k7/8/8/8/3Q4/8/8/7K w - - 0 1");
    for (const square of ["d8", "d1", "a4", "h4", "a7", "g7", "a1", "g1"] as const) {
      expect(isSquareAttacked(position, square, "white"), square).toBe(true);
    }
    expect(isSquareAttacked(position, "e6", "white")).toBe(false);
  });

  it("TST-FOUND-ATTACK-006 kings attack adjacent squares; castling is not an attack", () => {
    const position = positionOf("4k3/8/8/8/8/8/8/4K3 w - - 0 1");
    expect(sorted(attackedBy(position, "white"))).toEqual(sorted(["d1", "d2", "e2", "f2", "f1"]));
    expect(isSquareAttacked(position, "g1", "white")).toBe(false);
    expect(isSquareAttacked(position, "c1", "white")).toBe(false);
  });

  it("TST-FOUND-ATTACK-007 a blocker stops a slider ray", () => {
    const position = positionOf("k7/8/8/8/8/8/8/Q1N4K w - - 0 1");
    expect(isSquareAttacked(position, "b1", "white")).toBe(true);
    expect(isSquareAttacked(position, "d1", "white")).toBe(false);
  });

  it("TST-FOUND-ATTACK-008 a pinned knight still attacks (Article 3.9.2, TST-RULE-E01-004)", () => {
    const position = positionOf(goldenFen("TST-RULE-E01-004"));
    for (const square of ["c6", "c8", "d5", "f5", "g6", "g8"] as const) {
      expect(isSquareAttacked(position, square, "black"), square).toBe(true);
    }
  });

  it("TST-FOUND-ATTACK-009 pinned bishops and rooks still attack and still give check", () => {
    const bishop = positionOf("4k3/8/2b5/8/B7/8/8/7K w - - 0 1");
    expect(isSquareAttacked(bishop, "e4", "black")).toBe(true);
    expect(isInCheck(bishop, "white")).toBe(true);
    expect(isInCheck(bishop, "black")).toBe(false);
    const rook = positionOf("4k3/4r3/8/8/8/8/8/K3Q3 w - - 0 1");
    expect(isSquareAttacked(rook, "a7", "black")).toBe(true);
    expect(isSquareAttacked(rook, "h7", "black")).toBe(true);
  });

  it("TST-FOUND-ATTACK-010 squares next to the opposing king are attacked, so kings cannot meet", () => {
    const position = positionOf(goldenFen("TST-RULE-E01-006"));
    for (const square of ["d5", "e5", "f5"] as const) {
      expect(isSquareAttacked(position, square, "black"), square).toBe(true);
    }
  });

  it("TST-FOUND-ATTACK-011 check detection and king location", () => {
    const initial = createInitialPosition();
    expect(findKing(initial, "white")).toBe("e1");
    expect(findKing(initial, "black")).toBe("e8");
    expect(isInCheck(initial, "white")).toBe(false);
    expect(isInCheck(initial, "black")).toBe(false);
    expect(isInCheck(positionOf(goldenFen("TST-RULE-E01-012")), "black")).toBe(true);
    expect(isInCheck(positionOf(goldenFen("TST-RULE-E01-013")), "black")).toBe(false);
  });

  it("TST-FOUND-ATTACK-012 production attacks agree with the independent test oracle", () => {
    for (const { fen } of GOLDEN_POSITIONS) {
      const position = positionOf(fen);
      for (const color of ["white", "black"] as const) {
        for (const square of SQUARES) {
          expect(isSquareAttacked(position, square, color), `${fen} ${square} ${color}`).toBe(
            isAttacked(position, square, color),
          );
        }
      }
    }
  });

  it("TST-FOUND-ATTACK-013 consistency flags only the side that just moved being in check", () => {
    expect(checkPositionConsistency(positionOf("4k3/8/8/8/8/8/8/4R1K1 w - - 0 1"))).toContain(
      "non_moving_side_in_check",
    );
    expect(checkPositionConsistency(positionOf("4k3/8/8/8/8/8/8/4R1K1 b - - 0 1"))).toEqual([]);
  });
});
