import {
  applyLegalMove,
  assessMatingCapability,
  assessMatingPossibility,
  createInitialPosition,
  createPosition,
  evaluateMoveExhaustion,
  findMatingWitness,
  formatFen,
  generateLegalMoves,
  isInCheck,
  type Position,
  parseFen,
  repetitionKey,
} from "@chess-one/chess-rules";
import {
  type Color,
  createPiece,
  type MoveIntent,
  oppositeColor,
  type Piece,
  type PieceKind,
} from "@chess-one/game-values";
import { describe, expect, it } from "vitest";
import { goldenFen } from "./fixtures/golden-positions.ts";
import { intentOf } from "./support/positions.ts";

function position(fen: string): Position {
  const parsed = parseFen(fen);
  if (!parsed.ok) throw new Error(`${fen}: ${parsed.error.message}`);
  return parsed.value;
}

function capability(fen: string, color: Color) {
  return assessMatingCapability(position(fen), color);
}

function replay(start: Position, line: readonly MoveIntent[]): Position {
  let current = start;
  for (const move of line) {
    const next = applyLegalMove(current, move);
    if (!next.ok)
      throw new Error(`${move.from}${move.to} is ${next.error} in ${formatFen(current)}`);
    current = next.value;
  }
  return current;
}

/** The line is the proof: every move is replayed through the public API and must end in mate. */
function expectVerifiedMate(fen: string, color: Color): readonly MoveIntent[] {
  const start = position(fen);
  const line = findMatingWitness(start, color);
  expect(line, fen).not.toBeNull();
  const end = replay(start, line ?? []);
  expect(evaluateMoveExhaustion(end), `${fen} -> ${formatFen(end)}`).toEqual({
    kind: "checkmate",
    winner: color,
    loser: oppositeColor(color),
  });
  expect(assessMatingCapability(start, color)).toBe("PROVEN_CAN_MATE");
  return line ?? [];
}

const NO_CASTLING = {
  whiteKingside: false,
  whiteQueenside: false,
  blackKingside: false,
  blackQueenside: false,
};

function placed(pieces: readonly (readonly [number, Piece])[], sideToMove: Color): Position | null {
  const board: (Piece | null)[] = new Array<Piece | null>(64).fill(null);
  for (const [index, piece] of pieces) board[index] = piece;
  const created = createPosition({
    board,
    sideToMove,
    castling: NO_CASTLING,
    enPassantTarget: null,
    halfmoveClock: 0,
    fullmoveNumber: 1,
  });
  return created.ok ? created.value : null;
}

function adjacent(a: number, b: number): boolean {
  return Math.abs((a % 8) - (b % 8)) <= 1 && Math.abs((a - (a % 8) - (b - (b % 8))) / 8) <= 1;
}

/**
 * Every placement of a white king and one white `piece` against a lone black
 * king, black to move, stopping once `stopAfter` mates are found.
 */
function loneKingMates(
  piece: PieceKind,
  stopAfter = Number.POSITIVE_INFINITY,
): { readonly checks: number; readonly mates: string[] } {
  let checks = 0;
  const mates: string[] = [];
  const white = createPiece("white", "king");
  const black = createPiece("black", "king");
  const extra = createPiece("white", piece);
  for (let wk = 0; wk < 64; wk += 1) {
    for (let bk = 0; bk < 64; bk += 1) {
      if (bk === wk || adjacent(wk, bk)) continue;
      for (let square = 0; square < 64; square += 1) {
        if (square === wk || square === bk) continue;
        const candidate = placed(
          [
            [wk, white],
            [bk, black],
            [square, extra],
          ],
          "black",
        );
        if (candidate === null || !isInCheck(candidate, "black")) continue;
        checks += 1;
        if (generateLegalMoves(candidate).length === 0) mates.push(formatFen(candidate));
        if (mates.length >= stopAfter) return { checks, mates };
      }
    }
  }
  return { checks, mates };
}

