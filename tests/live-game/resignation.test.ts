import {
  type ActiveGameState,
  fingerprintOf,
  type LiveGameCommand,
  parseCommand,
  processCommand,
} from "@chess-one/live-game";
import { describe, expect, it } from "vitest";
import { positionOf } from "../rules/support/positions.ts";
import {
  actorFor,
  at,
  INITIAL_MS,
  LEASES,
  moveCommand,
  newGame,
  OTHER_GAME_ID,
  PLAYERS,
  REPLACED_LEASE,
  resignCommand,
  START_MS,
  STRANGER,
  snapshot,
  submit,
} from "./support/harness.ts";

/** Position 012's non-terminal predecessor: White's queen mates with b2b7. */
const QUEEN_MATES_NEXT = "k7/2K5/8/8/8/8/1Q6/8 w - - 0 1";
const RESIGN_AT = START_MS + 700;

function queenGame(initialMs = INITIAL_MS): ActiveGameState {
  return newGame({ startPosition: positionOf(QUEEN_MATES_NEXT), initialMs });
}

function fingerprint(command: LiveGameCommand): string {
  const parsed = parseCommand(command);
  if (!parsed.ok) throw new Error(parsed.error);
  return fingerprintOf(parsed.value);
}

describe("TST-LIVE ResignGameCommand.v1 outcomes", () => {
  it("TST-LIVE-130 TST-RULE-E01-015b the lone king resigns on the opponent's turn: White, who can mate, wins by resignation", () => {
    const game = queenGame();
    const command = resignCommand(game, "black");
    const decision = submit(game, command, RESIGN_AT, "black");
    const next = decision.nextState;
    const result = { resultCode: "white_win", terminationReason: "resignation", winner: "white" };
    expect(decision.response).toMatchObject({
      command: "ResignGameCommand.v1",
      code: "Accepted",
      detail: null,
      san: null,
      sequence: 1,
      replayedResponse: false,
    });
    expect(next.status).toEqual({ kind: "finished", result });
    expect(next.position).toBe(game.position);
    expect(next.history).toBe(game.history);
    expect(next.clock).toMatchObject({
      remainingMs: { white: INITIAL_MS - 700, black: INITIAL_MS },
      activeSide: "white",
      running: false,
      anchorMs: RESIGN_AT,
    });
    expect(next.commandBindings).toHaveLength(1);
    expect(next.commandBindings[0]?.response).toBe(decision.response);
    expect(decision.events).toHaveLength(1);
    expect(decision.events[0]).toMatchObject({
      gameSequence: 1,
      result,
      finalPositionFen: QUEEN_MATES_NEXT,
      provenance: {
        command: "ResignGameCommand.v1",
        seat: "black",
        clientCommandId: command.clientCommandId,
      },
    });
  });

  it("TST-LIVE-131 the side with the queen resigns: the lone king cannot mate, so the game is drawn resign_no_mate_possible", () => {
    const game = queenGame();
    const decision = submit(game, resignCommand(game, "white"), RESIGN_AT, "white");
    const result = {
      resultCode: "draw",
      terminationReason: "draw_rule",
      drawRuleDetails: ["resign_no_mate_possible"],
    };
    expect(decision.response.code).toBe("Accepted");
    expect(decision.nextState.status).toEqual({ kind: "finished", result });
    expect(decision.nextState.clock.remainingMs.white).toBe(INITIAL_MS - 700);
    expect(decision.events).toHaveLength(1);
    expect(decision.events[0]?.result).toEqual(result);
  });

  it("TST-LIVE-132 TST-RULE-E01-015c a resignation where the opponent's capability is UNKNOWN is MATING_POSSIBILITY_UNRESOLVED, with no result and no event", () => {
    const game = newGame();
    const command = resignCommand(game, "white");
    const decision = submit(game, command, RESIGN_AT, "white");
    const next = decision.nextState;
    expect(decision.response.code).toBe("Accepted");
    expect(next.status).toEqual({
      kind: "unresolved",
      reason: "MATING_POSSIBILITY_UNRESOLVED",
      resigningSide: "white",
    });
    expect(next.clock.running).toBe(false);
    expect(next.sequence).toBe(1);
    expect(decision.events).toEqual([]);

    const replay = submit(next, command, RESIGN_AT + 5, "white");
    expect(replay.response).toEqual({ ...decision.response, replayedResponse: true });
    expect(replay.nextState).toBe(next);
    const move = submit(next, moveCommand(next, "e2e4"), RESIGN_AT + 6, "white");
    expect(move.response.code).toBe("MatingPossibilityUnresolved");
    expect(move.nextState).toBe(next);
    const other = submit(next, resignCommand(next, "black"), RESIGN_AT + 7, "black");
    expect(other.response.code).toBe("MatingPossibilityUnresolved");
    expect(other.nextState).toBe(next);
  });

  it("TST-LIVE-133 TST-RULE-E01-015a a resignation after the game ended as dead_position changes nothing and stores no binding", () => {
    const game = newGame({ startPosition: positionOf("8/8/8/3k4/4R3/8/8/4K3 b - - 0 1") });
    const dead = submit(game, moveCommand(game, "d5e4"), START_MS + 10).nextState;
    expect(dead.status).toMatchObject({
      kind: "finished",
      result: { drawRuleDetails: ["dead_position"] },
    });
    for (const seat of ["white", "black"] as const) {
      const decision = submit(dead, resignCommand(dead, seat), START_MS + 20, seat);
      expect(decision.response).toMatchObject({
        code: "GameAlreadyFinished",
        replayedResponse: false,
      });
      expect(decision.nextState).toBe(dead);
      expect(decision.events).toEqual([]);
    }
  });
});

