import {
  applyLegalMove,
  evaluateMoveExhaustion,
  formatFen,
  generateLegalMoves,
  type Position,
  pieceAt,
  toCanonicalSan,
} from "@chess-one/chess-rules";
import { fileIndex, type MoveIntent } from "@chess-one/game-values";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { goldenFen } from "./fixtures/golden-positions.ts";
import { checkersOf } from "./support/attack-oracle.ts";
import { playoutArbitrary, playoutPositions } from "./support/playouts.ts";
import { positionOf, uci } from "./support/positions.ts";

const SELECTED = [
  goldenFen("TST-RULE-E01-001"),
  "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
  "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1",
  "1n2k3/P6P/8/8/8/8/p6p/1N2K3 w - - 0 1",
  goldenFen("TST-RULE-E01-009"),
  "4k3/8/8/8/1b6/P7/2P5/1N2K2R w K - 0 1",
  "3k4/8/3K4/8/8/8/1Q6/7R w - - 0 1",
];

const SAN_SHAPE =
  /^(O-O|O-O-O|[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|(?:[a-h]x)?[a-h][1-8](?:=[QRBN])?)[+#]?$/;

function sanOf(position: Position, move: MoveIntent): string {
  const san = toCanonicalSan(position, move);
  if (!san.ok) throw new Error(`${uci(move)}: ${san.error}`);
  return san.value;
}

/** Test oracle: occupied destination, or a pawn leaving its file (only en passant lands empty). */
function isCapture(position: Position, move: MoveIntent): boolean {
  if (pieceAt(position, move.to) !== null) return true;
  return (
    pieceAt(position, move.from)?.kind === "pawn" && fileIndex(move.from) !== fileIndex(move.to)
  );
}

/** Suffix computed from the oracle's checkers and the public move list. */
function expectedSuffix(next: Position): string {
  if (checkersOf(next, next.sideToMove).length === 0) return "";
  return generateLegalMoves(next).length === 0 ? "#" : "+";
}

describe("TST-FOUND-SANPROP canonical SAN consistency", () => {
  it("TST-FOUND-SANPROP-001 every legal move in selected positions has consistent, unique SAN", () => {
    for (const fen of SELECTED) {
      const position = positionOf(fen);
      const sans = generateLegalMoves(position).map((move) => {
        const san = sanOf(position, move);
        const next = applyLegalMove(position, move);
        expect(next.ok, `${fen} ${uci(move)}`).toBe(true);
        if (!next.ok) return san;
        expect(san, `${fen} ${uci(move)}`).toMatch(SAN_SHAPE);
        expect(san.endsWith("+") || san.endsWith("#") ? san.slice(-1) : "").toBe(
          expectedSuffix(next.value),
        );
        expect(san.includes("x"), `${fen} ${san}`).toBe(isCapture(position, move));
        expect(san.includes("="), san).toBe(move.promotion !== undefined);
        return san;
      });
      expect(new Set(sans).size, fen).toBe(sans.length);
      expect(formatFen(position)).toBe(fen);
    }
  });

  it("TST-FOUND-SANPROP-002 two legal moves never share SAN along bounded playouts", () => {
    const playout = playoutArbitrary(SELECTED, 30);
    fc.assert(
      fc.property(playout, ({ start, choices }) => {
        for (const position of playoutPositions(start, choices)) {
          const sans = generateLegalMoves(position).map((move) => sanOf(position, move));
          expect(new Set(sans).size).toBe(sans.length);
        }
      }),
      { numRuns: 40 },
    );
  });

  it("TST-FOUND-SANPROP-003 move-exhaustion facts agree with the oracle along playouts", () => {
    const nearTerminal = [
      "k7/8/1QK5/8/8/8/8/8 w - - 0 1",
      "6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1",
      "7k/8/5QK1/8/8/8/8/8 w - - 0 1",
      "8/8/8/8/8/5k2/5p2/7K b - - 0 1",
      goldenFen("TST-RULE-E01-012"),
      goldenFen("TST-RULE-E01-013"),
      goldenFen("TST-RULE-E01-001"),
    ];
    const seen = { checkmate: 0, stalemate: 0, none: 0 };
    fc.assert(
      fc.property(playoutArbitrary(nearTerminal, 12), ({ start, choices }) => {
        for (const position of playoutPositions(start, choices)) {
          const fact = evaluateMoveExhaustion(position);
          const mover = position.sideToMove;
          const inCheck = checkersOf(position, mover).length > 0;
          const moveCount = generateLegalMoves(position).length;
          if (fact === null) {
            seen.none += 1;
            expect(moveCount).toBeGreaterThan(0);
          } else if (fact.kind === "checkmate") {
            seen.checkmate += 1;
            expect([moveCount, inCheck, fact.loser]).toEqual([0, true, mover]);
            expect(fact.winner).not.toBe(mover);
          } else {
            seen.stalemate += 1;
            expect([moveCount, inCheck]).toEqual([0, false]);
          }
        }
      }),
      { numRuns: 200 },
    );
    expect(seen.checkmate).toBeGreaterThan(0);
    expect(seen.stalemate).toBeGreaterThan(0);
    expect(seen.none).toBeGreaterThan(0);
  });
});
