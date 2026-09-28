import {
  applyLegalMove,
  createInitialPosition,
  formatFen,
  generateLegalMoves,
  isInCheck,
} from "@chess-one/chess-rules";
import { describe, expect, it } from "vitest";
import { goldenFen } from "./fixtures/golden-positions.ts";
import { attempt, errorOf, fenAfter, legalUci, positionOf, uci } from "./support/positions.ts";

const INITIAL = goldenFen("TST-RULE-E01-001");

describe("Golden ledger movement and legality rows", () => {
  it("TST-RULE-E01-001 e2e4 is accepted from the initial position", () => {
    expect(fenAfter(INITIAL, "e2e4")).toBe(
      "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
    );
  });

  it("TST-RULE-E01-002 e2e5 is illegal and the position is unchanged", () => {
    const position = positionOf(INITIAL);
    expect(attempt(position, "e2e5")).toEqual({ ok: false, error: "illegal_move" });
    expect(formatFen(position)).toBe(INITIAL);
  });

  it("TST-RULE-E01-003 e1d2 onto an own piece is illegal", () => {
    expect(errorOf(INITIAL, "e1d2")).toBe("illegal_move");
  });

  it("TST-RULE-E01-004 the pinned knight cannot move", () => {
    const fen = goldenFen("TST-RULE-E01-004");
    expect(errorOf(fen, "e7c6")).toBe("illegal_move");
    expect(legalUci(positionOf(fen)).filter((move) => move.startsWith("e7"))).toEqual([]);
  });

  it("TST-RULE-E01-005 e4c6 is accepted and gives double check by two attacks", () => {
    const after = fenAfter(goldenFen("TST-RULE-E01-005"), "e4c6");
    expect(after).toBe("4k3/8/2B5/8/8/8/8/4R1K1 b - - 1 1");
    expect(isInCheck(positionOf(after), "black")).toBe(true);
    expect(isInCheck(positionOf("4k3/8/2B5/8/8/8/8/6K1 b - - 1 1"), "black")).toBe(true);
    expect(isInCheck(positionOf("4k3/8/8/8/8/8/8/4R1K1 b - - 1 1"), "black")).toBe(true);
    const replies = legalUci(positionOf(after));
    expect(replies.length).toBeGreaterThan(0);
    expect(replies.every((move) => move.startsWith("e8"))).toBe(true);
  });

  it("TST-RULE-E01-006 kings may not become adjacent", () => {
    const fen = goldenFen("TST-RULE-E01-006");
    expect(errorOf(fen, "e4e5")).toBe("illegal_move");
    const kingMoves = legalUci(positionOf(fen));
    for (const move of ["e4d5", "e4e5", "e4f5"]) expect(kingMoves).not.toContain(move);
    expect(kingMoves).toContain("e4d4");
  });

  it("TST-RULE-E01-007 castling without the right is illegal", () => {
    const fen = goldenFen("TST-RULE-E01-007");
    expect(errorOf(fen, "e1g1")).toBe("illegal_move");
    expect(errorOf(fen, "e1c1")).toBe("illegal_move");
  });

  it("TST-RULE-E01-008a castling across the attacked f1 is illegal; the king is not in check", () => {
    const fen = goldenFen("TST-RULE-E01-008a");
    expect(isInCheck(positionOf(fen), "white")).toBe(false);
    expect(errorOf(fen, "e1g1")).toBe("illegal_move");
  });

  it("TST-RULE-E01-008b queenside castling is accepted; king and rook both move", () => {
    expect(fenAfter(goldenFen("TST-RULE-E01-008a"), "e1c1")).toBe(
      "1k3r2/8/8/8/8/8/8/2KR3R b - - 1 1",
    );
  });

  it("TST-RULE-E01-009 en passant is accepted and removes the pawn on d5", () => {
    expect(fenAfter(goldenFen("TST-RULE-E01-009"), "e5d6")).toBe("4k3/8/3P4/8/8/8/8/6K1 b - - 0 1");
  });

  it("TST-RULE-E01-010 en passant that exposes the king along the rank is illegal", () => {
    const fen = goldenFen("TST-RULE-E01-010");
    expect(errorOf(fen, "e5d6")).toBe("illegal_move");
    const moves = legalUci(positionOf(fen));
    expect(moves).not.toContain("e5d6");
    expect(moves).toContain("e5e6");
  });

  it("TST-RULE-E01-011a a7a8 without a promotion piece is promotion_required (no auto-queen)", () => {
    expect(errorOf(goldenFen("TST-RULE-E01-011a"), "a7a8")).toBe("promotion_required");
  });

  it("TST-RULE-E01-011b a7a8q promotes to a queen", () => {
    expect(fenAfter(goldenFen("TST-RULE-E01-011a"), "a7a8q")).toBe("Q7/8/8/8/8/8/8/k1K5 b - - 0 1");
  });

  it("TST-RULE-E01-011c a7a8n underpromotes to a knight", () => {
    expect(fenAfter(goldenFen("TST-RULE-E01-011a"), "a7a8n")).toBe("N7/8/8/8/8/8/8/k1K5 b - - 0 1");
  });

  it("TST-RULE-E01-011d e2e4 with a promotion piece is promotion_unexpected", () => {
    expect(errorOf(INITIAL, "e2e4q")).toBe("promotion_unexpected");
  });

  it("TST-RULE-E01-012 Black has no legal move and is in check", () => {
    const position = positionOf(goldenFen("TST-RULE-E01-012"));
    expect(generateLegalMoves(position)).toEqual([]);
    expect(isInCheck(position, "black")).toBe(true);
  });

  it("TST-RULE-E01-013 Black has no legal move and is not in check", () => {
    const position = positionOf(goldenFen("TST-RULE-E01-013"));
    expect(generateLegalMoves(position)).toEqual([]);
    expect(isInCheck(position, "black")).toBe(false);
  });
});

