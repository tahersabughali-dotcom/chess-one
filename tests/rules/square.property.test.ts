import {
  FILES,
  fileIndex,
  isSquare,
  parseMoveIntent,
  parseSquare,
  RANKS,
  rankIndex,
  SQUARES,
  squareAt,
  squareIndex,
} from "@chess-one/game-values";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

const VALID_SQUARE = /^[a-h][1-8]$/;

const nearSquare = fc
  .tuple(
    fc.constantFrom(..."abcdefghiA H`".split("")),
    fc.constantFrom(..."0123456789 x".split("")),
    fc.constantFrom("", "", "", "1", " ", "\u0000"),
  )
  .map(([file, rank, tail]) => file + rank + tail);

const anyText = fc.oneof(fc.string({ unit: "binary", maxLength: 6 }), nearSquare);

describe("TST-FOUND-SQUARE square domain", () => {
  it("TST-FOUND-SQUARE-001 SQUARES lists exactly a1..h8 in index order", () => {
    expect(SQUARES).toHaveLength(64);
    expect(new Set(SQUARES).size).toBe(64);
    expect(SQUARES[0]).toBe("a1");
    expect(SQUARES[7]).toBe("h1");
    expect(SQUARES[56]).toBe("a8");
    expect(SQUARES[63]).toBe("h8");
    for (const [index, square] of SQUARES.entries()) expect(squareIndex(square)).toBe(index);
  });

  it("TST-FOUND-SQUARE-002 the parser accepts exactly the valid domain", () => {
    fc.assert(
      fc.property(anyText, (text) => {
        expect(isSquare(text)).toBe(VALID_SQUARE.test(text));
        expect(parseSquare(text)).toBe(VALID_SQUARE.test(text) ? text : undefined);
      }),
      { numRuns: 5000 },
    );
  });

  it("TST-FOUND-SQUARE-003 parse and format round trip for every valid coordinate", () => {
    fc.assert(
      fc.property(fc.constantFrom(...FILES), fc.constantFrom(...RANKS), (file, rank) => {
        const text = `${file}${rank}`;
        const square = parseSquare(text);
        expect(square).toBe(text);
        if (square === undefined) return;
        expect(squareAt(fileIndex(square), rankIndex(square))).toBe(square);
      }),
    );
  });

  it("TST-FOUND-SQUARE-004 squareAt never throws and is defined only on 0..7 integers", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.integer(), fc.double()),
        fc.oneof(fc.integer(), fc.double()),
        (f, r) => {
          const inside =
            Number.isInteger(f) && Number.isInteger(r) && f >= 0 && f <= 7 && r >= 0 && r <= 7;
          const square = squareAt(f, r);
          expect(square !== undefined).toBe(inside);
        },
      ),
    );
  });

  it("TST-FOUND-SQUARE-005 invalid move-intent strings fail cleanly without throwing", () => {
    fc.assert(
      fc.property(
        anyText,
        anyText,
        fc.option(anyText, { nil: undefined }),
        (from, to, promotion) => {
          const result = parseMoveIntent({ from, to, promotion });
          const valid =
            VALID_SQUARE.test(from) &&
            VALID_SQUARE.test(to) &&
            from !== to &&
            (promotion === undefined || ["q", "r", "b", "n"].includes(promotion));
          expect(result.ok).toBe(valid);
        },
      ),
      { numRuns: 5000 },
    );
  });
});
