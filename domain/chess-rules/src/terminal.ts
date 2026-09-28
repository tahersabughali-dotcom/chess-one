import { type Color, oppositeColor } from "@chess-one/game-values";
import { isInCheck } from "./attacks.ts";
import { generateLegalMoves } from "./legal-moves.ts";
import type { Position } from "./position.ts";

/**
 * A pure chess-rule fact about a position whose side to move has no legal move
 * (Articles 5.1.1 and 5.2.1). It is not a durable GameResult or a game event;
 * those belong to later layers.
 */
export type MoveExhaustionFact =
  | { readonly kind: "checkmate"; readonly winner: Color; readonly loser: Color }
  | { readonly kind: "stalemate" };

/**
 * `null` while the side to move has a legal move. Otherwise checkmate when that
 * side is in check, stalemate when it is not. Dead positions are assessed
 * separately by `assessMatingPossibility`.
 */
export function evaluateMoveExhaustion(position: Position): MoveExhaustionFact | null {
  if (generateLegalMoves(position).length > 0) return null;
  const loser = position.sideToMove;
  if (!isInCheck(position, loser)) return Object.freeze({ kind: "stalemate" });
  return Object.freeze({ kind: "checkmate", winner: oppositeColor(loser), loser });
}
