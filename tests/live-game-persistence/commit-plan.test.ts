import { type GameSequence, isGameSequence } from "@chess-one/game-values";
import { type ActiveGameState, planCommit, processDeadline } from "@chess-one/live-game";
import { describe, expect, it } from "vitest";
import {
  moveCommand,
  ms,
  newGame,
  OTHER_GAME_ID,
  playMoves,
  START_MS,
  STRANGER,
  submit,
} from "../live-game/support/harness.ts";
import { activeWithBindings } from "./support/states.ts";

describe("TST-PERSIST commit planning", () => {
  it("TST-PERSIST-040 a decision that changes nothing plans no write", () => {
    const game = newGame();
    const stale = submit(
      game,
      moveCommand(game, "e2e4", { expectedGameSequence: 5 }),
      START_MS + 10,
    );
    expect(stale.response.code).toBe("StaleSequence");
    expect(planCommit(game, stale.nextState, stale.events)).toBeNull();
  });

  it("TST-PERSIST-041 a bound rejection plans a binding on the unchanged sequence", () => {
    const game = newGame();
    const bad = submit(game, moveCommand(game, "e2e4", { promotionPiece: "q" }), START_MS + 10);
    expect(bad.response.code).toBe("InvalidState");
    const plan = planCommit(game, bad.nextState, bad.events);
    expect(plan).toMatchObject({ kind: "bind_only", expectedSequence: 0, bindingOrdinal: 0 });
    expect(plan?.kind === "bind_only" && plan.binding).toBe(bad.nextState.commandBindings[0]);
  });

  it("TST-PERSIST-042 a committed move plans a transition with its binding", () => {
    const { state, time } = activeWithBindings();
    const move = submit(state, moveCommand(state, "b8c6"), time + 10);
    const plan = planCommit(state, move.nextState, move.events);
    expect(plan).toMatchObject({
      kind: "transition",
      expectedSequence: state.sequence,
      bindingOrdinal: state.commandBindings.length,
      events: [],
    });
    expect(plan?.kind === "transition" && plan.state).toBe(move.nextState);
  });

  it("TST-PERSIST-043 a finishing move plans its event, and a writer flag plans no binding", () => {
    const before = playMoves(newGame(), ["f2f3", "e7e5", "g2g4"]);
    const mate = submit(before.state, moveCommand(before.state, "d8h4"), before.time + 10);
    const plan = planCommit(before.state, mate.nextState, mate.events);
    expect(plan?.kind === "transition" && plan.events).toEqual(mate.events);
    expect(mate.events).toHaveLength(1);
    const game = newGame({ initialMs: 1_000 });
    const flag = processDeadline(game, ms(START_MS + 1_001));
    expect(planCommit(game, flag.nextState, flag.events)).toMatchObject({
      kind: "transition",
      binding: null,
      expectedSequence: 0,
    });
  });

  it("TST-PERSIST-044 a state change the core cannot make is a defect, never persisted", () => {
    const { state, time } = activeWithBindings();
    const move = submit(state, moveCommand(state, "b8c6"), time + 10).nextState;
    const [first] = state.commandBindings;
    if (first === undefined) throw new Error("fixture has bindings");
    const variants: readonly ActiveGameState[] = [
      { ...move, commandBindings: [...move.commandBindings, first] },
      { ...move, commandBindings: move.commandBindings.slice(1) },
      { ...move, commandBindings: [first, ...move.commandBindings.slice(1)].reverse() },
      { ...move, sequence: sequence(move.sequence + 1) },
      { ...move, gameId: OTHER_GAME_ID },
      { ...move, players: { ...move.players, black: STRANGER } },
      { ...state, commandBindings: [...state.commandBindings, first], clock: move.clock },
      { ...state },
    ];
    for (const next of variants) {
      expect(() => planCommit(state, next, [])).toThrow(/persistence defect/);
    }
    const before = playMoves(newGame(), ["f2f3", "e7e5", "g2g4"]);
    const mate = submit(before.state, moveCommand(before.state, "d8h4"), before.time + 10);
    expect(() => planCommit(state, state, mate.events)).toThrow(/persistence defect/);
    const shifted = mate.events.map((event) => ({
      ...event,
      gameSequence: sequence(move.sequence + 1),
    }));
    expect(() => planCommit(state, move, shifted)).toThrow(/persistence defect/);
  });
});

function sequence(value: number): GameSequence {
  if (!isGameSequence(value)) throw new Error(`invalid sequence ${value}`);
  return value;
}