describe("TST-FOUND-LEGAL public move API", () => {
  it("TST-FOUND-LEGAL-001 error precedence", () => {
    const promotion = goldenFen("TST-RULE-E01-011a");
    expect(errorOf(promotion, "a7a8")).toBe("promotion_required");
    expect(errorOf(INITIAL, "e2e4q")).toBe("promotion_unexpected");
    expect(errorOf(INITIAL, "e2e5q")).toBe("illegal_move");
    expect(errorOf(INITIAL, "e7e5")).toBe("illegal_move");
    expect(errorOf(INITIAL, "e4e5")).toBe("illegal_move");
    expect(errorOf("1r2k3/P7/8/8/8/8/8/4K3 w - - 0 1", "a7b8")).toBe("promotion_required");
  });

  it("TST-FOUND-LEGAL-002 untyped or malformed intents are illegal, never a crash", () => {
    const position = positionOf(goldenFen("TST-RULE-E01-011a"));
    const cases = [
      '{"from":"z9","to":"a8"}',
      '{"from":"a7","to":"a9"}',
      '{"from":"a7","to":"a8","promotion":"k"}',
    ];
    for (const json of cases) {
      expect(applyLegalMove(position, JSON.parse(json)), json).toEqual({
        ok: false,
        error: "illegal_move",
      });
    }
  });

  it("TST-FOUND-LEGAL-003 the initial position has the twenty expected moves in stable order", () => {
    expect(legalUci(createInitialPosition())).toEqual([
      "b1a3",
      "b1c3",
      "g1f3",
      "g1h3",
      "a2a3",
      "a2a4",
      "b2b3",
      "b2b4",
      "c2c3",
      "c2c4",
      "d2d3",
      "d2d4",
      "e2e3",
      "e2e4",
      "f2f3",
      "f2f4",
      "g2g3",
      "g2g4",
      "h2h3",
      "h2h4",
    ]);
  });

  it("TST-FOUND-LEGAL-004 generated lists and moves are frozen and cannot alter engine state", () => {
    const position = createInitialPosition();
    const moves = generateLegalMoves(position);
    expect(Object.isFrozen(moves)).toBe(true);
    expect(moves.every((move) => Object.isFrozen(move))).toBe(true);
    const [first] = moves;
    if (first === undefined) throw new Error("no moves");
    expect(Reflect.set(first, "to", "e5")).toBe(false);
    expect(legalUci(position)).toEqual(moves.map(uci));
  });

  it("TST-FOUND-LEGAL-005 applying a move never mutates the input position", () => {
    const position = positionOf(goldenFen("TST-RULE-E01-009"));
    const before = formatFen(position);
    attempt(position, "e5d6");
    expect(formatFen(position)).toBe(before);
  });

  it("TST-FOUND-LEGAL-006 check must be answered: block, capture, or move the king", () => {
    const fen = "4k3/8/8/8/1b6/P7/2P5/1N2K2R w K - 0 1";
    expect(isInCheck(positionOf(fen), "white")).toBe(true);
    expect(legalUci(positionOf(fen))).toEqual([
      "b1d2",
      "b1c3",
      "e1d1",
      "e1f1",
      "e1e2",
      "e1f2",
      "c2c3",
      "a3b4",
    ]);
  });
});
