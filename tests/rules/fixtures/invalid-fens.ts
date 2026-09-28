import type { FenErrorCode } from "@chess-one/chess-rules";

export interface InvalidFen {
  readonly name: string;
  readonly fen: string;
  readonly code: FenErrorCode;
}

export const INVALID_FENS: readonly InvalidFen[] = [
  {
    name: "missing black king (the retired 008a FEN)",
    fen: "5r2/8/8/8/8/8/8/R3K2R w KQ - 0 1",
    code: "king_count",
  },
  { name: "missing white king", fen: "4k3/8/8/8/8/8/8/8 w - - 0 1", code: "king_count" },
  { name: "extra white king", fen: "4k3/8/8/8/8/8/8/3KK3 w - - 0 1", code: "king_count" },
  { name: "extra black king", fen: "3kk3/8/8/8/8/8/8/4K3 w - - 0 1", code: "king_count" },
  { name: "seven ranks", fen: "4k3/8/8/8/8/8/4K3 w - - 0 1", code: "rank_count" },
  { name: "nine ranks", fen: "4k3/8/8/8/8/8/8/8/4K3 w - - 0 1", code: "rank_count" },
  { name: "rank too short", fen: "4k3/8/8/8/8/8/8/4K2 w - - 0 1", code: "rank_width" },
  { name: "rank too long", fen: "4k3/8/8/8/8/8/8/4K4 w - - 0 1", code: "rank_width" },
  { name: "empty rank", fen: "4k3//8/8/8/8/8/4K3 w - - 0 1", code: "rank_width" },
  { name: "digit nine", fen: "4k3/9/8/8/8/8/8/4K3 w - - 0 1", code: "unknown_symbol" },
  { name: "digit zero", fen: "4k3/08/8/8/8/8/8/4K3 w - - 0 1", code: "unknown_symbol" },
  { name: "adjacent digits", fen: "4k3/44/8/8/8/8/8/4K3 w - - 0 1", code: "rank_syntax" },
  { name: "unknown piece letter", fen: "4k3/8/8/8/8/8/8/4K2X w - - 0 1", code: "unknown_symbol" },
  { name: "side to move x", fen: "4k3/8/8/8/8/8/8/4K3 x - - 0 1", code: "side_to_move" },
  { name: "side to move uppercase", fen: "4k3/8/8/8/8/8/8/4K3 W - - 0 1", code: "side_to_move" },
  {
    name: "castling out of order",
    fen: "r3k2r/8/8/8/8/8/8/R3K2R w QK - 0 1",
    code: "castling_syntax",
  },
  {
    name: "castling duplicate",
    fen: "r3k2r/8/8/8/8/8/8/R3K2R w KK - 0 1",
    code: "castling_syntax",
  },
  {
    name: "castling unknown letter",
    fen: "r3k2r/8/8/8/8/8/8/R3K2R w KX - 0 1",
    code: "castling_syntax",
  },
  {
    name: "castling dash mixed",
    fen: "r3k2r/8/8/8/8/8/8/R3K2R w K- - 0 1",
    code: "castling_syntax",
  },
  {
    name: "en passant rank 4",
    fen: "4k3/8/8/8/3pP3/8/8/4K3 w - d4 0 1",
    code: "en_passant_syntax",
  },
  {
    name: "en passant off board",
    fen: "4k3/8/8/8/8/8/8/4K3 w - i6 0 1",
    code: "en_passant_syntax",
  },
  {
    name: "en passant uppercase",
    fen: "4k3/8/8/8/8/8/8/4K3 w - D6 0 1",
    code: "en_passant_syntax",
  },
  { name: "negative halfmove", fen: "4k3/8/8/8/8/8/8/4K3 w - - -1 1", code: "halfmove_clock" },
  { name: "halfmove leading zero", fen: "4k3/8/8/8/8/8/8/4K3 w - - 01 1", code: "halfmove_clock" },
  { name: "fullmove zero", fen: "4k3/8/8/8/8/8/8/4K3 w - - 0 0", code: "fullmove_number" },
  { name: "fullmove not a number", fen: "4k3/8/8/8/8/8/8/4K3 w - - 0 x", code: "fullmove_number" },
  { name: "five fields", fen: "4k3/8/8/8/8/8/8/4K3 w - - 0", code: "field_count" },
  { name: "trailing space", fen: "4k3/8/8/8/8/8/8/4K3 w - - 0 1 ", code: "field_count" },
  { name: "double space", fen: "4k3/8/8/8/8/8/8/4K3  w - - 0 1", code: "field_count" },
  { name: "empty string", fen: "", code: "field_count" },
  {
    name: "oversized input",
    fen: `${"4k3/8/8/8/8/8/8/4K3 w - - 0 1"}${" ".repeat(300)}`,
    code: "input_length",
  },
];