describe("TST-LIVE ResignGameCommand.v1 identity and protections", () => {
  it("TST-LIVE-134 a resignation commits once and an exact replay returns the stored response with no event", () => {
    const game = queenGame();
    const command = resignCommand(game, "black");
    const first = submit(game, command, RESIGN_AT, "black");
    const finished = first.nextState;
    const before = snapshot(finished);
    for (const retry of [command, { ...command, expectedGameSequence: 7, clientObservedAt: 9 }]) {
      const replay = submit(finished, retry, RESIGN_AT + 100, "black");
      expect(replay.response).toEqual({ ...first.response, replayedResponse: true });
      expect(replay.nextState).toBe(finished);
      expect(replay.events).toEqual([]);
    }
    expect(snapshot(finished)).toEqual(before);
    expect(finished.sequence).toBe(1);
  });

  it("TST-LIVE-135 the same command id with a different command kind is InvalidCommandIdentity", () => {
    const game = queenGame();
    const resign = resignCommand(game, "white", { clientCommandId: "white-cmd" });
    const finished = submit(game, resign, RESIGN_AT, "white").nextState;
    const move = moveCommand(game, "b2b7", { clientCommandId: "white-cmd" });
    const conflict = submit(finished, move, RESIGN_AT + 10, "white");
    expect(conflict.response).toMatchObject({
      code: "InvalidCommandIdentity",
      replayedResponse: false,
    });
    expect(conflict.nextState).toBe(finished);
    expect(conflict.events).toEqual([]);

    const played = submit(game, move, RESIGN_AT, "white").nextState;
    expect(played.status.kind).toBe("finished");
    const reversed = submit(played, resign, RESIGN_AT + 10, "white");
    expect(reversed.response.code).toBe("InvalidCommandIdentity");
    expect(reversed.nextState).toBe(played);
  });

  it("TST-LIVE-136 a new resignation on a finished game is GameAlreadyFinished and binds nothing, however often it is sent", () => {
    const game = queenGame();
    const finished = submit(game, resignCommand(game, "black"), RESIGN_AT, "black").nextState;
    const fresh = resignCommand(finished, "white", { clientCommandId: "white-late-resign" });
    for (const time of [RESIGN_AT + 1, RESIGN_AT + 2]) {
      const decision = submit(finished, fresh, time, "white");
      expect(decision.response).toMatchObject({
        code: "GameAlreadyFinished",
        replayedResponse: false,
      });
      expect(decision.nextState).toBe(finished);
      expect(decision.events).toEqual([]);
    }
    expect(finished.commandBindings).toHaveLength(1);
  });

  it("TST-LIVE-137 the resignation fingerprint is the command version, game id, and control lease only", () => {
    const game = queenGame();
    const command = resignCommand(game, "white");
    expect(fingerprint(command)).toBe(`ResignGameCommand.v1 ${game.gameId} ${LEASES.white}`);
    expect(
      fingerprint({
        ...command,
        actorId: PLAYERS.white,
        clientObservedAt: 5,
        expectedGameSequence: 3,
      }),
    ).toBe(fingerprint(command));
    expect(fingerprint({ ...command, controlLeaseId: REPLACED_LEASE })).not.toBe(
      fingerprint(command),
    );
    const stored = submit(game, command, RESIGN_AT, "white").nextState.commandBindings[0];
    expect(stored?.fingerprint).toBe(fingerprint(command));
  });

  it("TST-LIVE-138 unauthorized, stale, and malformed resignations change nothing and bind nothing", () => {
    const game = queenGame();
    const command = resignCommand(game, "black");
    const cases: readonly [string, () => ReturnType<typeof processCommand>][] = [
      [
        "Unauthorized",
        () =>
          processCommand(
            game,
            { ...actorFor(game, "black"), playerId: STRANGER },
            command,
            at(RESIGN_AT),
          ),
      ],
      [
        "Unauthorized",
        () => submit(game, { ...command, controlLeaseId: REPLACED_LEASE }, RESIGN_AT, "black"),
      ],
      [
        "Unauthorized",
        () => submit(game, { ...command, actorId: PLAYERS.white }, RESIGN_AT, "black"),
      ],
      [
        "Unauthorized",
        () => submit(game, { ...command, gameId: OTHER_GAME_ID }, RESIGN_AT, "black"),
      ],
      [
        "StaleSequence",
        () => submit(game, { ...command, expectedGameSequence: 4 }, RESIGN_AT, "black"),
      ],
      [
        "InvalidState",
        () => submit(game, { ...command, contractVersion: "2" }, RESIGN_AT, "black"),
      ],
    ];
    for (const [code, run] of cases) {
      const decision = run();
      expect(decision.response.code).toBe(code);
      expect(decision.nextState).toBe(game);
      expect(decision.events).toEqual([]);
    }
    const retry = submit(game, command, RESIGN_AT + 1, "black");
    expect(retry.response.code).toBe("Accepted");
  });

  it("TST-LIVE-139 LIVE-RESIGN-001 a resignation received after the active side's deadline is not a resignation: the flag already fell and is adjudicated", () => {
    const game = queenGame(1_000);
    const deadline = START_MS + 1_000;
    const lateLoneKing = submit(game, resignCommand(game, "black"), deadline + 1, "black");
    expect(lateLoneKing.response).toMatchObject({ code: "MoveReceivedAfterDeadline", sequence: 1 });
    expect(lateLoneKing.nextState.status).toEqual({
      kind: "finished",
      result: {
        resultCode: "draw",
        terminationReason: "draw_rule",
        drawRuleDetails: ["timeout_no_mate"],
      },
    });
    expect(lateLoneKing.nextState.clock.remainingMs).toEqual({ white: 0, black: 1_000 });
    expect(lateLoneKing.nextState.commandBindings).toHaveLength(1);
    expect(lateLoneKing.events).toHaveLength(1);
    expect(lateLoneKing.events[0]?.provenance).toEqual({
      command: "ResignGameCommand.v1",
      seat: "black",
      clientCommandId: resignCommand(game, "black").clientCommandId,
    });

    const lateActive = submit(game, resignCommand(game, "white"), deadline + 1, "white");
    expect(lateActive.response.code).toBe("MoveReceivedAfterDeadline");
    expect(lateActive.nextState.status).toEqual(lateLoneKing.nextState.status);

    const onTime = submit(game, resignCommand(game, "black"), deadline, "black");
    expect(onTime.response.code).toBe("Accepted");
    expect(onTime.nextState.status).toMatchObject({
      result: { terminationReason: "resignation", winner: "white" },
    });
    const onTimeActive = submit(game, resignCommand(game, "white"), deadline, "white");
    expect(onTimeActive.nextState.status).toMatchObject({
      result: { drawRuleDetails: ["resign_no_mate_possible"] },
    });
    expect(onTimeActive.nextState.clock.remainingMs.white).toBe(0);
  });
});
