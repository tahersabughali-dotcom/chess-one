import {
  createPiece,
  type MoveIntent,
  type Piece,
  promotionPieceKind,
  rankIndex,
  type Square,
  squareIndex,
} from "@chess-one/game-values";
import { cellAt, offsetSquare, pawnDirection } from "./attacks.ts";
import { CASTLING_PATHS, castlingPathOf, enPassantVictim } from "./move-generation.ts";
import { type Board, type CastlingRights, createPosition, type Position } from "./position.ts";

/** Package-internal. Callers must pass a pseudo-legal move of `position.sideToMove`. */

function movingPiece(position: Position, move: MoveIntent): Piece {
  const piece = cellAt(position.board, move.from);
  if (piece === null) throw new Error(`Move transition defect: ${move.from} is empty.`);
  return piece;
}

/**
 * The board after `move`: the piece moves (replaced by the chosen piece on
 * promotion, Article 3.7.3.3), the en passant victim is removed from its own
 * square (Article 3.7.3.1), and castling also moves the rook (Article 3.8.2.1).
 */
export function boardAfterMove(position: Position, move: MoveIntent): Board {
  const piece = movingPiece(position, move);
  const board = [...position.board];
  const put = (square: Square, cell: Piece | null): void => {
    board[squareIndex(square)] = cell;
  };
  const victim = enPassantVictim(position, move);
  const castling = castlingPathOf(position, move);
  put(move.from, null);
  put(
    move.to,
    move.promotion === undefined
      ? piece
      : createPiece(piece.color, promotionPieceKind(move.promotion)),
  );
  if (victim !== undefined) put(victim, null);
  if (castling !== undefined) {
    put(castling.rookTo, cellAt(position.board, castling.rook));
    put(castling.rook, null);
  }
  return board;
}

/**
 * A king move clears both rights of its colour. Any move from or to a rook's
 * original square clears that right, which covers the rook moving away and
 * the rook being captured. Rights are only ever cleared, never restored.
 */
function castlingAfterMove(position: Position, move: MoveIntent, piece: Piece): CastlingRights {
  const cleared = new Set<keyof CastlingRights>();
  for (const path of CASTLING_PATHS) {
    const kingMoved = piece.kind === "king" && path.color === piece.color;
    if (kingMoved || path.rook === move.from || path.rook === move.to) cleared.add(path.right);
  }
  const keep = (right: keyof CastlingRights): boolean =>
    position.castling[right] && !cleared.has(right);
  return {
    whiteKingside: keep("whiteKingside"),
    whiteQueenside: keep("whiteQueenside"),
    blackKingside: keep("blackKingside"),
    blackQueenside: keep("blackQueenside"),
  };
}

/**
 * Applies a pseudo-legal move and returns the canonical next position. A
 * failure of `createPosition` here is a programming defect, never an ordinary
 * illegal move, so it throws.
 */
export function applyPseudoLegalMove(position: Position, move: MoveIntent): Position {
  const piece = movingPiece(position, move);
  const isPawn = piece.kind === "pawn";
  const isCapture =
    cellAt(position.board, move.to) !== null || enPassantVictim(position, move) !== undefined;
  const isDoublePush = isPawn && Math.abs(rankIndex(move.to) - rankIndex(move.from)) === 2;
  const next = createPosition({
    board: boardAfterMove(position, move),
    sideToMove: piece.color === "white" ? "black" : "white",
    castling: castlingAfterMove(position, move, piece),
    enPassantTarget: isDoublePush
      ? (offsetSquare(move.from, [0, pawnDirection(piece.color)]) ?? null)
      : null,
    halfmoveClock: isPawn || isCapture ? 0 : position.halfmoveClock + 1,
    fullmoveNumber: position.fullmoveNumber + (piece.color === "black" ? 1 : 0),
  });
  if (!next.ok) throw new Error(`Move transition defect: ${next.error.message}`);
  return next.value;
}
