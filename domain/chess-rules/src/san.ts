import {
  fileIndex,
  type MoveIntent,
  ok,
  type Piece,
  type PieceKind,
  type Result,
  rankIndex,
  SQUARES,
} from "@chess-one/game-values";
import { cellAt, isInCheck } from "./attacks.ts";
import { type LegalMoveError, legalMovesFrom, resolveLegalMove } from "./legal-moves.ts";
import { castlingPathOf, isCaptureMove } from "./move-generation.ts";
import { applyPseudoLegalMove } from "./move-transition.ts";
import type { Position } from "./position.ts";
import { evaluateMoveExhaustion } from "./terminal.ts";

/**
 * Chess One canonical SAN: one stable serialization derived from FIDE Appendix C
 * algebraic notation. The choices below are an engineering contract, not the
 * only notation FIDE allows: English letters K Q R B N, `x` on every capture,
 * `O-O` / `O-O-O` with capital O, `=Q` promotion, no `e.p.` suffix, `+` for
 * check and `#` for checkmate. SAN is output only and never decides a move.
 */

const PIECE_LETTERS: Readonly<Record<Exclude<PieceKind, "pawn">, string>> = Object.freeze({
  king: "K",
  queen: "Q",
  rook: "R",
  bishop: "B",
  knight: "N",
});

function movingPiece(position: Position, move: MoveIntent): Piece {
  const piece = cellAt(position.board, move.from);
  if (piece === null) throw new Error(`SAN defect: ${move.from} is empty.`);
  return piece;
}

/**
 * Source file, else source rank, else both, chosen against the other pieces of
 * the same kind and colour that can legally reach the same square. Pinned
 * pieces that cannot legally move there are not rivals.
 */
function disambiguation(position: Position, move: MoveIntent, piece: Piece): string {
  const rivals = SQUARES.filter((from) => {
    if (from === move.from) return false;
    const cell = cellAt(position.board, from);
    if (cell?.kind !== piece.kind || cell.color !== piece.color) return false;
    return legalMovesFrom(position, from).some((rival) => rival.to === move.to);
  });
  if (rivals.length === 0) return "";
  if (rivals.every((from) => fileIndex(from) !== fileIndex(move.from))) return move.from.charAt(0);
  if (rivals.every((from) => rankIndex(from) !== rankIndex(move.from))) return move.from.charAt(1);
  return move.from;
}

function moveText(position: Position, move: MoveIntent): string {
  const castling = castlingPathOf(position, move);
  if (castling !== undefined) return fileIndex(castling.kingTo) === 6 ? "O-O" : "O-O-O";
  const piece = movingPiece(position, move);
  const capture = isCaptureMove(position, move) ? "x" : "";
  if (piece.kind === "pawn") {
    const source = capture === "" ? "" : move.from.charAt(0);
    const promotion = move.promotion === undefined ? "" : `=${move.promotion.toUpperCase()}`;
    return `${source}${capture}${move.to}${promotion}`;
  }
  return `${PIECE_LETTERS[piece.kind]}${disambiguation(position, move, piece)}${capture}${move.to}`;
}

function checkSuffix(next: Position): "" | "+" | "#" {
  if (!isInCheck(next, next.sideToMove)) return "";
  return evaluateMoveExhaustion(next)?.kind === "checkmate" ? "#" : "+";
}

/**
 * The canonical SAN of a legal move. The move is resolved through the same
 * legal-move authority as `applyLegalMove`, so an illegal intent returns the
 * same `LegalMoveError` and never receives SAN.
 */
export function toCanonicalSan(
  position: Position,
  intent: MoveIntent,
): Result<string, LegalMoveError> {
  const resolved = resolveLegalMove(position, intent);
  if (!resolved.ok) return resolved;
  const move = resolved.value;
  return ok(`${moveText(position, move)}${checkSuffix(applyPseudoLegalMove(position, move))}`);
}
