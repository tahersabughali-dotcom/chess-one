import { type Position, pieceAt } from "@chess-one/chess-rules";
import {
  type Color,
  fileIndex,
  type PieceKind,
  rankIndex,
  SQUARES,
  type Square,
  squareAt,
} from "@chess-one/game-values";

/**
 * Test-only attack oracle used to validate golden fixture positions. It is not
 * the move engine and makes no legality claim beyond "which pieces attack a square".
 */

const KNIGHT_JUMPS = [
  [1, 2],
  [2, 1],
  [-1, 2],
  [-2, 1],
  [1, -2],
  [2, -1],
  [-1, -2],
  [-2, -1],
] as const;

const KING_STEPS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

const ORTHOGONAL = KING_STEPS.slice(0, 4);
const DIAGONAL = KING_STEPS.slice(4);

function holds(
  position: Position,
  square: Square | undefined,
  color: Color,
  kind: PieceKind,
): boolean {
  if (square === undefined) return false;
  const piece = pieceAt(position, square);
  return piece !== null && piece.color === color && piece.kind === kind;
}

function slidingAttackers(
  position: Position,
  target: Square,
  by: Color,
  directions: readonly (readonly [number, number])[],
  kinds: readonly PieceKind[],
): Square[] {
  const found: Square[] = [];
  for (const [df, dr] of directions) {
    let file = fileIndex(target) + df;
    let rank = rankIndex(target) + dr;
    let square = squareAt(file, rank);
    while (square !== undefined) {
      const piece = pieceAt(position, square);
      if (piece !== null) {
        if (piece.color === by && kinds.includes(piece.kind)) found.push(square);
        break;
      }
      file += df;
      rank += dr;
      square = squareAt(file, rank);
    }
  }
  return found;
}

export function attackersOf(position: Position, target: Square, by: Color): Square[] {
  const file = fileIndex(target);
  const rank = rankIndex(target);
  const found: Square[] = [];
  const pawnRank = by === "white" ? rank - 1 : rank + 1;
  for (const df of [-1, 1]) {
    const square = squareAt(file + df, pawnRank);
    if (square !== undefined && holds(position, square, by, "pawn")) found.push(square);
  }
  for (const [df, dr] of KNIGHT_JUMPS) {
    const square = squareAt(file + df, rank + dr);
    if (square !== undefined && holds(position, square, by, "knight")) found.push(square);
  }
  for (const [df, dr] of KING_STEPS) {
    const square = squareAt(file + df, rank + dr);
    if (square !== undefined && holds(position, square, by, "king")) found.push(square);
  }
  found.push(...slidingAttackers(position, target, by, ORTHOGONAL, ["rook", "queen"]));
  found.push(...slidingAttackers(position, target, by, DIAGONAL, ["bishop", "queen"]));
  return found;
}

export function isAttacked(position: Position, target: Square, by: Color): boolean {
  return attackersOf(position, target, by).length > 0;
}

export function kingSquare(position: Position, color: Color): Square {
  const square = SQUARES.find((candidate) => holds(position, candidate, color, "king"));
  if (square === undefined) throw new Error(`No ${color} king`);
  return square;
}

export function checkersOf(position: Position, color: Color): Square[] {
  const opponent: Color = color === "white" ? "black" : "white";
  return attackersOf(position, kingSquare(position, color), opponent);
}
