import { err, ok, type Result } from "./result.ts";

declare const gameSequenceBrand: unique symbol;

/** Server-owned game sequence. A non-negative safe integer. */
export type GameSequence = number & { readonly [gameSequenceBrand]: true };

export function isGameSequence(value: number): value is GameSequence {
  return Number.isSafeInteger(value) && value >= 0;
}

export function parseGameSequence(value: number): GameSequence | undefined {
  return isGameSequence(value) ? value : undefined;
}

export function nextGameSequence(current: GameSequence): Result<GameSequence, "sequence_overflow"> {
  const next = current + 1;
  return isGameSequence(next) ? ok(next) : err("sequence_overflow");
}
