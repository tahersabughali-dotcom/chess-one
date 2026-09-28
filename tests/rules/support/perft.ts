import { applyLegalMove, generateLegalMoves, type Position } from "@chess-one/chess-rules";
import type { MoveIntent } from "@chess-one/game-values";
import { uci } from "./positions.ts";

/**
 * Test-only perft over the public legal-move API: depth 0 counts 1, otherwise
 * the sum over every legal move of the child's perft. A regression oracle for
 * the move generator, not a product feature and not a legal authority.
 */

export function playLegal(position: Position, move: MoveIntent): Position {
  const next = applyLegalMove(position, move);
  if (!next.ok) throw new Error(`${uci(move)} was generated but rejected: ${next.error}`);
  return next.value;
}

export function perft(position: Position, depth: number): number {
  if (depth === 0) return 1;
  let nodes = 0;
  for (const move of generateLegalMoves(position)) {
    nodes += perft(playLegal(position, move), depth - 1);
  }
  return nodes;
}

/** Debug aid for mismatches: child node count per root move. */
export function perftDivide(position: Position, depth: number): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const move of generateLegalMoves(position)) {
    counts.set(uci(move), perft(playLegal(position, move), depth - 1));
  }
  return counts;
}
