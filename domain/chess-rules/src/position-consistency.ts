import {
  type Color,
  fileIndex,
  type PieceKind,
  rankIndex,
  SQUARES,
  type Square,
  squareAt,
} from "@chess-one/game-values";
import { type Position, pieceAt } from "./position.ts";

export type ConsistencyIssue =
  | "pawn_on_back_rank"
  | "kings_adjacent"
  | "castling_right_without_king"
  | "castling_right_without_rook"
  | "en_passant_wrong_rank"
  | "en_passant_without_pawn"
  | "en_passant_squares_occupied";

function holds(position: Position, square: Square, color: Color, kind: PieceKind): boolean {
  const piece = pieceAt(position, square);
  return piece !== null && piece.color === color && piece.kind === kind;
}

function kingSquare(position: Position, color: Color): Square | undefined {
  return SQUARES.find((square) => holds(position, square, color, "king"));
}

function checkPawns(position: Position, issues: ConsistencyIssue[]): void {
  const onBackRank = SQUARES.some((square) => {
    const rank = rankIndex(square);
    return (rank === 0 || rank === 7) && pieceAt(position, square)?.kind === "pawn";
  });
  if (onBackRank) issues.push("pawn_on_back_rank");
}

function checkKings(position: Position, issues: ConsistencyIssue[]): void {
  const white = kingSquare(position, "white");
  const black = kingSquare(position, "black");
  if (white === undefined || black === undefined) return;
  const fileGap = Math.abs(fileIndex(white) - fileIndex(black));
  const rankGap = Math.abs(rankIndex(white) - rankIndex(black));
  if (fileGap <= 1 && rankGap <= 1) issues.push("kings_adjacent");
}

function checkCastling(position: Position, issues: ConsistencyIssue[]): void {
  const rights: readonly [boolean, Color, Square, Square][] = [
    [position.castling.whiteKingside, "white", "e1", "h1"],
    [position.castling.whiteQueenside, "white", "e1", "a1"],
    [position.castling.blackKingside, "black", "e8", "h8"],
    [position.castling.blackQueenside, "black", "e8", "a8"],
  ];
  for (const [granted, color, king, rook] of rights) {
    if (!granted) continue;
    if (!holds(position, king, color, "king")) issues.push("castling_right_without_king");
    if (!holds(position, rook, color, "rook")) issues.push("castling_right_without_rook");
  }
}

function checkEnPassant(position: Position, issues: ConsistencyIssue[]): void {
  const target = position.enPassantTarget;
  if (target === null) return;
  const mover = position.sideToMove;
  const expectedRank = mover === "white" ? 5 : 2;
  if (rankIndex(target) !== expectedRank) {
    issues.push("en_passant_wrong_rank");
    return;
  }
  const step = mover === "white" ? -1 : 1;
  const file = fileIndex(target);
  const pawnSquare = squareAt(file, expectedRank + step);
  const originSquare = squareAt(file, expectedRank - step);
  const pusher: Color = mover === "white" ? "black" : "white";
  if (pawnSquare === undefined || !holds(position, pawnSquare, pusher, "pawn")) {
    issues.push("en_passant_without_pawn");
  }
  if (
    pieceAt(position, target) !== null ||
    (originSquare !== undefined && pieceAt(position, originSquare) !== null)
  ) {
    issues.push("en_passant_squares_occupied");
  }
}

/**
 * Basic consistency beyond FEN structure. This is not a legality or
 * reachability proof (Article 3.10.3). It does not yet detect whether the side
 * that is not to move stands in check, because attack detection belongs to the
 * move engine that later batches build.
 */
export function checkPositionConsistency(position: Position): readonly ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  checkPawns(position, issues);
  checkKings(position, issues);
  checkCastling(position, issues);
  checkEnPassant(position, issues);
  return Object.freeze(issues);
}
