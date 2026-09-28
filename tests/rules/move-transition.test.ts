import { createInitialPosition, formatFen, pieceAt } from "@chess-one/chess-rules";
import { describe, expect, it } from "vitest";
import { play, positionOf } from "./support/positions.ts";

const ROOKS = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";

function castlingAfter(fen: string, ...moves: string[]): string {
  return formatFen(play(positionOf(fen), ...moves)).split(" ")[2] ?? "";
}

describe("TST-FOUND-TRANSITION position state after a legal move", () => {
  it("TST-FOUND-TRANSITION-001 e2e4 updates board, side, en passant target, and clocks", () => {
    const next = play(createInitialPosition(), "e2e4");
    expect(pieceAt(next, "e2")).toBeNull();
    expect(pieceAt(next, "e4")).toEqual({ color: "white", kind: "pawn" });
    expect(next.sideToMove).toBe("black");
    expect(next.enPassantTarget).toBe("e3");
    expect(next.halfmoveClock).toBe(0);
    expect(next.fullmoveNumber).toBe(1);
  });

  it("TST-FOUND-TRANSITION-002 a Black move increments the fullmove number", () => {
    const next = play(createInitialPosition(), "e2e4", "e7e5");
    expect(next.fullmoveNumber).toBe(2);
    expect(next.enPassantTarget).toBe("e6");
    expect(play(next, "g1f3").enPassantTarget).toBeNull();
  });

  it("TST-FOUND-TRANSITION-003 halfmove: quiet piece move increments, capture and pawn move reset", () => {
    const fen = "4k3/8/8/3p4/8/4N3/8/4K3 w - - 7 20";
    expect(play(positionOf(fen), "e3g4").halfmoveClock).toBe(8);
    const capture = play(positionOf(fen), "e3d5");
    expect(capture.halfmoveClock).toBe(0);
    expect(capture.fullmoveNumber).toBe(20);
    expect(play(positionOf("4k3/8/8/8/8/8/4P3/4K3 w - - 7 20"), "e2e3").halfmoveClock).toBe(0);
    expect(play(positionOf("4k3/8/8/8/8/8/4P3/4K3 w - - 7 20"), "e2e4").halfmoveClock).toBe(0);
  });

  it("TST-FOUND-TRANSITION-004 castling moves both king and rook", () => {
    const next = play(positionOf(ROOKS), "e1g1");
    expect(pieceAt(next, "g1")).toEqual({ color: "white", kind: "king" });
    expect(pieceAt(next, "f1")).toEqual({ color: "white", kind: "rook" });
    expect(pieceAt(next, "e1")).toBeNull();
    expect(pieceAt(next, "h1")).toBeNull();
  });

  it("TST-FOUND-TRANSITION-005 a rook move clears only its own right", () => {
    expect(castlingAfter(ROOKS, "a1a2")).toBe("Kkq");
    expect(castlingAfter(ROOKS, "h1h2")).toBe("Qkq");
    expect(castlingAfter(ROOKS.replace(" w ", " b "), "a8a7")).toBe("KQk");
    expect(castlingAfter(ROOKS.replace(" w ", " b "), "h8h7")).toBe("KQq");
  });

  it("TST-FOUND-TRANSITION-006 a king move clears both rights of that colour", () => {
    expect(castlingAfter(ROOKS, "e1e2")).toBe("kq");
    expect(castlingAfter(ROOKS, "e1d1")).toBe("kq");
    expect(castlingAfter(ROOKS.replace(" w ", " b "), "e8f8")).toBe("KQ");
  });

  it("TST-FOUND-TRANSITION-007 capturing a rook on its original square clears that right", () => {
    expect(castlingAfter("r3k2r/8/8/8/8/8/1B6/R3K2R w KQkq - 0 1", "b2h8")).toBe("KQq");
    expect(castlingAfter(ROOKS, "a1a8")).toBe("Kk");
  });

  it("TST-FOUND-TRANSITION-008 rights never reappear when a rook returns", () => {
    expect(castlingAfter(ROOKS, "h1h2", "h8h7", "h2h1", "h7h8")).toBe("Qq");
  });

  it("TST-FOUND-TRANSITION-009 en passant removes the captured pawn from its own square", () => {
    const next = play(positionOf("4k3/8/8/3pP3/8/8/8/6K1 w - d6 0 1"), "e5d6");
    expect(pieceAt(next, "d5")).toBeNull();
    expect(pieceAt(next, "e5")).toBeNull();
    expect(pieceAt(next, "d6")).toEqual({ color: "white", kind: "pawn" });
    expect(next.enPassantTarget).toBeNull();
    expect(next.halfmoveClock).toBe(0);
  });

  it("TST-FOUND-TRANSITION-010 promotion replaces the pawn immediately with the chosen piece", () => {
    for (const [choice, kind] of [
      ["q", "queen"],
      ["r", "rook"],
      ["b", "bishop"],
      ["n", "knight"],
    ] as const) {
      const next = play(positionOf("8/P7/8/8/8/8/8/k1K5 w - - 0 1"), `a7a8${choice}`);
      expect(pieceAt(next, "a8")).toEqual({ color: "white", kind });
      expect(pieceAt(next, "a7")).toBeNull();
    }
  });
});
