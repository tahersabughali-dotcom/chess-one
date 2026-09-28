import { isPromotionPiece, type PromotionPiece } from "./promotion.ts";
import { err, ok, type Result } from "./result.ts";
import { parseSquare, type Square } from "./square.ts";

/**
 * A structurally valid move request. It says nothing about legality:
 * only the rules library decides whether the move can be played.
 */
export interface MoveIntent {
  readonly from: Square;
  readonly to: Square;
  readonly promotion?: PromotionPiece;
}

export interface MoveIntentInput {
  readonly from: string;
  readonly to: string;
  readonly promotion?: string | undefined;
}

export type MoveIntentError =
  | "invalid_from_square"
  | "invalid_to_square"
  | "same_square"
  | "invalid_promotion_piece";

export function parseMoveIntent(input: MoveIntentInput): Result<MoveIntent, MoveIntentError> {
  const from = parseSquare(input.from);
  if (from === undefined) return err("invalid_from_square");
  const to = parseSquare(input.to);
  if (to === undefined) return err("invalid_to_square");
  if (from === to) return err("same_square");
  if (input.promotion === undefined) return ok(Object.freeze({ from, to }));
  if (!isPromotionPiece(input.promotion)) return err("invalid_promotion_piece");
  return ok(Object.freeze({ from, to, promotion: input.promotion }));
}
