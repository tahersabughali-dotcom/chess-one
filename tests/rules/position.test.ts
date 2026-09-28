import {
  type Board,
  createInitialPosition,
  createPosition,
  formatFen,
  isCanonicalPosition,
  type Position,
  type PositionFields,
  parseFen,
  pieceAt,
} from "@chess-one/chess-rules";
import { createPiece, type Piece } from "@chess-one/game-values";
import { describe, expect, it } from "vitest";

/** `true` only when every `A` is assignable to `B`; the tuple stops distribution. */
type IsAssignable<A, B> = [A] extends [B] ? true : false;

const LONE_KINGS = "4k3/8/8/8/8/8/8/4K3 w - - 0 1";

function fieldsOf(fen: string): PositionFields {
  const parsed = parseFen(fen);
  if (!parsed.ok) throw new Error(`${fen}: ${parsed.error.message}`);
  const { board, sideToMove, castling, enPassantTarget, halfmoveClock, fullmoveNumber } =
    parsed.value;
  return { board, sideToMove, castling, enPassantTarget, halfmoveClock, fullmoveNumber };
}

function codeOf(fields: PositionFields): string {
  const created = createPosition(fields);
  return created.ok ? "ok" : created.error.code;
}

describe("TST-FOUND-POSITION canonical position invariant", () => {
  it("TST-FOUND-POSITION-001 parseFen returns an immutable canonical position", () => {
    const parsed = parseFen(LONE_KINGS);
    if (!parsed.ok) throw new Error("must parse");
    const position = parsed.value;
    expect(isCanonicalPosition(position)).toBe(true);
    expect(position.board).toHaveLength(64);
    expect(Object.isFrozen(position)).toBe(true);
    expect(Object.isFrozen(position.board)).toBe(true);
    expect(Object.isFrozen(position.castling)).toBe(true);
    expect(Reflect.set(position, "sideToMove", "black")).toBe(false);
    expect(position.sideToMove).toBe("white");
  });

  it("TST-FOUND-POSITION-002 the initial position is canonical and round trips", () => {
    const initial = createInitialPosition();
    expect(isCanonicalPosition(initial)).toBe(true);
    expect(formatFen(initial)).toBe("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
  });

  it("TST-FOUND-POSITION-003 rejects boards that are not exactly 64 cells", () => {
    const fields = fieldsOf(LONE_KINGS);
    expect(codeOf({ ...fields, board: fields.board.slice(0, 63) })).toBe("board_length");
    expect(codeOf({ ...fields, board: [...fields.board, null] })).toBe("board_length");
    expect(codeOf({ ...fields, board: [] })).toBe("board_length");
  });

  it("TST-FOUND-POSITION-004 rejects holes and non-piece cells", () => {
    const fields = fieldsOf(LONE_KINGS);
    const sparse: (Piece | null)[] = [...fields.board];
    delete sparse[10];
    expect(codeOf({ ...fields, board: sparse })).toBe("board_cell");
    const bogus: Board = fields.board.map((cell, index) =>
      index === 10 ? JSON.parse('{"color":"green","kind":"king"}') : cell,
    );
    expect(codeOf({ ...fields, board: bogus })).toBe("board_cell");
  });

  it("TST-FOUND-POSITION-005 rejects missing and extra kings", () => {
    const fields = fieldsOf(LONE_KINGS);
    const noKings = fields.board.map((cell) => (cell?.kind === "king" ? null : cell));
    expect(codeOf({ ...fields, board: noKings })).toBe("king_count");
    const extra = fields.board.map((cell, index) =>
      index === 0 ? createPiece("white", "king") : cell,
    );
    expect(codeOf({ ...fields, board: extra })).toBe("king_count");
  });

  it("TST-FOUND-POSITION-006 rejects invalid counters, side, castling, and en passant", () => {
    const fields = fieldsOf(LONE_KINGS);
    for (const halfmoveClock of [-1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(codeOf({ ...fields, halfmoveClock })).toBe("halfmove_clock");
    }
    for (const fullmoveNumber of [0, 1.5, Number.POSITIVE_INFINITY]) {
      expect(codeOf({ ...fields, fullmoveNumber })).toBe("fullmove_number");
    }
    expect(codeOf({ ...fields, sideToMove: JSON.parse('"red"') })).toBe("side_to_move");
    expect(
      codeOf({ ...fields, castling: { ...fields.castling, whiteKingside: JSON.parse("1") } }),
    ).toBe("castling_rights");
    expect(codeOf({ ...fields, enPassantTarget: "e4" })).toBe("en_passant_target");
    expect(codeOf({ ...fields, enPassantTarget: "e6", halfmoveClock: 0 })).toBe("ok");
  });

  it("TST-FOUND-POSITION-007 created positions copy their input", () => {
    const fields = fieldsOf(LONE_KINGS);
    const board: (Piece | null)[] = [...fields.board];
    const created = createPosition({ ...fields, board });
    if (!created.ok) throw new Error("must create");
    board[0] = createPiece("white", "queen");
    expect(pieceAt(created.value, "a1")).toBeNull();
  });

  it("TST-FOUND-POSITION-008 structural copies are not canonical", () => {
    const initial = createInitialPosition();
    expect(isCanonicalPosition({ ...initial })).toBe(false);
    expect(isCanonicalPosition(fieldsOf(LONE_KINGS))).toBe(false);
    expect(isCanonicalPosition(null)).toBe(false);
  });

  it("TST-FOUND-POSITION-009 external code cannot structurally manufacture a Position", () => {
    const initial = createInitialPosition();
    const spread = { ...initial };
    // Each constant fails typecheck if its left-hand type ever becomes `true`.
    const literalIsPosition: IsAssignable<PositionFields, Position> = false;
    const spreadIsPosition: IsAssignable<typeof spread, Position> = false;
    const requiredIsPosition: IsAssignable<Required<Position>, Position> = false;
    const positionIsPosition: IsAssignable<Position, Position> = true;
    expect([literalIsPosition, spreadIsPosition, requiredIsPosition]).toEqual([
      false,
      false,
      false,
    ]);
    expect(positionIsPosition).toBe(true);
  });
});
