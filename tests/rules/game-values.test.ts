import {
  COLORS,
  createPiece,
  isDurationMs,
  isGameSequence,
  isPromotionPiece,
  isWellFormedRulesetId,
  nextGameSequence,
  oppositeColor,
  PROMOTION_PIECES,
  parseDurationMs,
  parseGameSequence,
  parseMoveIntent,
  promotionPieceKind,
} from "@chess-one/game-values";
import { describe, expect, it } from "vitest";

describe("TST-FOUND-VALUES game values", () => {
  it("TST-FOUND-VALUES-001 colors and opposite", () => {
    expect(COLORS).toEqual(["white", "black"]);
    expect(oppositeColor("white")).toBe("black");
    expect(oppositeColor("black")).toBe("white");
  });

  it("TST-FOUND-VALUES-002 pieces are frozen values", () => {
    const piece = createPiece("white", "knight");
    expect(piece).toEqual({ color: "white", kind: "knight" });
    expect(Object.isFrozen(piece)).toBe(true);
  });

  it("TST-FOUND-VALUES-003 promotion accepts only q, r, b, n", () => {
    expect(PROMOTION_PIECES).toEqual(["q", "r", "b", "n"]);
    for (const text of ["q", "r", "b", "n"]) expect(isPromotionPiece(text)).toBe(true);
    for (const text of ["k", "p", "Q", "N", "", "qq", "queen"])
      expect(isPromotionPiece(text)).toBe(false);
    expect(promotionPieceKind("q")).toBe("queen");
    expect(promotionPieceKind("r")).toBe("rook");
    expect(promotionPieceKind("b")).toBe("bishop");
    expect(promotionPieceKind("n")).toBe("knight");
  });

  it("TST-FOUND-VALUES-004 move intent is structural and never auto-queens", () => {
    expect(parseMoveIntent({ from: "e2", to: "e4" })).toEqual({
      ok: true,
      value: { from: "e2", to: "e4" },
    });
    expect(parseMoveIntent({ from: "a7", to: "a8", promotion: "n" })).toEqual({
      ok: true,
      value: { from: "a7", to: "a8", promotion: "n" },
    });
    const noPromotion = parseMoveIntent({ from: "a7", to: "a8" });
    expect(noPromotion.ok && "promotion" in noPromotion.value).toBe(false);
    expect(parseMoveIntent({ from: "e9", to: "e4" })).toEqual({
      ok: false,
      error: "invalid_from_square",
    });
    expect(parseMoveIntent({ from: "e2", to: "E4" })).toEqual({
      ok: false,
      error: "invalid_to_square",
    });
    expect(parseMoveIntent({ from: "e2", to: "e2" })).toEqual({ ok: false, error: "same_square" });
    expect(parseMoveIntent({ from: "a7", to: "a8", promotion: "k" })).toEqual({
      ok: false,
      error: "invalid_promotion_piece",
    });
  });

  it("TST-FOUND-VALUES-005 game sequence is a non-negative safe integer", () => {
    expect(isGameSequence(0)).toBe(true);
    expect(isGameSequence(-1)).toBe(false);
    expect(isGameSequence(1.5)).toBe(false);
    expect(isGameSequence(Number.NaN)).toBe(false);
    expect(isGameSequence(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
    const zero = parseGameSequence(0);
    expect(zero).toBe(0);
    if (zero === undefined) return;
    expect(nextGameSequence(zero)).toEqual({ ok: true, value: 1 });
    const max = parseGameSequence(Number.MAX_SAFE_INTEGER);
    if (max === undefined) throw new Error("max safe integer must be a sequence");
    expect(nextGameSequence(max)).toEqual({ ok: false, error: "sequence_overflow" });
  });

  it("TST-FOUND-VALUES-006 durations are whole non-negative milliseconds", () => {
    expect(parseDurationMs(120000)).toBe(120000);
    expect(isDurationMs(0)).toBe(true);
    expect(isDurationMs(-1)).toBe(false);
    expect(isDurationMs(0.5)).toBe(false);
    expect(isDurationMs(Number.POSITIVE_INFINITY)).toBe(false);
    expect(parseDurationMs(Number.NaN)).toBeUndefined();
  });

  it("TST-FOUND-VALUES-007 ruleset id syntax", () => {
    expect(isWellFormedRulesetId("FIDE-E01-2023")).toBe(true);
    for (const text of ["", "fide-e01-2023", "FIDE", "FIDE--2023", "FIDE-E01-", " FIDE-E01-2023"]) {
      expect(isWellFormedRulesetId(text)).toBe(false);
    }
  });
});
