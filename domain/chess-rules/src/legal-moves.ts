import {
  err,
  isSquare,
  type MoveIntent,
  ok,
  oppositeColor,
  type Result,
  type Square,
} from "@chess-one/game-values";
import { cellAt, findKingOnBoard, isAttackedOnBoard } from "./attacks.ts";
import {
  castlingPathOf,
  generatePseudoLegalMoves,
  pseudoLegalMovesFrom,
} from "./move-generation.ts";
import { applyPseudoLegalMove, boardAfterMove } from "./move-transition.ts";
import type { Position } from "./position.ts";

/**
 * Pure-domain rejection reasons. Mapping to contract errors such as
 * IllegalMove or InvalidState belongs to a later layer.
 */
export type LegalMoveError = "illegal_move" | "promotion_required" | "promotion_unexpected";

/**
 * Article 3.9: a pseudo-legal move is legal when, after it is played, the
 * mover's king is not attacked. This one test covers pins, discovered attacks,
 * blocking or capturing a checker, king moves, en passant exposure, and double
 * check. Castling also requires the king's square, the crossed square, and the
 * destination to be unattacked (Article 3.8.2.2); the rook's squares and b1/b8
 * do not matter.
 */
function isLegalCandidate(position: Position, move: MoveIntent, kingSquare: Square): boolean {
  const opponent = oppositeColor(position.sideToMove);
  const castling = castlingPathOf(position, move);
  if (
    castling !== undefined &&
    [castling.king, castling.crossed, castling.kingTo].some((square) =>
      isAttackedOnBoard(position.board, square, opponent),
    )
  ) {
    return false;
  }
  const king = cellAt(position.board, move.from)?.kind === "king" ? move.to : kingSquare;
  return !isAttackedOnBoard(boardAfterMove(position, move), king, opponent);
}

/**
 * Every legal move of the side to move, frozen, in pseudo-legal order: source
 * square index, then destination index, then promotion q, r, b, n. The order is
 * engineering behaviour for reproducibility, not a FIDE rule.
 */
export function generateLegalMoves(position: Position): readonly MoveIntent[] {
  const king = findKingOnBoard(position.board, position.sideToMove);
  return Object.freeze(
    generatePseudoLegalMoves(position).filter((move) => isLegalCandidate(position, move, king)),
  );
}

/**
 * Applies `intent` when it is legal. Only the candidates of the source square
 * are examined, through the same legality test as `generateLegalMoves`.
 * Precedence: an exact legal match is applied; a missing promotion on a legal
 * promotion is `promotion_required`; a promotion on a legal ordinary move is
 * `promotion_unexpected`; anything else is `illegal_move`.
 */
export function applyLegalMove(
  position: Position,
  intent: MoveIntent,
): Result<Position, LegalMoveError> {
  if (!isSquare(intent.from) || !isSquare(intent.to)) return err("illegal_move");
  const king = findKingOnBoard(position.board, position.sideToMove);
  const legal = pseudoLegalMovesFrom(position, intent.from).filter(
    (move) => move.to === intent.to && isLegalCandidate(position, move, king),
  );
  const exact = legal.find((move) => move.promotion === intent.promotion);
  if (exact !== undefined) return ok(applyPseudoLegalMove(position, exact));
  if (intent.promotion === undefined && legal.some((move) => move.promotion !== undefined)) {
    return err("promotion_required");
  }
  if (intent.promotion !== undefined && legal.some((move) => move.promotion === undefined)) {
    return err("promotion_unexpected");
  }
  return err("illegal_move");
}
