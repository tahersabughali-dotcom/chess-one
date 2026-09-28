import {
  type Color,
  fileIndex,
  type MoveIntent,
  PROMOTION_PIECES,
  type PromotionPiece,
  rankIndex,
  SQUARES,
  type Square,
  squareAt,
  squareIndex,
} from "@chess-one/game-values";
import {
  BISHOP_DIRECTIONS,
  cellAt,
  KING_STEPS,
  KNIGHT_STEPS,
  offsetSquare,
  pawnDirection,
  ROOK_DIRECTIONS,
  type Step,
} from "./attacks.ts";
import type { CastlingRights, Position } from "./position.ts";

/** Package-internal: pseudo-legal moves obey movement and occupancy but not king safety. */

export interface CastlingPath {
  readonly right: keyof CastlingRights;
  readonly color: Color;
  readonly king: Square;
  readonly kingTo: Square;
  /** The square the king crosses (Article 3.8.2.2). */
  readonly crossed: Square;
  readonly rook: Square;
  readonly rookTo: Square;
  /** Every square strictly between king and rook (Article 3.8.2.1). */
  readonly between: readonly Square[];
}

export const CASTLING_PATHS: readonly CastlingPath[] = [
  {
    right: "whiteKingside",
    color: "white",
    king: "e1",
    kingTo: "g1",
    crossed: "f1",
    rook: "h1",
    rookTo: "f1",
    between: ["f1", "g1"],
  },
  {
    right: "whiteQueenside",
    color: "white",
    king: "e1",
    kingTo: "c1",
    crossed: "d1",
    rook: "a1",
    rookTo: "d1",
    between: ["d1", "c1", "b1"],
  },
  {
    right: "blackKingside",
    color: "black",
    king: "e8",
    kingTo: "g8",
    crossed: "f8",
    rook: "h8",
    rookTo: "f8",
    between: ["f8", "g8"],
  },
  {
    right: "blackQueenside",
    color: "black",
    king: "e8",
    kingTo: "c8",
    crossed: "d8",
    rook: "a8",
    rookTo: "d8",
    between: ["d8", "c8", "b8"],
  },
];

/** The castling path of a king move, or undefined when the move is not castling. */
export function castlingPathOf(position: Position, move: MoveIntent): CastlingPath | undefined {
  if (cellAt(position.board, move.from)?.kind !== "king") return undefined;
  return CASTLING_PATHS.find((path) => path.king === move.from && path.kingTo === move.to);
}

/** The square of the pawn an en passant capture removes, or undefined for any other move. */
export function enPassantVictim(position: Position, move: MoveIntent): Square | undefined {
  const isPawn = cellAt(position.board, move.from)?.kind === "pawn";
  if (!isPawn || fileIndex(move.from) === fileIndex(move.to)) return undefined;
  if (cellAt(position.board, move.to) !== null) return undefined;
  return squareAt(fileIndex(move.to), rankIndex(move.from));
}

/** Judged on the pre-move board: an occupied destination or an en passant victim. */
export function isCaptureMove(position: Position, move: MoveIntent): boolean {
  return cellAt(position.board, move.to) !== null || enPassantVictim(position, move) !== undefined;
}

function intent(from: Square, to: Square, promotion?: PromotionPiece): MoveIntent {
  return Object.freeze(promotion === undefined ? { from, to } : { from, to, promotion });
}

/** Empty or an opponent piece; the king is never captured (Article 1.4.1). */
function canLand(position: Position, square: Square, mover: Color): boolean {
  const cell = cellAt(position.board, square);
  return cell === null || (cell.color !== mover && cell.kind !== "king");
}

function isOpponentNonKing(position: Position, square: Square, mover: Color): boolean {
  const cell = cellAt(position.board, square);
  return cell !== null && cell.color !== mover && cell.kind !== "king";
}

function stepMoves(position: Position, from: Square, steps: readonly Step[], out: MoveIntent[]) {
  for (const step of steps) {
    const to = offsetSquare(from, step);
    if (to !== undefined && canLand(position, to, position.sideToMove)) out.push(intent(from, to));
  }
}

