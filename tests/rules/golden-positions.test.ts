import { checkPositionConsistency, type Position, parseFen, pieceAt } from "@chess-one/chess-rules";
import { oppositeColor } from "@chess-one/game-values";
import { describe, expect, it } from "vitest";
import { GOLDEN_POSITIONS, goldenFen } from "./fixtures/golden-positions.ts";
import { checkersOf, isAttacked } from "./support/attack-oracle.ts";

function parsed(fen: string): Position {
  const result = parseFen(fen);
  if (!result.ok) throw new Error(`${fen}: ${result.error.message}`);
  return result.value;
}

describe("Golden ledger fixture integrity", () => {
  it.each(GOLDEN_POSITIONS)("$id FEN is structurally valid and consistent", ({ fen }) => {
    const position = parsed(fen);
    expect(checkPositionConsistency(position)).toEqual([]);
  });

  it.each(GOLDEN_POSITIONS)("$id side not to move is not in check", ({ fen }) => {
    const position = parsed(fen);
    expect(checkersOf(position, oppositeColor(position.sideToMove))).toEqual([]);
  });

  it.each(GOLDEN_POSITIONS)("$id side to move has at most two checkers", ({ fen }) => {
    const position = parsed(fen);
    expect(checkersOf(position, position.sideToMove).length).toBeLessThanOrEqual(2);
  });

  it("TST-RULE-E01-008a fixture: f1 attacked, e1 not attacked, kingside castling blocked only by f1", () => {
    const position = parsed(goldenFen("TST-RULE-E01-008a"));
    expect(pieceAt(position, "e1")).toEqual({ color: "white", kind: "king" });
    expect(pieceAt(position, "b8")).toEqual({ color: "black", kind: "king" });
    expect(position.castling).toEqual({
      whiteKingside: true,
      whiteQueenside: true,
      blackKingside: false,
      blackQueenside: false,
    });
    expect(isAttacked(position, "e1", "black")).toBe(false);
    expect(isAttacked(position, "f1", "black")).toBe(true);
    expect(isAttacked(position, "g1", "black")).toBe(false);
    expect(pieceAt(position, "f1")).toBeNull();
    expect(pieceAt(position, "g1")).toBeNull();
  });

  it("TST-RULE-E01-008b fixture: queenside path is empty and unattacked", () => {
    const position = parsed(goldenFen("TST-RULE-E01-008a"));
    for (const square of ["d1", "c1", "b1"] as const) expect(pieceAt(position, square)).toBeNull();
    for (const square of ["e1", "d1", "c1"] as const)
      expect(isAttacked(position, square, "black")).toBe(false);
    expect(pieceAt(position, "a1")).toEqual({ color: "white", kind: "rook" });
  });

  it("TST-RULE-E01-014d fixture: neither knight attacks the black king", () => {
    const position = parsed(goldenFen("TST-RULE-E01-014d"));
    expect(isAttacked(position, "e4", "white")).toBe(false);
  });

  it("TST-RULE-E01-005 fixture: the bishop blocks the rook before the double check", () => {
    const position = parsed(goldenFen("TST-RULE-E01-005"));
    expect(isAttacked(position, "e8", "white")).toBe(false);
  });

  it("TST-RULE-E01-012 and 013 fixtures: checkmate position is in check, stalemate position is not", () => {
    expect(checkersOf(parsed(goldenFen("TST-RULE-E01-012")), "black")).toEqual(["b7"]);
    expect(checkersOf(parsed(goldenFen("TST-RULE-E01-013")), "black")).toEqual([]);
  });
});
