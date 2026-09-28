import {
  type Color,
  createPiece,
  err,
  ok,
  type Piece,
  type PieceKind,
  parseSquare,
  type Result,
  type Square,
} from "@chess-one/game-values";
import { type Board, type CastlingRights, freezePosition, type Position } from "./position.ts";

export type FenErrorCode =
  | "input_length"
  | "field_count"
  | "rank_count"
  | "unknown_symbol"
  | "rank_syntax"
  | "rank_width"
  | "king_count"
  | "side_to_move"
  | "castling_syntax"
  | "en_passant_syntax"
  | "halfmove_clock"
  | "fullmove_number";

export interface FenError {
  readonly code: FenErrorCode;
  readonly message: string;
}

const SYMBOL_TO_KIND: ReadonlyMap<string, PieceKind> = new Map<string, PieceKind>([
  ["k", "king"],
  ["q", "queen"],
  ["r", "rook"],
  ["b", "bishop"],
  ["n", "knight"],
  ["p", "pawn"],
]);

const KIND_TO_SYMBOL: Readonly<Record<PieceKind, string>> = Object.freeze({
  king: "k",
  queen: "q",
  rook: "r",
  bishop: "b",
  knight: "n",
  pawn: "p",
});

/** Far above any real FEN (about 90 characters); bounds work on untrusted input. */
const MAX_FEN_LENGTH = 256;

const CASTLING_SYNTAX = /^(?:-|K?Q?k?q?)$/;
const EN_PASSANT_SYNTAX = /^(?:-|[a-h][36])$/;
const COUNTER_SYNTAX = /^(?:0|[1-9][0-9]*)$/;

function fenError(code: FenErrorCode, message: string): Result<never, FenError> {
  return err({ code, message });
}

function parseSymbol(symbol: string): Piece | undefined {
  const kind = SYMBOL_TO_KIND.get(symbol.toLowerCase());
  if (kind === undefined) return undefined;
  return createPiece(symbol === symbol.toUpperCase() ? "white" : "black", kind);
}

function parseRank(text: string, rankNumber: number): Result<(Piece | null)[], FenError> {
  const cells: (Piece | null)[] = [];
  let previousWasDigit = false;
  for (const symbol of text) {
    if (symbol >= "1" && symbol <= "8") {
      if (previousWasDigit) {
        return fenError("rank_syntax", `Rank ${rankNumber} has adjacent empty-square digits.`);
      }
      for (let i = 0; i < Number(symbol); i += 1) cells.push(null);
      previousWasDigit = true;
      continue;
    }
    const piece = parseSymbol(symbol);
    if (piece === undefined) {
      return fenError("unknown_symbol", `Rank ${rankNumber} has unknown symbol "${symbol}".`);
    }
    cells.push(piece);
    previousWasDigit = false;
  }
  if (cells.length !== 8) {
    return fenError("rank_width", `Rank ${rankNumber} covers ${cells.length} files instead of 8.`);
  }
  return ok(cells);
}

function parsePlacement(text: string): Result<Board, FenError> {
  const ranks = text.split("/");
  if (ranks.length !== 8) {
    return fenError("rank_count", `Placement has ${ranks.length} ranks instead of 8.`);
  }
  const board: (Piece | null)[] = new Array<Piece | null>(64).fill(null);
  for (const [offset, rankText] of ranks.entries()) {
    const rankNumber = 8 - offset;
    const parsed = parseRank(rankText, rankNumber);
    if (!parsed.ok) return parsed;
    for (const [file, cell] of parsed.value.entries()) {
      board[file + 8 * (rankNumber - 1)] = cell;
    }
  }
  for (const color of ["white", "black"] as const) {
    const kings = board.filter((cell) => cell?.kind === "king" && cell.color === color).length;
    if (kings !== 1) {
      return fenError("king_count", `Placement has ${kings} ${color} kings instead of 1.`);
    }
  }
  return ok(board);
}

function parseSide(text: string): Color | undefined {
  if (text === "w") return "white";
  if (text === "b") return "black";
  return undefined;
}