function rayMoves(
  position: Position,
  from: Square,
  directions: readonly Step[],
  out: MoveIntent[],
) {
  for (const direction of directions) {
    let to = offsetSquare(from, direction);
    while (to !== undefined) {
      const cell = cellAt(position.board, to);
      if (cell === null) {
        out.push(intent(from, to));
      } else {
        if (canLand(position, to, position.sideToMove)) out.push(intent(from, to));
        break;
      }
      to = offsetSquare(to, direction);
    }
  }
}

function isEnPassantCapture(position: Position, from: Square, to: Square): boolean {
  const mover = position.sideToMove;
  if (to !== position.enPassantTarget || cellAt(position.board, to) !== null) return false;
  if (rankIndex(from) !== (mover === "white" ? 4 : 3)) return false;
  const victim = squareAt(fileIndex(to), rankIndex(from));
  const cell = victim === undefined ? null : cellAt(position.board, victim);
  return cell !== null && cell.color !== mover && cell.kind === "pawn";
}

function pawnMoves(position: Position, from: Square, out: MoveIntent[]) {
  const mover = position.sideToMove;
  const direction = pawnDirection(mover);
  const lastRank = mover === "white" ? 7 : 0;
  const add = (to: Square): void => {
    if (rankIndex(to) !== lastRank) out.push(intent(from, to));
    else for (const piece of PROMOTION_PIECES) out.push(intent(from, to, piece));
  };
  const single = offsetSquare(from, [0, direction]);
  if (single !== undefined && cellAt(position.board, single) === null) {
    add(single);
    const double = offsetSquare(from, [0, 2 * direction]);
    const onStartRank = rankIndex(from) === (mover === "white" ? 1 : 6);
    if (onStartRank && double !== undefined && cellAt(position.board, double) === null) {
      out.push(intent(from, double));
    }
  }
  for (const file of [-1, 1]) {
    const to = offsetSquare(from, [file, direction]);
    if (to === undefined) continue;
    if (isOpponentNonKing(position, to, mover)) add(to);
    else if (isEnPassantCapture(position, from, to)) out.push(intent(from, to));
  }
}

/** Castling candidates: right present, king and rook on their squares, path empty. */
function castlingMoves(position: Position, from: Square, out: MoveIntent[]) {
  const mover = position.sideToMove;
  for (const path of CASTLING_PATHS) {
    if (path.color !== mover || path.king !== from || !position.castling[path.right]) continue;
    const rook = cellAt(position.board, path.rook);
    if (rook === null || rook.color !== mover || rook.kind !== "rook") continue;
    if (path.between.every((square) => cellAt(position.board, square) === null)) {
      out.push(intent(from, path.kingTo));
    }
  }
}

function promotionOrder(move: MoveIntent): number {
  return move.promotion === undefined ? -1 : PROMOTION_PIECES.indexOf(move.promotion);
}

/**
 * Pseudo-legal moves of the side-to-move piece on `from`, ordered by destination
 * index, then promotion q, r, b, n. The order is engineering behaviour for
 * reproducibility, not a FIDE rule.
 */
export function pseudoLegalMovesFrom(position: Position, from: Square): MoveIntent[] {
  const piece = cellAt(position.board, from);
  if (piece === null || piece.color !== position.sideToMove) return [];
  const out: MoveIntent[] = [];
  switch (piece.kind) {
    case "pawn":
      pawnMoves(position, from, out);
      break;
    case "knight":
      stepMoves(position, from, KNIGHT_STEPS, out);
      break;
    case "bishop":
      rayMoves(position, from, BISHOP_DIRECTIONS, out);
      break;
    case "rook":
      rayMoves(position, from, ROOK_DIRECTIONS, out);
      break;
    case "queen":
      rayMoves(position, from, KING_STEPS, out);
      break;
    case "king":
      stepMoves(position, from, KING_STEPS, out);
      castlingMoves(position, from, out);
      break;
  }
  return out.sort(
    (a, b) => squareIndex(a.to) - squareIndex(b.to) || promotionOrder(a) - promotionOrder(b),
  );
}

/** All pseudo-legal moves of the side to move, ordered by source square index. */
export function generatePseudoLegalMoves(position: Position): MoveIntent[] {
  return SQUARES.flatMap((from) => pseudoLegalMovesFrom(position, from));
}
