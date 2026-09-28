import { assessMatingCapability, type MatingCapability } from "@chess-one/chess-rules";
import { type Color, oppositeColor, type PieceKind } from "@chess-one/game-values";
import type { ActiveGameState, CommandDecision, GameStatus } from "@chess-one/live-game";
import { createActiveGame, processDeadline } from "@chess-one/live-game";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  anyColor,
  distinctSquares,
  materialPosition,
} from "../rules/support/material-positions.ts";
import {
  duration,
  GAME_ID,
  LEASES,
  moveCommand,
  ms,
  PLAYERS,
  resignCommand,
  START_MS,
  snapshot,
  submit,
} from "./support/harness.ts";

const SHORT_MS = 1_000;
const LATE = START_MS + SHORT_MS + 1;
const RUNS = { numRuns: 40, seed: 20260928 };

/** A running game from a king and queen or rook against a lone king, or null if it cannot start. */
function materialGame(
  placed: readonly number[],
  mating: Color,
  toMove: Color,
  major: PieceKind,
): ActiveGameState | null {
  const start = materialPosition(placed, mating, [major], [], toMove);
  if (start === null) return null;
  const created = createActiveGame({
    gameId: GAME_ID,
    players: PLAYERS,
    controlLeases: LEASES,
    timeControl: { kind: "sudden_death", initialMs: duration(SHORT_MS) },
    startedAtMonotonicMs: ms(START_MS),
    startPosition: start,
  });
  return created.ok ? created.value : null;
}

function expectAdjudicated(
  status: GameStatus,
  capability: MatingCapability,
  ending: "time" | "resignation",
  opponent: Color,
): void {
  if (capability === "UNKNOWN") {
    expect(status).toMatchObject({ kind: "unresolved", reason: "MATING_POSSIBILITY_UNRESOLVED" });
    return;
  }
  if (capability === "PROVEN_CAN_MATE") {
    expect(status).toEqual({
      kind: "finished",
      result: {
        resultCode: opponent === "white" ? "white_win" : "black_win",
        terminationReason: ending,
        winner: opponent,
      },
    });
    return;
  }
  expect(status).toEqual({
    kind: "finished",
    result: {
      resultCode: "draw",
      terminationReason: "draw_rule",
      drawRuleDetails: [ending === "time" ? "timeout_no_mate" : "resign_no_mate_possible"],
    },
  });
}

/** One event exactly when a result was committed; none for an unresolved stop. */
function expectEvents(decision: Pick<CommandDecision, "nextState" | "events">): void {
  const { nextState, events } = decision;
  expect(events).toHaveLength(nextState.status.kind === "finished" ? 1 : 0);
  if (nextState.status.kind === "finished") {
    expect(events[0]?.result).toBe(nextState.status.result);
  }
}

/** Every later command leaves a stopped game untouched and emits nothing. */
function expectAbsorbing(stopped: ActiveGameState): void {
  const before = snapshot(stopped);
  for (const seat of ["white", "black"] as const) {
    const decision = submit(
      stopped,
      resignCommand(stopped, seat, { clientCommandId: `${seat}-after-stop` }),
      LATE + 500,
      seat,
    );
    expect(decision.nextState).toBe(stopped);
    expect(decision.events).toEqual([]);
    expect(decision.response.replayedResponse).toBe(false);
  }
  expect(processDeadline(stopped, ms(LATE + 1_000))).toEqual({
    nextState: stopped,
    flagged: false,
    events: [],
  });
  expect(snapshot(stopped)).toEqual(before);
}

const scenario = fc.tuple(
  distinctSquares(3),
  anyColor,
  anyColor,
  fc.constantFrom<PieceKind>("queen", "rook"),
);

describe("TST-LIVE adjudication properties", () => {
  it("TST-LIVE-140 a flag follows the opponent's capability: UNKNOWN never yields a result, a result is absorbing, and replaying the flag emits no second event", () => {
    const seen = new Set<MatingCapability>();
    fc.assert(
      fc.property(scenario, ([placed, mating, toMove, major]) => {
        const game = materialGame(placed, mating, toMove, major);
        if (game === null) return;
        const flagged = game.position.sideToMove;
        const opponent = oppositeColor(flagged);
        const capability = assessMatingCapability(game.position, opponent);
        seen.add(capability);

        const writer = processDeadline(game, ms(LATE));
        expect(writer.flagged).toBe(true);
        expectAdjudicated(writer.nextState.status, capability, "time", opponent);
        expectEvents(writer);
        if (capability === "UNKNOWN") expect(writer.nextState.status.kind).not.toBe("finished");

        const command = moveCommand(game, "a1a2", { clientCommandId: "late-flag" });
        const late = submit(game, command, LATE);
        expect(late.response.code).toBe("MoveReceivedAfterDeadline");
        expect(late.nextState.status).toEqual(writer.nextState.status);
        expectEvents(late);
        const replay = submit(late.nextState, command, LATE + 10);
        expect(replay.response).toEqual({ ...late.response, replayedResponse: true });
        expect(replay.nextState).toBe(late.nextState);
        expect(replay.events).toEqual([]);
        expectAbsorbing(late.nextState);
      }),
      RUNS,
    );
    expect([...seen]).toEqual(expect.arrayContaining(["PROVEN_CAN_MATE", "PROVEN_CANNOT_MATE"]));
  }, 60_000);

  it("TST-LIVE-141 a resignation follows the opponent's capability on either turn, and replaying it emits no second event", () => {
    const seen = new Set<MatingCapability>();
    fc.assert(
      fc.property(scenario, anyColor, ([placed, mating, toMove, major], resigner) => {
        const game = materialGame(placed, mating, toMove, major);
        if (game === null) return;
        const opponent = oppositeColor(resigner);
        const capability = assessMatingCapability(game.position, opponent);
        seen.add(capability);
        const before = snapshot(game);
        const command = resignCommand(game, resigner);
        const decision = submit(game, command, START_MS + 100, resigner);
        expect(snapshot(game)).toEqual(before);
        expect(decision.response.code).toBe("Accepted");
        expect(decision.nextState.sequence).toBe(game.sequence + 1);
        expectAdjudicated(decision.nextState.status, capability, "resignation", opponent);
        expectEvents(decision);
        const replay = submit(decision.nextState, command, START_MS + 200, resigner);
        expect(replay.response).toEqual({ ...decision.response, replayedResponse: true });
        expect(replay.nextState).toBe(decision.nextState);
        expect(replay.events).toEqual([]);
        expectAbsorbing(decision.nextState);
      }),
      RUNS,
    );
    expect([...seen]).toEqual(expect.arrayContaining(["PROVEN_CAN_MATE", "PROVEN_CANNOT_MATE"]));
  }, 60_000);
});
