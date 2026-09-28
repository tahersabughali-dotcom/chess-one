import {
  applyLegalMove,
  generateLegalMoves,
  isInCheck,
  type Position,
  pieceAt,
  type RepetitionKey,
  repetitionCount,
  repetitionKey,
} from "@chess-one/chess-rules";
import { play } from "./positions.ts";

/**
 * Test-only authoritative rule history built through the public legal-move API.
 * Convention: `keys[0]` is the start position, and each accepted move appends
 * exactly one key, so the last key is the current position.
 */
export interface RuleHistory {
  readonly positions: readonly Position[];
  readonly keys: readonly RepetitionKey[];
  readonly current: Position;
}

function historyOf(positions: readonly Position[]): RuleHistory {
  const current = positions.at(-1);
  if (current === undefined) throw new Error("empty history");
  return Object.freeze({
    positions: Object.freeze([...positions]),
    keys: Object.freeze(positions.map(repetitionKey)),
    current,
  });
}

export function ruleHistory(start: Position, plies: readonly string[]): RuleHistory {
  const positions = [start];
  for (const uci of plies) positions.push(play(positions[positions.length - 1] ?? start, uci));
  return historyOf(positions);
}

/** The history truncated to its first `length` positions. */
export function prefix(history: RuleHistory, length: number): RuleHistory {
  return historyOf(history.positions.slice(0, length));
}

/**
 * A deterministic walk of `plies` legal quiet moves (no pawn move, no capture,
 * no check), preferring the move whose resulting position has occurred least often.
 */
export function quietWalk(start: Position, plies: number): RuleHistory {
  const positions = [start];
  let keys = [repetitionKey(start)];
  for (let ply = 0; ply < plies; ply += 1) {
    const current = positions[positions.length - 1] ?? start;
    const quiet = generateLegalMoves(current).filter(
      (move) => pieceAt(current, move.from)?.kind !== "pawn" && pieceAt(current, move.to) === null,
    );
    let best: Position | undefined;
    let bestCount = Number.POSITIVE_INFINITY;
    for (const move of quiet) {
      const next = applyLegalMove(current, move);
      if (!next.ok) throw new Error("generated move rejected");
      if (isInCheck(next.value, next.value.sideToMove)) continue;
      const count = repetitionCount(keys, next.value);
      if (count < bestCount) [best, bestCount] = [next.value, count];
    }
    if (best === undefined) throw new Error(`no quiet move at ply ${ply}`);
    positions.push(best);
    keys = [...keys, repetitionKey(best)];
  }
  return historyOf(positions);
}
