export const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
export const RANKS = ["1", "2", "3", "4", "5", "6", "7", "8"] as const;

export type File = (typeof FILES)[number];
export type Rank = (typeof RANKS)[number];
export type Square = `${File}${Rank}`;

function squareOf(file: File, rank: Rank): Square {
  return `${file}${rank}`;
}

/** All 64 squares, index = file + 8 * rank, so a1 = 0, h1 = 7, a8 = 56, h8 = 63. */
export const SQUARES: readonly Square[] = Object.freeze(
  RANKS.flatMap((rank) => FILES.map((file) => squareOf(file, rank))),
);

const SQUARE_SET: ReadonlySet<string> = new Set(SQUARES);

export function isSquare(value: string): value is Square {
  return SQUARE_SET.has(value);
}

export function parseSquare(value: string): Square | undefined {
  return isSquare(value) ? value : undefined;
}

export function fileIndex(square: Square): number {
  return square.charCodeAt(0) - "a".charCodeAt(0);
}

export function rankIndex(square: Square): number {
  return square.charCodeAt(1) - "1".charCodeAt(0);
}

export function squareIndex(square: Square): number {
  return fileIndex(square) + 8 * rankIndex(square);
}

export function squareAt(file: number, rank: number): Square | undefined {
  if (!Number.isInteger(file) || !Number.isInteger(rank)) return undefined;
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return undefined;
  return SQUARES[file + 8 * rank];
}
