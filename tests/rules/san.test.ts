import {
  applyLegalMove,
  checkPositionConsistency,
  formatFen,
  toCanonicalSan,
} from "@chess-one/chess-rules";
import { describe, expect, it } from "vitest";
import { goldenFen } from "./fixtures/golden-positions.ts";
import { intentOf, legalUci, positionOf, sanOf } from "./support/positions.ts";

type SanCase = readonly [fen: string, uci: string, san: string];

/** Each fixture must be consistent and the move legal before its SAN is checked. */
function expectSan(cases: readonly SanCase[]): void {
  for (const [fen, move, san] of cases) {
    expect(checkPositionConsistency(positionOf(fen)), fen).toEqual([]);
    expect(legalUci(positionOf(fen)), fen).toContain(move);
    expect(sanOf(fen, move), `${fen} ${move}`).toBe(san);
  }
}

/** Legal moves of the side to move that land on `square`. */
function movesTo(fen: string, square: string): string[] {
  return legalUci(positionOf(fen)).filter((move) => move.slice(2, 4) === square);
}

const INITIAL = goldenFen("TST-RULE-E01-001");
const KQ = "4k3/8/8/8/8/8/8/3QK3 w - - 0 1";
const PROMOTE = "7k/P7/8/8/8/8/8/K7 w - - 0 1";
const CASTLE_WHITE = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
const CASTLE_BLACK = "r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1";

describe("TST-FOUND-SAN Chess One canonical SAN", () => {
  it("TST-FOUND-SAN-001 quiet moves: pawn without letter, pieces with K Q R B N", () => {
    expectSan([
      [INITIAL, "e2e4", "e4"],
      [INITIAL, "g1f3", "Nf3"],
      ["4k3/8/8/8/8/6B1/8/4K3 w - - 0 1", "g3e5", "Be5"],
      ["4k3/8/8/8/8/8/8/R3K3 w - - 0 1", "a1d1", "Rd1"],
      [KQ, "d1d2", "Qd2"],
      [KQ, "e1e2", "Ke2"],
    ]);
  });

  it("TST-FOUND-SAN-002 every capture has x; pawn captures name the source file only", () => {
    expectSan([
      ["4k3/8/8/8/8/5p2/8/4K1N1 w - - 0 1", "g1f3", "Nxf3"],
      ["4k3/8/8/8/8/8/8/R2n3K w - - 0 1", "a1d1", "Rxd1"],
      ["4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1", "e4d5", "exd5"],
      ["3r4/4P3/8/8/8/8/8/k1K5 w - - 0 1", "e7d8q", "exd8=Q"],
    ]);
  });

  it("TST-FOUND-SAN-003 castling is O-O and O-O-O with capital O for both colours", () => {
    expectSan([
      [CASTLE_WHITE, "e1g1", "O-O"],
      [CASTLE_WHITE, "e1c1", "O-O-O"],
      [CASTLE_BLACK, "e8g8", "O-O"],
      [CASTLE_BLACK, "e8c8", "O-O-O"],
    ]);
  });

  it("TST-FOUND-SAN-004 promotion appends =Q, =R, =B, =N before any check suffix", () => {
    expectSan([
      [PROMOTE, "a7a8q", "a8=Q+"],
      [PROMOTE, "a7a8r", "a8=R+"],
      [PROMOTE, "a7a8b", "a8=B"],
      [PROMOTE, "a7a8n", "a8=N"],
      ["1n6/P7/8/7k/8/8/8/4K3 w - - 0 1", "a7b8r", "axb8=R"],
    ]);
  });

  it("TST-FOUND-SAN-005 check appends + when the checked side still has a legal move", () => {
    expectSan([
      [KQ, "d1h5", "Qh5+"],
      ["6k1/5pp1/8/8/8/8/8/4R1K1 w - - 0 1", "e1e8", "Re8+"],
    ]);
  });

  it("TST-FOUND-SAN-006 checkmate appends # (never ++), including after a promotion", () => {
    expectSan([
      ["6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1", "e1e8", "Re8#"],
      ["rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2", "d8h4", "Qh4#"],
      [goldenFen("TST-RULE-E01-011a"), "a7a8q", "a8=Q#"],
    ]);
  });

  it("TST-FOUND-SAN-007 en passant uses the plain pawn-capture form without e.p.", () => {
    expectSan([
      [goldenFen("TST-RULE-E01-009"), "e5d6", "exd6"],
      ["4k3/8/8/8/3pP3/8/8/4K3 b - e3 0 1", "d4e3", "dxe3"],
    ]);
  });
});

