import type { PieceKind } from "./piece.ts";

export const PROMOTION_PIECES = ["q", "r", "b", "n"] as const;

export type PromotionPiece = (typeof PROMOTION_PIECES)[number];

const PROMOTION_SET: ReadonlySet<string> = new Set(PROMOTION_PIECES);

const PROMOTION_KIND: Readonly<Record<PromotionPiece, PieceKind>> = Object.freeze({
  q: "queen",
  r: "rook",
  b: "bishop",
  n: "knight",
});

export function isPromotionPiece(value: string): value is PromotionPiece {
  return PROMOTION_SET.has(value);
}

export function promotionPieceKind(piece: PromotionPiece): PieceKind {
  return PROMOTION_KIND[piece];
}