function parseCastling(text: string): CastlingRights | undefined {
  if (text === "" || !CASTLING_SYNTAX.test(text)) return undefined;
  return {
    whiteKingside: text.includes("K"),
    whiteQueenside: text.includes("Q"),
    blackKingside: text.includes("k"),
    blackQueenside: text.includes("q"),
  };
}

function parseEnPassant(text: string): { readonly target: Square | null } | undefined {
  if (!EN_PASSANT_SYNTAX.test(text)) return undefined;
  if (text === "-") return { target: null };
  const target = parseSquare(text);
  return target === undefined ? undefined : { target };
}

function parseCounter(text: string, minimum: number): number | undefined {
  if (!COUNTER_SYNTAX.test(text)) return undefined;
  const value = Number(text);
  return Number.isSafeInteger(value) && value >= minimum ? value : undefined;
}

/**
 * Structural FEN parsing only. A successful parse does not mean the position is
 * legal or reachable (Article 3.10.3); see `checkPositionConsistency` for the
 * separate basic consistency checks.
 */
export function parseFen(text: string): Result<Position, FenError> {
  if (text.length > MAX_FEN_LENGTH) {
    return fenError("input_length", `FEN is longer than ${MAX_FEN_LENGTH} characters.`);
  }
  const fields = text.split(" ");
  if (fields.length !== 6) {
    return fenError("field_count", `FEN has ${fields.length} space-separated fields instead of 6.`);
  }
  const [placementText = "", sideText = "", castlingText = "", epText = "", half = "", full = ""] =
    fields;

  const board = parsePlacement(placementText);
  if (!board.ok) return board;

  const sideToMove = parseSide(sideText);
  if (sideToMove === undefined) {
    return fenError("side_to_move", `Side to move "${sideText}" is not "w" or "b".`);
  }

  const castling = parseCastling(castlingText);
  if (castling === undefined) {
    return fenError("castling_syntax", `Castling field "${castlingText}" is malformed.`);
  }

  const enPassant = parseEnPassant(epText);
  if (enPassant === undefined) {
    return fenError("en_passant_syntax", `En passant field "${epText}" is malformed.`);
  }

  const halfmoveClock = parseCounter(half, 0);
  if (halfmoveClock === undefined) {
    return fenError("halfmove_clock", `Halfmove clock "${half}" is not a non-negative integer.`);
  }

  const fullmoveNumber = parseCounter(full, 1);
  if (fullmoveNumber === undefined) {
    return fenError("fullmove_number", `Fullmove number "${full}" is not a positive integer.`);
  }

  return ok(
    freezePosition({
      board: board.value,
      sideToMove,
      castling,
      enPassantTarget: enPassant.target,
      halfmoveClock,
      fullmoveNumber,
    }),
  );
}

function formatSymbol(piece: Piece): string {
  const symbol = KIND_TO_SYMBOL[piece.kind];
  return piece.color === "white" ? symbol.toUpperCase() : symbol;
}

function formatPlacement(board: Board): string {
  const ranks: string[] = [];
  for (let rank = 7; rank >= 0; rank -= 1) {
    let text = "";
    let empty = 0;
    for (let file = 0; file < 8; file += 1) {
      const cell = board[file + 8 * rank] ?? null;
      if (cell === null) {
        empty += 1;
        continue;
      }
      if (empty > 0) text += String(empty);
      empty = 0;
      text += formatSymbol(cell);
    }
    if (empty > 0) text += String(empty);
    ranks.push(text);
  }
  return ranks.join("/");
}

function formatCastling(castling: CastlingRights): string {
  const text =
    (castling.whiteKingside ? "K" : "") +
    (castling.whiteQueenside ? "Q" : "") +
    (castling.blackKingside ? "k" : "") +
    (castling.blackQueenside ? "q" : "");
  return text === "" ? "-" : text;
}

export function formatFen(position: Position): string {
  return [
    formatPlacement(position.board),
    position.sideToMove === "white" ? "w" : "b",
    formatCastling(position.castling),
    position.enPassantTarget ?? "-",
    String(position.halfmoveClock),
    String(position.fullmoveNumber),
  ].join(" ");
}
