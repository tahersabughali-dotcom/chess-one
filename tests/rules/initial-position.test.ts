import {
  checkPositionConsistency,
  createInitialPosition,
  FIDE_E01_2023,
  formatFen,
  pieceAt,
} from "@chess-one/chess-rules";
import { FILES, type PieceKind, parseSquare } from "@chess-one/game-values";
import { describe, expect, it } from "vitest";

const BACK_RANK: readonly PieceKind[] = [
  "rook",
  "knight",
  "bishop",
  "queen",
  "king",
  "bishop",
  "knight",
  "rook",
];

function square(text: string) {
  const parsed = parseSquare(text);
  if (parsed === undefined) throw new Error(text);
  return parsed;
}

describe("TST-FOUND-INITIAL initial position", () => {
  it("TST-FOUND-INITIAL-001 exact placement from the ruleset", () => {
    const position = createInitialPosition(FIDE_E01_2023);
    for (const [index, file] of FILES.entries()) {
      const kind = BACK_RANK[index];
      expect(pieceAt(position, square(`${file}1`))).toEqual({ color: "white", kind });
      expect(pieceAt(position, square(`${file}2`))).toEqual({ color: "white", kind: "pawn" });
      for (const rank of ["3", "4", "5", "6"])
        expect(pieceAt(position, square(`${file}${rank}`))).toBeNull();
      expect(pieceAt(position, square(`${file}7`))).toEqual({ color: "black", kind: "pawn" });
      expect(pieceAt(position, square(`${file}8`))).toEqual({ color: "black", kind });
    }
  });

  it("TST-FOUND-INITIAL-002 White to move with full rights and fresh counters", () => {
    const position = createInitialPosition();
    expect(position.sideToMove).toBe("white");
    expect(position.castling).toEqual({
      whiteKingside: true,
      whiteQueenside: true,
      blackKingside: true,
      blackQueenside: true,
    });
    expect(position.enPassantTarget).toBeNull();
    expect(position.halfmoveClock).toBe(0);
    expect(position.fullmoveNumber).toBe(1);
    expect(checkPositionConsistency(position)).toEqual([]);
    expect(formatFen(position)).toBe("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
  });
});
