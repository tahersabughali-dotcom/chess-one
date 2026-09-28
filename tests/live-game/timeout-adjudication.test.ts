import {
  type ActiveGameState,
  isWallClockMs,
  processCommand,
  processDeadline,
  type WallClockMs,
} from "@chess-one/live-game";
import { describe, expect, it } from "vitest";
import { positionOf } from "../rules/support/positions.ts";
import {
  actorFor,
  claimCommand,
  moveCommand,
  ms,
  newGame,
  playMoves,
  resignCommand,
  START_MS,
  snapshot,
  submit,
} from "./support/harness.ts";

const SHORT_MS = 1_000;
const DEADLINE = START_MS + SHORT_MS;
const QUEEN_VS_KING_BLACK_TO_MOVE = "4k3/8/8/8/8/8/8/3QK3 b - - 0 1";
const QUEEN_VS_KING_WHITE_TO_MOVE = "4k3/8/8/8/8/8/8/3QK3 w - - 0 1";
/** Position 012's non-terminal predecessor: b2b7 would mate. */
const QUEEN_MATES_NEXT = "k7/2K5/8/8/8/8/1Q6/8 w - - 0 1";

function audit(value: number): WallClockMs {
  if (!isWallClockMs(value)) throw new Error(`invalid wall clock ${value}`);
  return value;
}

function gameAt(fen: string): ActiveGameState {
  return newGame({ startPosition: positionOf(fen), initialMs: SHORT_MS });
}

const WHITE_WINS_ON_TIME = {
  kind: "finished",
  result: { resultCode: "white_win", terminationReason: "time", winner: "white" },
};
const DRAW_ON_TIME = {
  kind: "finished",
  result: {
    resultCode: "draw",
    terminationReason: "draw_rule",
    drawRuleDetails: ["timeout_no_mate"],
  },
};

