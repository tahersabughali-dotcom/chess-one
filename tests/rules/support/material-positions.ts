import { checkPositionConsistency, createPosition, type Position } from "@chess-one/chess-rules";
import { type Color, createPiece, oppositeColor, type PieceKind } from "@chess-one/game-values";
import fc from "fast-check";

const NO_CASTLING = {
  whiteKingside: false,
  whiteQueenside: false,
  blackKingside: false,
  blackQueenside: false,
};

/**
 * A legal position with `mating`'s king plus `matingKinds` against the other
 * king plus `otherKinds`, placed on `squares` in that order, or null when the
 * placement is not a consistent position.
 */
export function materialPosition(
  squares: readonly number[],
  mating: Color,
  matingKinds: readonly PieceKind[],
  otherKinds: readonly PieceKind[],
  sideToMove: Color,
): Position | null {
  const kinds: [Color, PieceKind][] = [
    [mating, "king"],
    [oppositeColor(mating), "king"],
    ...matingKinds.map((kind): [Color, PieceKind] => [mating, kind]),
    ...otherKinds.map((kind): [Color, PieceKind] => [oppositeColor(mating), kind]),
  ];
  const board = new Array<ReturnType<typeof createPiece> | null>(64).fill(null);
  for (const [index, [color, kind]] of kinds.entries()) {
    const square = squares[index];
    if (square === undefined) return null;
    board[square] = createPiece(color, kind);
  }
  const created = createPosition({
    board,
    sideToMove,
    castling: NO_CASTLING,
    enPassantTarget: null,
    halfmoveClock: 0,
    fullmoveNumber: 1,
  });
  if (!created.ok || checkPositionConsistency(created.value).length > 0) return null;
  return created.value;
}

export const anyColor = fc.constantFrom<Color>("white", "black");

export const distinctSquares = (count: number) =>
  fc.uniqueArray(fc.nat({ max: 63 }), { minLength: count, maxLength: count });
