import {
  type Color,
  createPiece,
  err,
  isSquare,
  ok,
  PIECE_KINDS,
  type Piece,
  type Result,
  rankIndex,
  type Square,
  squareIndex,
} from "@chess-one/game-values";

export interface CastlingRights {
  readonly whiteKingside: boolean;
  readonly whiteQueenside: boolean;
  readonly blackKingside: boolean;
  readonly blackQueenside: boolean;
}

/** Cells indexed by `squareIndex`; `null` is an empty square. `Position` guarantees 64 cells. */
export type Board = readonly (Piece | null)[];

/** Unvalidated input for `createPosition`. */
export interface PositionFields {
  readonly board: Board;
  readonly sideToMove: Color;
  readonly castling: CastlingRights;
  readonly enPassantTarget: Square | null;
  readonly halfmoveClock: number;
  readonly fullmoveNumber: number;
}

export type PositionInvariantCode =
  | "board_length"
  | "board_cell"
  | "king_count"
  | "side_to_move"
  | "castling_rights"
  | "en_passant_target"
  | "halfmove_clock"
  | "fullmove_number";

export interface PositionInvariantError {
  readonly code: PositionInvariantCode;
  readonly message: string;
}

const BOARD_CELLS = 64;
const PIECE_KIND_SET: ReadonlySet<string> = new Set(PIECE_KINDS);

function invariantError(
  code: PositionInvariantCode,
  message: string,
): Result<never, PositionInvariantError> {
  return err({ code, message });
}

function isColor(value: unknown): value is Color {
  return value === "white" || value === "black";
}

function copyBoard(board: Board): Result<Board, PositionInvariantError> {
  if (board.length !== BOARD_CELLS) {
    return invariantError("board_length", `Board has ${board.length} cells instead of 64.`);
  }
  const cells: (Piece | null)[] = [];
  for (let index = 0; index < BOARD_CELLS; index += 1) {
    const cell = board[index];
    if (cell === null) {
      cells.push(null);
    } else if (cell !== undefined && isColor(cell.color) && PIECE_KIND_SET.has(cell.kind)) {
      cells.push(createPiece(cell.color, cell.kind));
    } else {
      return invariantError("board_cell", `Board cell ${index} is neither empty nor a piece.`);
    }
  }
  for (const color of ["white", "black"] as const) {
    const kings = cells.filter((cell) => cell?.kind === "king" && cell.color === color).length;
    if (kings !== 1) {
      return invariantError("king_count", `Board has ${kings} ${color} kings instead of 1.`);
    }
  }
  return ok(Object.freeze(cells));
}

function copyCastling(castling: CastlingRights): CastlingRights | undefined {
  const rights = [
    castling.whiteKingside,
    castling.whiteQueenside,
    castling.blackKingside,
    castling.blackQueenside,
  ];
  if (!rights.every((right) => typeof right === "boolean")) return undefined;
  return Object.freeze({
    whiteKingside: castling.whiteKingside,
    whiteQueenside: castling.whiteQueenside,
    blackKingside: castling.blackKingside,
    blackQueenside: castling.blackQueenside,
  });
}

function isEnPassantTarget(value: Square | null): boolean {
  if (value === null) return true;
  return isSquare(value) && (rankIndex(value) === 2 || rankIndex(value) === 5);
}

function isCounter(value: number, minimum: number): boolean {
  return Number.isSafeInteger(value) && value >= minimum;
}

/**
 * Canonical position: 64 cells, exactly one king per colour, a valid side to
 * move, four castling booleans, an en passant target that is null or on rank 3
 * or 6, and safe-integer counters. The object, board, and castling rights are
 * frozen. Canonical is not legal or reachable (Article 3.10.3).
 *
 * The private field makes the type nominal: object literals and spread copies
 * are not assignable to `Position`, so every instance comes from `create`.
 */
class Position {
  readonly #canonical = true;
  readonly board: Board;
  readonly sideToMove: Color;
  readonly castling: CastlingRights;
  readonly enPassantTarget: Square | null;
  readonly halfmoveClock: number;
  readonly fullmoveNumber: number;

  private constructor(
    board: Board,
    castling: CastlingRights,
    fields: Omit<PositionFields, "board" | "castling">,
  ) {
    this.board = board;
    this.sideToMove = fields.sideToMove;
    this.castling = castling;
    this.enPassantTarget = fields.enPassantTarget;
    this.halfmoveClock = fields.halfmoveClock;
    this.fullmoveNumber = fields.fullmoveNumber;
    Object.freeze(this);
  }

  static create(fields: PositionFields): Result<Position, PositionInvariantError> {
    const board = copyBoard(fields.board);
    if (!board.ok) return board;
    if (!isColor(fields.sideToMove)) {
      return invariantError("side_to_move", "Side to move is not white or black.");
    }
    const castling = copyCastling(fields.castling);
    if (castling === undefined) {
      return invariantError("castling_rights", "Castling rights are not four booleans.");
    }
    if (!isEnPassantTarget(fields.enPassantTarget)) {
      return invariantError("en_passant_target", "En passant target is not on rank 3 or 6.");
    }
    if (!isCounter(fields.halfmoveClock, 0)) {
      return invariantError("halfmove_clock", "Halfmove clock is not a non-negative safe integer.");
    }
    if (!isCounter(fields.fullmoveNumber, 1)) {
      return invariantError("fullmove_number", "Fullmove number is not a positive safe integer.");
    }
    return ok(new Position(board.value, castling, fields));
  }

  static isCanonical(value: unknown): value is Position {
    return typeof value === "object" && value !== null && #canonical in value;
  }
}

export type { Position };

/** The only way to obtain a `Position` apart from `parseFen` and `createInitialPosition`. */
export function createPosition(fields: PositionFields): Result<Position, PositionInvariantError> {
  return Position.create(fields);
}

export function isCanonicalPosition(value: unknown): value is Position {
  return Position.isCanonical(value);
}

export function pieceAt(position: Position, square: Square): Piece | null {
  const cell = position.board[squareIndex(square)];
  if (cell === undefined) throw new Error(`Position invariant violated: no cell for ${square}.`);
  return cell;
}
