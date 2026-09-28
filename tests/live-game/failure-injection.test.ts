import { parseGameSequence } from "@chess-one/game-values";
import { type ActiveGameState, processCommand, processDeadline } from "@chess-one/live-game";
import { describe, expect, it } from "vitest";
import {
  actorFor,
  at,
  claimCommand,
  moveCommand,
  ms,
  newGame,
  playMoves,
  START_MS,
  snapshot,
} from "./support/harness.ts";

/**
 * Internal defects throw instead of returning a domain code. Because a decision
 * is computed from frozen values and returned whole, a throw can never leave a
 * partially applied state behind: the caller keeps its input unchanged.
 */
function expectDefectLeavesInput(
  state: ActiveGameState,
  run: () => unknown,
  message: RegExp,
): void {
  const before = snapshot(state);
  expect(run).toThrow(message);
  expect(snapshot(state)).toEqual(before);
  expect(Object.isFrozen(state)).toBe(true);
}

describe("TST-LIVE failure injection", () => {
  it("TST-LIVE-090 a history that does not end at the position is a defect, and the input is unchanged", () => {
    const played = playMoves(newGame(), ["g1f3", "g8f6"]).state;
    const corrupted: ActiveGameState = Object.freeze({ ...played, history: Object.freeze([]) });
    const actor = actorFor(corrupted, "white");
    expectDefectLeavesInput(
      corrupted,
      () =>
        processCommand(
          corrupted,
          actor,
          claimCommand(corrupted, "threefold_current"),
          at(START_MS + 100),
        ),
      /Live game defect/,
    );
    expectDefectLeavesInput(
      corrupted,
      () => processCommand(corrupted, actor, moveCommand(corrupted, "f3g1"), at(START_MS + 100)),
      /Live game defect/,
    );
    expect(snapshot(played)).toEqual(snapshot(playMoves(newGame(), ["g1f3", "g8f6"]).state));
  });

  it("TST-LIVE-091 a receipt earlier than the clock anchor is an ingress-order defect", () => {
    const played = playMoves(newGame(), ["e2e4"], START_MS + 500).state;
    const actor = actorFor(played, "black");
    expectDefectLeavesInput(
      played,
      () => processCommand(played, actor, moveCommand(played, "e7e5"), at(START_MS + 1)),
      /Clock defect/,
    );
    expectDefectLeavesInput(played, () => processDeadline(played, ms(START_MS)), /Clock defect/);
  });

  it("TST-LIVE-092 sequence overflow is a defect, and the input is unchanged", () => {
    const game = newGame();
    const last = parseGameSequence(Number.MAX_SAFE_INTEGER);
    if (last === undefined) throw new Error("MAX_SAFE_INTEGER is not a sequence");
    const exhausted: ActiveGameState = Object.freeze({ ...game, sequence: last });
    const command = moveCommand(exhausted, "e2e4");
    expectDefectLeavesInput(
      exhausted,
      () => processCommand(exhausted, actorFor(exhausted, "white"), command, at(START_MS + 1)),
      /sequence overflow/,
    );
  });
});