describe("TST-LIVE timeout adjudication by the opponent's one-sided mating capability", () => {
  it("TST-LIVE-120 TST-RULE-E01-016a a late command from the lone king: not applied, and the side that can mate wins on time", () => {
    const game = gameAt(QUEEN_VS_KING_BLACK_TO_MOVE);
    const command = moveCommand(game, "e8d7");
    const decision = submit(game, command, DEADLINE + 1);
    const next = decision.nextState;
    expect(decision.response).toMatchObject({
      code: "MoveReceivedAfterDeadline",
      san: null,
      sequence: 1,
      replayedResponse: false,
    });
    expect(next.position).toBe(game.position);
    expect(next.history).toBe(game.history);
    expect(next.status).toEqual(WHITE_WINS_ON_TIME);
    expect(decision.response.status).toBe(next.status);
    expect(next.clock).toMatchObject({
      remainingMs: { white: SHORT_MS, black: 0 },
      running: false,
      anchorMs: DEADLINE + 1,
    });
    expect(next.commandBindings).toHaveLength(1);
    expect(next.commandBindings[0]?.response).toBe(decision.response);
    expect(decision.events).toHaveLength(1);
    expect(decision.events[0]).toEqual({
      eventName: "game.finished",
      eventVersion: 1,
      producer: "live_game_authority",
      gameId: game.gameId,
      gameSequence: 1,
      rulesetId: game.rulesetId,
      playerIds: game.players,
      result: WHITE_WINS_ON_TIME.result,
      finalPositionFen: QUEEN_VS_KING_BLACK_TO_MOVE,
      finalClock: next.clock,
      occurredAtWallClockMs: null,
      provenance: {
        command: "SubmitMoveCommand.v1",
        seat: "black",
        clientCommandId: command.clientCommandId,
      },
    });
  });

  it("TST-LIVE-121 the asymmetric pair: with the same king and queen against king, White flagging is a draw and Black flagging is a White win", () => {
    const whiteFlags = processDeadline(
      gameAt(QUEEN_VS_KING_WHITE_TO_MOVE),
      ms(DEADLINE + 1),
      audit(1_700_000_000_000),
    );
    expect(whiteFlags.flagged).toBe(true);
    expect(whiteFlags.nextState.status).toEqual(DRAW_ON_TIME);
    expect(whiteFlags.events).toHaveLength(1);
    expect(whiteFlags.events[0]).toMatchObject({
      result: DRAW_ON_TIME.result,
      gameSequence: 1,
      occurredAtWallClockMs: 1_700_000_000_000,
      provenance: { writerDeadline: true, flaggedSide: "white" },
      finalClock: { remainingMs: { white: 0, black: SHORT_MS }, running: false },
    });

    const blackFlags = processDeadline(gameAt(QUEEN_VS_KING_BLACK_TO_MOVE), ms(DEADLINE + 1));
    expect(blackFlags.nextState.status).toEqual(WHITE_WINS_ON_TIME);
    expect(blackFlags.events).toHaveLength(1);
    expect(blackFlags.events[0]).toMatchObject({
      result: WHITE_WINS_ON_TIME.result,
      occurredAtWallClockMs: null,
      provenance: { writerDeadline: true, flaggedSide: "black" },
    });
    expect(blackFlags.nextState.commandBindings).toEqual([]);
  });

  it("TST-LIVE-122 TST-RULE-E01-016d mating squares received after the deadline are not checkmate; the flag result stands as a draw because the lone king cannot mate", () => {
    const game = gameAt(QUEEN_MATES_NEXT);
    const decision = submit(game, moveCommand(game, "b2b7"), DEADLINE + 1);
    expect(decision.response).toMatchObject({ code: "MoveReceivedAfterDeadline", san: null });
    expect(decision.nextState.position).toBe(game.position);
    expect(decision.nextState.status).toEqual(DRAW_ON_TIME);
    expect(decision.events).toHaveLength(1);
    expect(decision.events[0]?.result).toEqual(DRAW_ON_TIME.result);

    const timely = submit(game, moveCommand(game, "b2b7"), DEADLINE);
    expect(timely.nextState.status).toEqual({
      kind: "finished",
      result: { resultCode: "white_win", terminationReason: "checkmate", winner: "white" },
    });
  });

  it("TST-LIVE-123 a late command that resolved the flag replays its original response once, with no second event and no state change", () => {
    const game = gameAt(QUEEN_VS_KING_BLACK_TO_MOVE);
    const command = moveCommand(game, "e8d7");
    const first = submit(game, command, DEADLINE + 1);
    const finished = first.nextState;
    const before = snapshot(finished);
    for (const later of [DEADLINE + 2, DEADLINE + 60_000]) {
      const replay = submit(finished, command, later, "black");
      expect(replay.response).toEqual({ ...first.response, replayedResponse: true });
      expect(replay.nextState).toBe(finished);
      expect(replay.events).toEqual([]);
    }
    const retried = submit(
      finished,
      { ...command, expectedGameSequence: 1 },
      DEADLINE + 3,
      "black",
    );
    expect(retried.response).toEqual({ ...first.response, replayedResponse: true });
    expect(retried.events).toEqual([]);
    expect(snapshot(finished)).toEqual(before);
    expect(finished.sequence).toBe(1);
  });

  it("TST-LIVE-124 a resolved flag is absorbing: every later command is GameAlreadyFinished without a binding, and the writer's deadline check adds nothing", () => {
    for (const flagged of [
      submit(
        gameAt(QUEEN_VS_KING_BLACK_TO_MOVE),
        moveCommand(gameAt(QUEEN_VS_KING_BLACK_TO_MOVE), "e8d7"),
        DEADLINE + 1,
      ).nextState,
      processDeadline(gameAt(QUEEN_VS_KING_WHITE_TO_MOVE), ms(DEADLINE + 1)).nextState,
    ]) {
      expect(flagged.status.kind).toBe("finished");
      const before = snapshot(flagged);
      const lease = (seat: "white" | "black") => ({ controlLeaseId: flagged.controlLeases[seat] });
      for (const [command, seat] of [
        [
          moveCommand(flagged, "d1d2", { clientCommandId: "after-flag", ...lease("white") }),
          "white",
        ],
        [
          claimCommand(flagged, "threefold_current", undefined, {
            clientCommandId: "after-flag",
            ...lease("black"),
          }),
          "black",
        ],
        [resignCommand(flagged, "white"), "white"],
        [resignCommand(flagged, "black"), "black"],
      ] as const) {
        const decision = processCommand(flagged, actorFor(flagged, seat), command, {
          receivedAtMonotonicMs: ms(DEADLINE + 5_000),
        });
        expect(decision.response.code).toBe("GameAlreadyFinished");
        expect(decision.nextState).toBe(flagged);
        expect(decision.events).toEqual([]);
      }
      const again = processDeadline(flagged, ms(DEADLINE + 10_000));
      expect(again).toEqual({ nextState: flagged, flagged: false, events: [] });
      expect(snapshot(flagged)).toEqual(before);
    }
  });

  it("TST-LIVE-126 neither repetition history nor the halfmove clock changes the flag result: a near-fivefold history and a clock at 149 adjudicate as a fresh game", () => {
    const fresh = processDeadline(gameAt(QUEEN_VS_KING_BLACK_TO_MOVE), ms(DEADLINE + 1));
    expect(fresh.nextState.status).toEqual(WHITE_WINS_ON_TIME);

    const cycles = Array.from({ length: 3 }, () => ["e8f7", "d1d2", "f7e8", "d2d1"]).flat();
    const repeated = playMoves(
      newGame({ startPosition: positionOf(QUEEN_VS_KING_BLACK_TO_MOVE) }),
      cycles,
    ).state;
    const occurrences = repeated.history.filter((key) =>
      key.equals(repeated.history[0] ?? key),
    ).length;
    expect(occurrences).toBe(4);
    expect(repeated.status.kind).toBe("active");
    const blackDeadline = repeated.clock.anchorMs + repeated.clock.remainingMs.black;
    const flagged = processDeadline(repeated, ms(blackDeadline + 1));
    expect(flagged.nextState.status).toEqual(WHITE_WINS_ON_TIME);
    expect(flagged.events).toHaveLength(1);

    const clock149 = gameAt("4k3/8/8/8/8/8/8/3QK3 b - - 149 90");
    expect(clock149.status.kind).toBe("active");
    const late = submit(clock149, moveCommand(clock149, "e8d7"), DEADLINE + 1);
    expect(late.response.code).toBe("MoveReceivedAfterDeadline");
    expect(late.nextState.status).toEqual(WHITE_WINS_ON_TIME);
    expect(late.events).toHaveLength(1);
  });

  it("TST-LIVE-125 TST-RULE-E01-016e an UNKNOWN capability after a late command stays MATING_POSSIBILITY_UNRESOLVED with no event, and so does the writer's check", () => {
    const fen = "k7/1Q6/8/8/8/8/8/7K b - - 0 1";
    const game = gameAt(fen);
    const late = submit(game, moveCommand(game, "a8b7"), DEADLINE + 1);
    expect(late.response.code).toBe("MoveReceivedAfterDeadline");
    expect(late.nextState.status).toEqual({
      kind: "unresolved",
      reason: "MATING_POSSIBILITY_UNRESOLVED",
      flaggedSide: "black",
    });
    expect(late.events).toEqual([]);
    const writer = processDeadline(game, ms(DEADLINE + 1));
    expect(writer.nextState.status).toEqual(late.nextState.status);
    expect(writer.events).toEqual([]);
  });
});
