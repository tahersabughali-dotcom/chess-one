import {
  applyLegalMove,
  formatFen,
  generateLegalMoves,
  type LegalMoveError,
  type Position,
  parseFen,
} from "@chess-one/chess-rules";
import { type MoveIntent, parseMoveIntent, type Result } from "@chess-one/game-values";

export function positionOf(fen: string): Position {
  const parsed = parseFen(fen);
  if (!parsed.ok) throw new Error(`${fen}: ${parsed.error.message}`);
  return parsed.value;
}

/** Parses "e2e4" or "a7a8q" into a MoveIntent. */
export function intentOf(uci: string): MoveIntent {
  const promotion = uci.length === 5 ? uci.slice(4) : undefined;
  const intent = parseMoveIntent({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion });
  if (!intent.ok || uci.length < 4 || uci.length > 5) throw new Error(`${uci}: malformed`);
  return intent.value;
}

export function attempt(position: Position, uci: string): Result<Position, LegalMoveError> {
  return applyLegalMove(position, intentOf(uci));
}

/** "accepted", or the rejection reason. */
export function errorOf(fen: string, uci: string): string {
  const next = attempt(positionOf(fen), uci);
  return next.ok ? "accepted" : next.error;
}

export function fenAfter(fen: string, uci: string): string {
  return formatFen(play(positionOf(fen), uci));
}

export function uci(move: MoveIntent): string {
  return `${move.from}${move.to}${move.promotion ?? ""}`;
}

export function legalUci(position: Position): string[] {
  return generateLegalMoves(position).map(uci);
}

/** Plays each move in order; throws if any is rejected. */
export function play(position: Position, ...moves: readonly string[]): Position {
  let current = position;
  for (const uci of moves) {
    const next = attempt(current, uci);
    if (!next.ok) throw new Error(`${uci}: ${next.error}`);
    current = next.value;
  }
  return current;
}