describe("TST-FOUND-SAN disambiguation among legal same-kind moves", () => {
  it("TST-FOUND-SAN-008 file disambiguation when the source file is unique", () => {
    const fen = "4k3/8/8/8/8/8/3N4/4K1N1 w - - 0 1";
    expect(movesTo(fen, "f3")).toEqual(["g1f3", "d2f3"]);
    expectSan([
      [fen, "g1f3", "Ngf3"],
      [fen, "d2f3", "Ndf3"],
    ]);
  });

  it("TST-FOUND-SAN-009 rank disambiguation when the pieces share a file", () => {
    const knights = "4k3/8/8/6N1/8/8/8/4K1N1 w - - 0 1";
    const rooks = "4k3/8/8/R7/8/8/8/R3K3 w - - 0 1";
    expect(movesTo(knights, "f3")).toEqual(["g1f3", "g5f3"]);
    expect(movesTo(rooks, "a3")).toEqual(["a1a3", "a5a3"]);
    expectSan([
      [knights, "g1f3", "N1f3"],
      [knights, "g5f3", "N5f3"],
      [rooks, "a1a3", "R1a3"],
      [rooks, "a5a3", "R5a3"],
    ]);
  });

  it("TST-FOUND-SAN-010 file and rank when neither alone identifies the piece", () => {
    const fen = "4k3/8/8/8/8/1N6/8/1N2KN2 w - - 0 1";
    expect(movesTo(fen, "d2")).toEqual(["b1d2", "e1d2", "f1d2", "b3d2"]);
    expectSan([
      [fen, "b1d2", "Nb1d2"],
      [fen, "b3d2", "N3d2"],
      [fen, "f1d2", "Nfd2"],
      [fen, "e1d2", "Kd2"],
    ]);
  });

  it("TST-FOUND-SAN-011 capture with disambiguation", () => {
    const fen = "4k3/8/8/8/8/8/8/R2n1R1K w - - 0 1";
    expect(movesTo(fen, "d1")).toEqual(["a1d1", "f1d1"]);
    expectSan([
      [fen, "a1d1", "Raxd1"],
      [fen, "f1d1", "Rfxd1"],
    ]);
  });

  it("TST-FOUND-SAN-012 a pinned same-kind piece does not force disambiguation", () => {
    const pinned = "4k3/8/8/8/1b6/2N5/8/4K1N1 w - - 0 1";
    const free = "4k3/8/8/8/8/2N5/8/4K1N1 w - - 0 1";
    expect(movesTo(pinned, "e2")).toEqual(["e1e2", "g1e2"]);
    expect(applyLegalMove(positionOf(pinned), intentOf("c3e2"))).toEqual({
      ok: false,
      error: "illegal_move",
    });
    expectSan([[pinned, "g1e2", "Ne2"]]);
    expect(movesTo(free, "e2")).toEqual(["e1e2", "g1e2", "c3e2"]);
    expectSan([
      [free, "g1e2", "Nge2"],
      [free, "c3e2", "Nce2"],
    ]);
  });
});

describe("TST-FOUND-SAN output-only contract", () => {
  it("TST-FOUND-SAN-013 an illegal intent gets the applyLegalMove error and no SAN", () => {
    const cases: readonly (readonly [string, string])[] = [
      [INITIAL, "e2e5"],
      [INITIAL, "e2e4q"],
      [INITIAL, "e7e5"],
      [goldenFen("TST-RULE-E01-011a"), "a7a8"],
      ["4k3/8/8/8/1b6/2N5/8/4K1N1 w - - 0 1", "c3e2"],
      [goldenFen("TST-RULE-E01-010"), "e5d6"],
    ];
    for (const [fen, move] of cases) {
      const position = positionOf(fen);
      const applied = applyLegalMove(position, intentOf(move));
      expect(applied.ok, move).toBe(false);
      if (applied.ok) continue;
      expect(toCanonicalSan(position, intentOf(move))).toEqual({ ok: false, error: applied.error });
    }
    const untyped = JSON.parse('{"from":"z9","to":"a8"}');
    expect(toCanonicalSan(positionOf(INITIAL), untyped)).toEqual({
      ok: false,
      error: "illegal_move",
    });
  });

  it("TST-FOUND-SAN-014 SAN derivation does not mutate the position and is deterministic", () => {
    const position = positionOf(goldenFen("TST-RULE-E01-009"));
    const before = formatFen(position);
    const first = toCanonicalSan(position, intentOf("e5d6"));
    expect(toCanonicalSan(position, intentOf("e5d6"))).toEqual(first);
    expect(formatFen(position)).toBe(before);
  });
});
