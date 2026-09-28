import { type Color, type Piece, type Square, squareIndex } from "@chess-one/game-values";

export interface CastlingRights {
  readonly whiteKingside: boolean;
  readonly whiteQueenside: boolean;
  readonly blackKingside: boolean;
  readonly blackQueenside: boolean;
}

/** 64 cells indexed by `squareIndex`; `null` is an empty square. */
export type Board = readonly (Piece | null)[];

export interface Position {
  readonly board: Board;
  readonly sideToMove: Color;
  readonly castling: CastlingRights;
  readonly enPassantTarget: Square | null;
  readonly halfmoveClock: number;
  readonly fullmoveNumber: number;
}

export function freezePosition(position: Position): Position {
  return Object.freeze({
    board: Object.freeze([...position.board]),
    sideToMove: position.sideToMove,
    castling: Object.freeze({ ...position.castling }),
    enPassantTarget: position.enPassantTarget,
    halfmoveClock: position.halfmoveClock,
    fullmoveNumber: position.fullmoveNumber,
  });
}

export function pieceAt(position: Position, square: Square): Piece | null {
  return position.board[squareIndex(square)] ?? null;
}
