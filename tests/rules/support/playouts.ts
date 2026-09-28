import { generateLegalMoves, type Position } from "@chess-one/chess-rules";
import fc from "fast-check";
import { playLegal } from "./perft.ts";
import { positionOf } from "./positions.ts";

/** A bounded playout: each choice picks a legal move by index until moves run out. */
export function playoutArbitrary(starts: readonly string[], maxPlies: number) {
  return fc.record({
    start: fc.constantFrom(...starts),
    choices: fc.array(fc.nat(), { maxLength: maxPlies }),
  });
}

/** The start position and every position reached along the playout. */
export function playoutPositions(start: string, choices: readonly number[]): Position[] {
  const visited = [positionOf(start)];
  for (const choice of choices) {
    const current = visited[visited.length - 1];
    if (current === undefined) break;
    const moves = generateLegalMoves(current);
    const move = moves[choice % Math.max(moves.length, 1)];
    if (move === undefined) break;
    visited.push(playLegal(current, move));
  }
  return visited;
}
