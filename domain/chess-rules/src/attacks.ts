import {
  type Color,
  fileIndex,
  oppositeColor,
  type Piece,
  type PieceKind,
  rankIndex,
  SQUARES,
  type Square,
  squareAt,
  squareIndex,
} from "@chess-one/game-values";
import type { Board, Position } from "./position.ts";

export type Step = readonly [file: number, rank: number];

export const KNIGHT_STEPS: readonly Step[] = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
];
export const ROOK_DIRECTIONS: readonly Step[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
export const BISHOP_DIRECTIONS: readonly Step[] = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
export const KING_STEPS: readonly Step[] = [...ROOK_DIRECTIONS, ...BISHOP_DIRECTIONS];

/** Rank direction in which pawns of `color` advance. */
export function pawnDirection(color: Color): 1 | -1 {
  return color === "white" ? 1 : -1;
}

export function offsetSquare(square: Square, [file, rank]: Step): Square | undefined {
  return squareAt(fileIndex(square) + file, rankIndex(square) + rank);
}

/** Reads a cell of a 64-cell board; a missing cell is an invariant defect, not an empty square. */
export function cellAt(board: Board, square: Square): Piece | null {
  const cell = board[squareIndex(square)];
  if (cell === undefined) throw new Error(`Board invariant violated: no cell for ${square}.`);
  return cell;
}

function holds(board: Board, square: Square | undefined, color: Color, kind: PieceKind): boolean {
  if (square === undefined) return false;
  const cell = cellAt(board, square);
  return cell !== null && cell.color === color && cell.kind === kind;
}

function slidingAttack(
  board: Board,
  target: Square,
  by: Color,
  directions: readonly Step[],
  kind: "rook" | "bishop",
): boolean {
  for (const direction of directions) {
    let square = offsetSquare(target, direction);
    while (square !== undefined) {
      const cell = cellAt(board, square);
      if (cell !== null) {
        if (cell.color === by && (cell.kind === kind || cell.kind === "queen")) return true;
        break;
      }
      square = offsetSquare(square, direction);
    }
  }
  return false;
}

/**
 * Geometric attack relation (Articles 3.1-3.7): whether any piece of `by` could
 * reach `target` by its capture pattern. Legality is never consulted, so a
 * pinned piece still attacks, and castling is not an attack.
 */
export function isAttackedOnBoard(board: Board, target: Square, by: Color): boolean {
  const pawnRank = -pawnDirection(by);
  return (
    holds(board, offsetSquare(target, [-1, pawnRank]), by, "pawn") ||
    holds(board, offsetSquare(target, [1, pawnRank]), by, "pawn") ||
    KNIGHT_STEPS.some((step) => holds(board, offsetSquare(target, step), by, "knight")) ||
    KING_STEPS.some((step) => holds(board, offsetSquare(target, step), by, "king")) ||
    slidingAttack(board, target, by, ROOK_DIRECTIONS, "rook") ||
    slidingAttack(board, target, by, BISHOP_DIRECTIONS, "bishop")
  );
}

export function findKingOnBoard(board: Board, color: Color): Square {
  const square = SQUARES.find((candidate) => holds(board, candidate, color, "king"));
  if (square === undefined) throw new Error(`Board invariant violated: no ${color} king.`);
  return square;
}

/** The square of `color`'s king. A canonical `Position` always has exactly one. */
export function findKing(position: Position, color: Color): Square {
  return findKingOnBoard(position.board, color);
}

export function isSquareAttacked(position: Position, square: Square, byColor: Color): boolean {
  return isAttackedOnBoard(position.board, square, byColor);
}

export function isInCheck(position: Position, color: Color): boolean {
  return isAttackedOnBoard(position.board, findKing(position, color), oppositeColor(color));
}
