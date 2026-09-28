import type { Piece, PieceKind, Square } from "@chess-one/game-values";
import { generateLegalMoves } from "./legal-moves.ts";
import { enPassantVictim } from "./move-generation.ts";
import type { CastlingRights, Position } from "./position.ts";

/**
 * Article 9.2.3 position identity for repetition: the same side to move, the
 * same piece kind and colour on every square, the same castling rights, and the
 * same en passant possibility. The halfmove clock and fullmove number are not
 * part of it, and neither is SAN or a hash.
 *
 * The key is unambiguous, space-delimited canonical text, so it is
 * collision-free by construction: 64 board characters from a1 to h8 (`PNBRQK`
 * white, `pnbrqk` black, `.` empty), the side to move (`w` or `b`), four
 * castling characters in the order `KQkq` with `-` for a missing right, and
 * the effective en passant square (two characters) or `-`.
 *
 * Castling rights come from the canonical position, which legal transitions
 * only ever clear. En passant counts only when an actual legal en passant
 * capture is available to the side to move; any other raw target does not.
 */

const LETTERS: Readonly<Record<PieceKind, string>> = Object.freeze({
  king: "k",
  queen: "q",
  rook: "r",
  bishop: "b",
  knight: "n",
  pawn: "p",
});

const CASTLING_LETTERS: readonly (readonly [keyof CastlingRights, string])[] = [
  ["whiteKingside", "K"],
  ["whiteQueenside", "Q"],
  ["blackKingside", "k"],
  ["blackQueenside", "q"],
];

function cellLetter(cell: Piece | null): string {
  if (cell === null) return ".";
  const letter = LETTERS[cell.kind];
  return cell.color === "white" ? letter.toUpperCase() : letter;
}

/**
 * Article 9.2.3: the target counts only if an actual legal en passant capture
 * is available. A normal capture onto an occupied target square is not one.
 */
function effectiveEnPassant(position: Position): Square | null {
  const target = position.enPassantTarget;
  if (target === null) return null;
  const available = generateLegalMoves(position).some(
    (move) => move.to === target && enPassantVictim(position, move) !== undefined,
  );
  return available ? target : null;
}

function identityText(position: Position): string {
  const board = position.board.map(cellLetter).join("");
  const side = position.sideToMove === "white" ? "w" : "b";
  const castling = CASTLING_LETTERS.map(([right, letter]) =>
    position.castling[right] ? letter : "-",
  ).join("");
  return `${board} ${side} ${castling} ${effectiveEnPassant(position) ?? "-"}`;
}

/**
 * Opaque repetition identity. The only way to obtain one is `repetitionKey`,
 * so a history of keys can only be built from canonical positions, never from
 * client strings.
 */
class RepetitionKey {
  readonly #text: string;

  private constructor(text: string) {
    this.#text = text;
    Object.freeze(this);
  }

  static of(position: Position): RepetitionKey {
    return new RepetitionKey(identityText(position));
  }

  /** The inspectable identity text described above. */
  get text(): string {
    return this.#text;
  }

  equals(other: RepetitionKey): boolean {
    return this.#text === other.#text;
  }
}

export type { RepetitionKey };

export function repetitionKey(position: Position): RepetitionKey {
  return RepetitionKey.of(position);
}

export function samePositionForRepetition(a: Position, b: Position): boolean {
  return repetitionKey(a).equals(repetitionKey(b));
}

/**
 * Occurrences of `position`'s identity in `history`; they need not be
 * consecutive. History convention: every committed position in order, starting
 * with the initial position and including the current one, one entry per
 * accepted move. The rules package evaluates the history it is given; the Live
 * Game authority owns that history and its trust boundary, and a client never
 * supplies it.
 */
export function repetitionCount(history: readonly RepetitionKey[], position: Position): number {
  const key = repetitionKey(position);
  return history.filter((entry) => entry.equals(key)).length;
}

/** The history error shared by the draw rules: the last entry must be the current position. */
export type RuleHistoryError = "history_not_current";

export function isCurrentHistory(history: readonly RepetitionKey[], position: Position): boolean {
  return history.at(-1)?.equals(repetitionKey(position)) === true;
}
