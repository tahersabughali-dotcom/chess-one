import {
  type Color,
  fileIndex,
  oppositeColor,
  type PieceKind,
  rankIndex,
  SQUARES,
  type Square,
  squareAt,
} from "@chess-one/game-values";
import { findKing, isInCheck } from "./attacks.ts";
import { type Position, pieceAt } from "./position.ts";

export type ConsistencyIssue =
  | "pawn_on_back_rank"
  | "kings_adjacent"
  | "non_moving_side_in_check"
  | "castling_right_without_king"
  | "castling_right_without_rook"
  | "en_passant_wrong_rank"
  | "en_passant_without_pawn"
  | "en_passant_squares_occupied";

function holds(position: Position, square: Square, color: Color, kind: PieceKind): boolean {
  const piece = pieceAt(position, square);
  return piece !== null && piece.color === color && piece.kind === kind;
}

function checkPawns(position: Position, issues: ConsistencyIssue[]): void {
  const onBackRank = SQUARES.some((square) => {
    const rank = rankIndex(square);
    return (rank === 0 || rank === 7) && pieceAt(position, square)?.kind === "pawn";
  });
  if (onBackRank) issues.push("pawn_on_back_rank");
}

function checkKings(position: Position, issues: ConsistencyIssue[]): void {
  const white = findKing(position, "white");
  const black = findKing(position, "black");
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
 * Basic consistency beyond FEN structure. This is a partial check, not a
 * legality or reachability proof (Article 3.10.3). The side to move may be in
 * check; the side that just moved may not (Article 3.9).
 */
export function checkPositionConsistency(position: Position): readonly ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  checkPawns(position, issues);
  checkKings(position, issues);
  if (isInCheck(position, oppositeColor(position.sideToMove))) {
    issues.push("non_moving_side_in_check");
  }
  checkCastling(position, issues);
  checkEnPassant(position, issues);
  return Object.freeze(issues);
}
