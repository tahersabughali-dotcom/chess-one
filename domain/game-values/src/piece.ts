import type { Color } from "./color.ts";

export const PIECE_KINDS = ["king", "queen", "rook", "bishop", "knight", "pawn"] as const;

export type PieceKind = (typeof PIECE_KINDS)[number];

export interface Piece {
  readonly color: Color;
  readonly kind: PieceKind;
}

export function createPiece(color: Color, kind: PieceKind): Piece {
  return Object.freeze({ color, kind });
}