describe("TST-RULE-CAP one-sided mating capability: existential capability, not forced mate", () => {
  it("TST-RULE-CAP-001 a side that owns only its king can never mate, whatever the opponent owns", () => {
    for (const fen of [
      "4k3/8/8/8/8/8/8/3QK3 w - - 0 1",
      "4k3/8/8/8/8/8/8/R3K3 b - - 0 1",
      "4k3/8/8/8/8/8/2N1N3/4K3 w - - 0 1",
      "4k3/8/8/8/8/8/PPPPPPPP/RNBQKBNR w KQ - 0 1",
    ]) {
      expect(capability(fen, "black"), fen).toBe("PROVEN_CANNOT_MATE");
    }
    expect(capability("rnbqkbnr/pppppppp/8/8/8/8/8/4K3 b kq - 0 1", "white")).toBe(
      "PROVEN_CANNOT_MATE",
    );
  });

  it("TST-RULE-CAP-002 king and queen against a lone king: the answer depends on which side is asked", () => {
    const whiteFlags = "4k3/8/8/8/8/8/8/3QK3 w - - 0 1";
    expect(capability(whiteFlags, "black")).toBe("PROVEN_CANNOT_MATE");
    const blackFlags = "4k3/8/8/8/8/8/8/3QK3 b - - 0 1";
    expectVerifiedMate(blackFlags, "white");
    expect(capability(blackFlags, "black")).toBe("PROVEN_CANNOT_MATE");
    expect(assessMatingPossibility(position(blackFlags))).toBe("UNKNOWN");
  });

  it("TST-RULE-CAP-003 king and rook against a lone king can mate by a verified cooperative line", () => {
    for (const fen of [
      "4k3/8/8/8/8/8/8/R3K3 w - - 0 1",
      "4k3/8/8/8/8/8/8/R3K3 b - - 0 1",
      "8/8/3k4/8/8/4K3/8/7r b - - 0 1",
    ]) {
      expectVerifiedMate(fen, fen.includes("r b") ? "black" : "white");
    }
  });

  it("TST-RULE-CAP-004 king and bishop against a lone king has no cooperative mate: no mate of the lone king exists in any placement", () => {
    const { checks, mates } = loneKingMates("bishop");
    expect(checks).toBeGreaterThan(1_000);
    expect(mates).toEqual([]);
    expect(capability(goldenFen("TST-RULE-E01-014b"), "white")).toBe("PROVEN_CANNOT_MATE");
    expect(capability(goldenFen("TST-RULE-E01-014b"), "black")).toBe("PROVEN_CANNOT_MATE");
    expect(capability("8/8/8/8/4k3/8/4b3/4K3 w - - 0 1", "black")).toBe("PROVEN_CANNOT_MATE");
    expect(capability("8/8/8/8/4k3/8/4b3/4K3 w - - 0 1", "white")).toBe("PROVEN_CANNOT_MATE");
  });

  it("TST-RULE-CAP-005 king and knight against a lone king has no cooperative mate: no mate of the lone king exists in any placement", () => {
    const { checks, mates } = loneKingMates("knight");
    expect(checks).toBeGreaterThan(1_000);
    expect(mates).toEqual([]);
    expect(capability(goldenFen("TST-RULE-E01-014c"), "white")).toBe("PROVEN_CANNOT_MATE");
    expect(capability(goldenFen("TST-RULE-E01-014c"), "black")).toBe("PROVEN_CANNOT_MATE");
    expect(capability("8/8/8/8/4k3/8/4n3/4K3 w - - 0 1", "black")).toBe("PROVEN_CANNOT_MATE");
  });

  it("TST-RULE-CAP-006 the enumeration used for 004 and 005 does find mates when they exist", () => {
    const [mate] = loneKingMates("rook", 1).mates;
    expect(mate).toBeDefined();
    expect(evaluateMoveExhaustion(position(mate ?? ""))).toMatchObject({ kind: "checkmate" });
  });

  it("TST-RULE-CAP-007 king and two knights against a lone king can mate cooperatively, although it cannot be forced", () => {
    const line = expectVerifiedMate(goldenFen("TST-RULE-E01-014d"), "white");
    expect(line.length).toBeGreaterThan(0);
    expectVerifiedMate("8/8/8/8/4k3/8/2n1n3/4K3 b - - 0 1", "black");
    expect(evaluateMoveExhaustion(position("k7/2K5/1NN5/8/8/8/8/8 b - - 0 1"))).toEqual({
      kind: "checkmate",
      winner: "white",
      loser: "black",
    });
  });

  it("TST-RULE-CAP-008 opponent material matters: a single bishop or knight can mate against a blocker, so those positions are UNKNOWN", () => {
    expect(evaluateMoveExhaustion(position("kn6/1B6/1K6/8/8/8/8/8 b - - 0 1"))).toMatchObject({
      kind: "checkmate",
      winner: "white",
    });
    expect(evaluateMoveExhaustion(position("k1K5/ppN5/8/8/8/8/8/8 b - - 0 1"))).toMatchObject({
      kind: "checkmate",
      winner: "white",
    });
    expect(capability("kn6/8/1K6/8/8/8/8/4B3 w - - 0 1", "white")).toBe("UNKNOWN");
    expect(capability("k1K5/pp6/8/8/8/8/8/4N3 w - - 0 1", "white")).toBe("UNKNOWN");
  });

  it("TST-RULE-CAP-009 UNKNOWN is returned wherever no reviewed proof applies", () => {
    for (const [fen, color] of [
      ["4k3/8/8/8/8/8/4P3/3QK3 w - - 0 1", "white"],
      ["4k3/8/8/8/8/8/3BB3/4K3 w - - 0 1", "white"],
      ["4k3/8/8/8/8/8/3BN3/4K3 w - - 0 1", "white"],
      ["4k3/4r3/8/8/8/8/4R3/4K3 w - - 0 1", "white"],
      ["4k3/8/8/p1p1p1p1/P1P1P1P1/8/8/4K3 w - - 0 1", "black"],
      ["k7/1Q6/8/8/8/8/8/7K b - - 0 1", "white"],
      ["k7/2Q5/1K6/8/8/8/8/8 b - - 0 1", "white"],
    ] as const) {
      expect(capability(fen, color), fen).toBe("UNKNOWN");
    }
    expect(assessMatingCapability(createInitialPosition(), "white")).toBe("UNKNOWN");
    expect(assessMatingCapability(createInitialPosition(), "black")).toBe("UNKNOWN");
  });

  it("TST-RULE-CAP-010 the halfmove clock and the seventy-five-move state do not alter theoretical mating capability", () => {
    for (const board of [
      "4k3/8/8/8/8/8/8/3QK3 b",
      "4k3/8/8/8/8/8/8/3QK3 w",
      "8/8/3k4/8/8/4K3/8/7r b",
    ]) {
      const answers = ["- - 0 1", "- - 20 60", "- - 149 90"].map((counters) =>
        capability(`${board} ${counters}`, board.includes("r") ? "black" : "white"),
      );
      expect(answers, board).toEqual(["PROVEN_CAN_MATE", "PROVEN_CAN_MATE", "PROVEN_CAN_MATE"]);
    }
    const late = position("4k3/8/8/8/8/8/8/3QK3 b - - 149 90");
    expect(late.halfmoveClock).toBe(149);
    const line = findMatingWitness(late, "white") ?? [];
    expect(line.length).toBeGreaterThan(1);
    expect(evaluateMoveExhaustion(replay(late, line))).toMatchObject({
      kind: "checkmate",
      winner: "white",
    });
  });

  it("TST-RULE-CAP-011 repetition history does not alter capability: the same position after cycles that reach and pass a fivefold repetition answers as the fresh one", () => {
    const fresh = position("4k3/8/8/8/8/8/8/3QK3 b - - 0 1");
    const cycle = ["e8f7", "d1d2", "f7e8", "d2d1"];
    let current = fresh;
    const history = [repetitionKey(fresh)];
    for (let occurrence = 2; occurrence <= 6; occurrence += 1) {
      for (const uci of cycle) {
        current = replay(current, [intentOf(uci)]);
        history.push(repetitionKey(current));
      }
      const count = history.filter((key) => key.equals(repetitionKey(fresh))).length;
      expect(count).toBe(occurrence);
      expect(repetitionKey(current).equals(repetitionKey(fresh))).toBe(true);
      expect(assessMatingCapability(current, "white"), `occurrence ${count}`).toBe(
        "PROVEN_CAN_MATE",
      );
      expect(assessMatingCapability(current, "black")).toBe("PROVEN_CANNOT_MATE");
      expect(findMatingWitness(current, "white")).toEqual(findMatingWitness(fresh, "white"));
    }
    expect(current.halfmoveClock).toBe(20);
  });

  it("TST-RULE-CAP-012 every PROVEN_DEAD position is PROVEN_CANNOT_MATE for both colours", () => {
    for (const id of ["TST-RULE-E01-014a", "TST-RULE-E01-014b", "TST-RULE-E01-014c"]) {
      const fen = goldenFen(id);
      expect(assessMatingPossibility(position(fen))).toBe("PROVEN_DEAD");
      expect(capability(fen, "white"), id).toBe("PROVEN_CANNOT_MATE");
      expect(capability(fen, "black"), id).toBe("PROVEN_CANNOT_MATE");
    }
  });

  it("TST-RULE-CAP-013 capability evaluation never modifies the position", () => {
    for (const fen of [
      "4k3/8/8/8/8/8/8/3QK3 b - - 0 1",
      goldenFen("TST-RULE-E01-014d"),
      "4k3/8/8/8/8/8/8/R3K3 w - - 0 1",
    ]) {
      const start = position(fen);
      const board = [...start.board];
      for (const color of ["white", "black"] as const) assessMatingCapability(start, color);
      expect(Object.isFrozen(start)).toBe(true);
      expect(formatFen(start)).toBe(fen);
      expect(start.board).toEqual(board);
    }
  });
});
