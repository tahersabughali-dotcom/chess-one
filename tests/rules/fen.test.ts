import { checkPositionConsistency, formatFen, parseFen } from "@chess-one/chess-rules";
import { describe, expect, it } from "vitest";
import { GOLDEN_POSITIONS } from "./fixtures/golden-positions.ts";
import { INVALID_FENS } from "./fixtures/invalid-fens.ts";

function consistencyOf(fen: string): readonly string[] {
  const parsed = parseFen(fen);
  if (!parsed.ok) throw new Error(`${fen} must parse: ${parsed.error.message}`);
  return checkPositionConsistency(parsed.value);
}

describe("TST-FOUND-FEN structural FEN", () => {
  it.each(INVALID_FENS)("TST-FOUND-FEN-001 rejects $name with $code", ({ fen, code }) => {
    const result = parseFen(fen);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(code);
  });

  it.each(GOLDEN_POSITIONS)("TST-FOUND-FEN-002 round trips $id", ({ fen }) => {
    const parsed = parseFen(fen);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(formatFen(parsed.value)).toBe(fen);
  });

  it("TST-FOUND-FEN-003 parsed positions are deeply frozen", () => {
    const parsed = parseFen("4k3/8/8/8/8/8/8/4K3 w - - 0 1");
    if (!parsed.ok) throw new Error("must parse");
    const position = parsed.value;
    expect(Object.isFrozen(position)).toBe(true);
    expect(Object.isFrozen(position.board)).toBe(true);
    expect(Object.isFrozen(position.castling)).toBe(true);
    expect(position.board.every((cell) => cell === null || Object.isFrozen(cell))).toBe(true);
  });

  it("TST-FOUND-FEN-004 accepts every valid castling subset in canonical order", () => {
    for (const field of [
      "K",
      "Q",
      "k",
      "q",
      "KQ",
      "Kk",
      "Qq",
      "KQk",
      "KQq",
      "Kkq",
      "Qkq",
      "KQkq",
    ]) {
      const fen = `r3k2r/8/8/8/8/8/8/R3K2R w ${field} - 0 1`;
      const parsed = parseFen(fen);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(formatFen(parsed.value)).toBe(fen);
    }
  });

  it("TST-FOUND-FEN-005 structure is separate from consistency", () => {
    const structurallyValid = [
      ["4k3/8/8/8/8/8/8/P3K3 w - - 0 1", "pawn_on_back_rank"],
      ["8/8/8/8/8/8/8/3kK3 w - - 0 1", "kings_adjacent"],
      ["4k3/8/8/8/8/8/8/R2K3R w KQ - 0 1", "castling_right_without_king"],
      ["4k3/8/8/8/8/8/8/4K3 w K - 0 1", "castling_right_without_rook"],
      ["4k3/8/8/8/8/8/8/4K3 w - d3 0 1", "en_passant_wrong_rank"],
      ["4k3/8/8/8/8/8/8/4K3 w - d6 0 1", "en_passant_without_pawn"],
      ["4k3/3p4/8/3p4/8/8/8/4K3 w - d6 0 1", "en_passant_squares_occupied"],
    ] as const;
    for (const [fen, issue] of structurallyValid) {
      expect(parseFen(fen).ok).toBe(true);
      expect(consistencyOf(fen)).toContain(issue);
    }
  });

  it("TST-FOUND-FEN-006 consistent black en passant target", () => {
    expect(consistencyOf("4k3/8/8/8/3Pp3/8/8/4K3 b - d3 0 1")).toEqual([]);
  });

  it("TST-FOUND-FEN-007 counters accept large safe values and reject unsafe ones", () => {
    expect(parseFen("4k3/8/8/8/8/8/8/4K3 w - - 149 80").ok).toBe(true);
    const unsafe = parseFen("4k3/8/8/8/8/8/8/4K3 w - - 0 9007199254740993");
    expect(unsafe.ok).toBe(false);
    if (!unsafe.ok) expect(unsafe.error.code).toBe("fullmove_number");
  });
});
