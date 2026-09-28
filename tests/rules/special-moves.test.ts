import { isInCheck } from "@chess-one/chess-rules";
import { describe, expect, it } from "vitest";
import { attempt, errorOf, fenAfter, legalUci, positionOf } from "./support/positions.ts";

describe("TST-FOUND-CASTLE castling legality (Article 3.8.2)", () => {
  const BOTH = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";

  it("TST-FOUND-CASTLE-001 all four castlings move king and rook", () => {
    expect(fenAfter(BOTH, "e1g1")).toBe("r3k2r/8/8/8/8/8/8/R4RK1 b kq - 1 1");
    expect(fenAfter(BOTH, "e1c1")).toBe("r3k2r/8/8/8/8/8/8/2KR3R b kq - 1 1");
    const black = BOTH.replace(" w ", " b ");
    expect(fenAfter(black, "e8g8")).toBe("r4rk1/8/8/8/8/8/8/R3K2R w KQ - 1 2");
    expect(fenAfter(black, "e8c8")).toBe("2kr3r/8/8/8/8/8/8/R3K2R w KQ - 1 2");
  });

  it("TST-FOUND-CASTLE-002 castling out of check is illegal", () => {
    const fen = "4r1k1/8/8/8/8/8/8/R3K2R w KQ - 0 1";
    expect(isInCheck(positionOf(fen), "white")).toBe(true);
    expect(errorOf(fen, "e1g1")).toBe("illegal_move");
    expect(errorOf(fen, "e1c1")).toBe("illegal_move");
  });

  it("TST-FOUND-CASTLE-003 castling through or into an attacked square is illegal", () => {
    expect(errorOf("3rk3/8/8/8/8/8/8/R3K2R w KQ - 0 1", "e1c1")).toBe("illegal_move");
    expect(errorOf("3rk3/8/8/8/8/8/8/R3K2R w KQ - 0 1", "e1g1")).toBe("accepted");
    expect(errorOf("k5r1/8/8/8/8/8/8/R3K2R w KQ - 0 1", "e1g1")).toBe("illegal_move");
    expect(errorOf("k5r1/8/8/8/8/8/8/R3K2R w KQ - 0 1", "e1c1")).toBe("accepted");
    expect(errorOf("k1r5/8/8/8/8/8/8/R3K2R w KQ - 0 1", "e1c1")).toBe("illegal_move");
  });

  it("TST-FOUND-CASTLE-004 an attacked b1 or attacked rook square does not prevent castling", () => {
    expect(errorOf("1r2k3/8/8/8/8/8/8/R3K2R w KQ - 0 1", "e1c1")).toBe("accepted");
    expect(errorOf("r3k3/8/8/8/8/8/8/R3K2R w KQ - 0 1", "e1c1")).toBe("accepted");
    expect(errorOf("4k2r/8/8/8/8/8/8/R3K2R w KQ - 0 1", "e1g1")).toBe("accepted");
  });

  it("TST-FOUND-CASTLE-005 castling needs an empty path, the rook, and the king on its square", () => {
    expect(errorOf("4k3/8/8/8/8/8/8/RN2K2R w KQ - 0 1", "e1c1")).toBe("illegal_move");
    expect(errorOf("4k3/8/8/8/8/8/8/R3KN1R w KQ - 0 1", "e1g1")).toBe("illegal_move");
    expect(errorOf("4k3/8/8/8/8/8/8/4K2R w KQ - 0 1", "e1c1")).toBe("illegal_move");
    expect(errorOf("4k3/8/8/8/8/8/8/n3K2R w KQ - 0 1", "e1c1")).toBe("illegal_move");
    expect(errorOf("4k3/8/8/8/8/8/8/R4K1R w KQ - 0 1", "f1d1")).toBe("illegal_move");
  });
});

describe("TST-FOUND-EP en passant (Article 3.7.3.1)", () => {
  it("TST-FOUND-EP-001 Black captures en passant and the pawn on d4 disappears", () => {
    expect(fenAfter("4k3/8/8/8/3Pp3/8/8/4K3 b - d3 0 1", "e4d3")).toBe(
      "4k3/8/8/8/8/3p4/8/4K3 w - - 0 2",
    );
  });

  it("TST-FOUND-EP-002 en passant exists only with the target square set", () => {
    expect(errorOf("4k3/8/8/3pP3/8/8/8/6K1 w - - 0 1", "e5d6")).toBe("illegal_move");
    expect(errorOf("4k3/8/8/3pP3/8/8/8/6K1 w - f6 0 1", "e5f6")).toBe("illegal_move");
  });

  it("TST-FOUND-EP-003 the right expires after one move", () => {
    const start = positionOf("4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1");
    const pushed = attempt(start, "d7d5");
    if (!pushed.ok) throw new Error(pushed.error);
    expect(pushed.value.enPassantTarget).toBe("d6");
    expect(legalUci(pushed.value)).toContain("e5d6");
    const waited = attempt(pushed.value, "e1e2");
    if (!waited.ok) throw new Error(waited.error);
    expect(waited.value.enPassantTarget).toBeNull();
  });
});

describe("TST-FOUND-PROMO promotion (Article 3.7.3.3)", () => {
  it("TST-FOUND-PROMO-001 every promotion generates q, r, b, n and nothing else", () => {
    const moves = legalUci(positionOf("1r2k3/P7/8/8/8/8/8/4K3 w - - 0 1"));
    expect(moves.filter((move) => move.startsWith("a7"))).toEqual([
      "a7a8q",
      "a7a8r",
      "a7a8b",
      "a7a8n",
      "a7b8q",
      "a7b8r",
      "a7b8b",
      "a7b8n",
    ]);
  });

  it("TST-FOUND-PROMO-002 capture promotion replaces the pawn and resets the halfmove clock", () => {
    expect(fenAfter("1r2k3/P7/8/8/8/8/8/4K3 w - - 3 40", "a7b8r")).toBe(
      "1R2k3/8/8/8/8/8/8/4K3 b - - 0 40",
    );
  });

  it("TST-FOUND-PROMO-003 Black promotes on the first rank to each piece", () => {
    const fen = "4k3/8/8/8/8/8/p7/4K3 b - - 0 1";
    expect(fenAfter(fen, "a2a1q")).toBe("4k3/8/8/8/8/8/8/q3K3 w - - 0 2");
    expect(fenAfter(fen, "a2a1r")).toBe("4k3/8/8/8/8/8/8/r3K3 w - - 0 2");
    expect(fenAfter(fen, "a2a1b")).toBe("4k3/8/8/8/8/8/8/b3K3 w - - 0 2");
    expect(fenAfter(fen, "a2a1n")).toBe("4k3/8/8/8/8/8/8/n3K3 w - - 0 2");
  });
});
