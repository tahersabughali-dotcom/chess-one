import { createInitialPosition, DEFAULT_RULESET_ID, formatFen } from "@chess-one/chess-rules";
import {
  type ActiveGameState,
  type CommandDecision,
  createActiveGame,
  fingerprintOf,
  isWallClockMs,
  type LiveGameCommand,
  parseCommand,
  processCommand,
} from "@chess-one/live-game";
import { describe, expect, it } from "vitest";
import { play, positionOf } from "../rules/support/positions.ts";
import {
  actorFor,
  at,
  claimCommand,
  duration,
  GAME_ID,
  INITIAL_MS,
  LEASES,
  moveCommand,
  ms,
  newGame,
  OTHER_GAME_ID,
  PLAYERS,
  playMoves,
  REPLACED_LEASE,
  ROTATED_WHITE_LEASE,
  START_MS,
  STRANGER,
  snapshot,
  submit,
} from "./support/harness.ts";

const KNIGHT_CYCLE = ["g1f3", "g8f6", "f3g1", "f6g8"];
const FOOLS_MATE = ["f2f3", "e7e5", "g2g4"];

/** Every game field is the same object; only the command bindings may differ. */
function expectGameUnchanged(next: ActiveGameState, before: ActiveGameState): void {
  expect(next.position).toBe(before.position);
  expect(next.history).toBe(before.history);
  expect(next.sequence).toBe(before.sequence);
  expect(next.clock).toBe(before.clock);
  expect(next.status).toBe(before.status);
  expect(next.players).toBe(before.players);
  expect(next.controlLeases).toBe(before.controlLeases);
}

function expectBoundRejection(decision: CommandDecision, before: ActiveGameState): void {
  expectGameUnchanged(decision.nextState, before);
  expect(decision.nextState.commandBindings).toHaveLength(before.commandBindings.length + 1);
  expect(decision.nextState.commandBindings.at(-1)?.response).toBe(decision.response);
  expect(decision.events).toEqual([]);
}

function expectUntouched(decision: CommandDecision, before: ActiveGameState): void {
  expect(decision.nextState).toBe(before);
  expect(decision.events).toEqual([]);
}

describe("TST-LIVE game creation", () => {
  it("TST-LIVE-001 a new game is sequence 0 with one history entry and the mover's clock running", () => {
    const game = newGame();
    expect(game.sequence).toBe(0);
    expect(game.rulesetId).toBe(DEFAULT_RULESET_ID);
    expect(game.history).toHaveLength(1);
    expect(formatFen(game.position)).toBe(formatFen(createInitialPosition(DEFAULT_RULESET_ID)));
    expect(game.clock).toEqual({
      timeControl: { kind: "sudden_death", initialMs: INITIAL_MS },
      remainingMs: { white: INITIAL_MS, black: INITIAL_MS },
      activeSide: "white",
      running: true,
      anchorMs: START_MS,
    });
    expect(game.status).toEqual({ kind: "active" });
    expect(game.commandBindings).toEqual([]);
    expect(Object.isFrozen(game)).toBe(true);
    expect(Object.isFrozen(game.history)).toBe(true);
    expect(Object.isFrozen(game.clock)).toBe(true);

    const blackToMove = newGame({ startPosition: positionOf("4k3/8/8/8/8/8/8/R3K3 b - - 0 1") });
    expect(blackToMove.clock.activeSide).toBe("black");
  });

  it("TST-LIVE-002 creation rejects shared seats, shared leases, empty clocks, and finished positions", () => {
    const base = {
      gameId: GAME_ID,
      players: PLAYERS,
      controlLeases: LEASES,
      timeControl: { kind: "sudden_death", initialMs: duration(INITIAL_MS) },
      startedAtMonotonicMs: ms(START_MS),
    } as const;
    const failure = (game: Parameters<typeof createActiveGame>[0]) => {
      const created = createActiveGame(game);
      return created.ok ? "ok" : created.error;
    };
    expect(failure(base)).toBe("ok");
    expect(failure({ ...base, players: { white: PLAYERS.white, black: PLAYERS.white } })).toBe(
      "same_player_on_both_seats",
    );
    expect(failure({ ...base, controlLeases: { white: LEASES.white, black: LEASES.white } })).toBe(
      "shared_control_lease",
    );
    expect(
      failure({ ...base, timeControl: { kind: "sudden_death", initialMs: duration(0) } }),
    ).toBe("empty_time_control");
    for (const fen of [
      "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1",
      "8/8/8/8/4k3/8/8/4K3 w - - 0 1",
      "4k3/8/8/8/8/8/8/R3K3 w - - 150 100",
    ]) {
      expect(failure({ ...base, startPosition: positionOf(fen) }), fen).toBe(
        "start_position_not_active",
      );
    }
  });
});

describe("TST-LIVE SubmitMoveCommand.v1", () => {
  it("TST-LIVE-010 TST-RULE-E01-001 a legal move is accepted once: server SAN, not terminal, sequence and history +1", () => {
    const game = newGame();
    const decision = submit(game, moveCommand(game, "e2e4"), START_MS + 500);
    const next = decision.nextState;
    expect(decision.response).toMatchObject({
      gameId: GAME_ID,
      command: "SubmitMoveCommand.v1",
      clientCommandId: "white-0-e2e4",
      code: "Accepted",
      detail: null,
      replayedResponse: false,
      receivedAtMonotonicMs: START_MS + 500,
      sequence: 1,
      san: "e4",
      status: { kind: "active" },
    });
    expect(next.sequence).toBe(1);
    expect(next.history).toHaveLength(2);
    expect(formatFen(next.position)).toBe(formatFen(play(game.position, "e2e4")));
    expect(decision.response.positionFen).toBe(formatFen(next.position));
    expect(next.clock).toMatchObject({
      remainingMs: { white: INITIAL_MS - 500, black: INITIAL_MS },
      activeSide: "black",
      running: true,
      anchorMs: START_MS + 500,
    });
    expect(next.commandBindings).toHaveLength(1);
    expect(decision.events).toEqual([]);
    expect(game.sequence).toBe(0);
    expect(game.history).toHaveLength(1);
  });

  it("TST-LIVE-011 an illegal move is IllegalMove: bound, and no game field changes", () => {
    const game = newGame();
    const before = snapshot(game);
    const decision = submit(game, moveCommand(game, "e2e5"), START_MS + 100);
    expect(decision.response).toMatchObject({
      code: "IllegalMove",
      detail: "illegal_move",
      san: null,
      sequence: 0,
      replayedResponse: false,
    });
    expectBoundRejection(decision, game);
    expect(snapshot(game)).toEqual(before);
  });

  it("TST-LIVE-012 a missing or unexpected promotion is InvalidState, bound, with no game change", () => {
    const game = newGame({ startPosition: positionOf("4k3/P7/8/8/8/8/8/4K3 w - - 0 1") });
    const missing = submit(game, moveCommand(game, "a7a8"), START_MS + 1);
    expect(missing.response).toMatchObject({ code: "InvalidState", detail: "promotion_required" });
    expectBoundRejection(missing, game);
    const unexpected = submit(game, moveCommand(game, "e1e2q"), START_MS + 1);
    expect(unexpected.response).toMatchObject({
      code: "InvalidState",
      detail: "promotion_unexpected",
    });
    expectBoundRejection(unexpected, game);
    const promoted = submit(
      game,
      moveCommand(game, "a7a8Q ", { clientCommandId: "promote" }),
      START_MS + 1,
    );
    expect(promoted.response).toMatchObject({ code: "Accepted", san: "a8=Q+" });
  });

  it("TST-LIVE-013 a seat moving out of turn is NotYourTurn, bound, with no game change", () => {
    const game = newGame();
    const command = moveCommand(game, "e7e5", {
      clientCommandId: "black-early",
      controlLeaseId: LEASES.black,
    });
    const decision = submit(game, command, START_MS + 1, "black");
    expect(decision.response).toMatchObject({ code: "NotYourTurn", detail: null, sequence: 0 });
    expectBoundRejection(decision, game);
  });

  it("TST-LIVE-014 wrong, expired, or replaced leases, wrong players, and wrong games are Unauthorized before execution", () => {
    const game = newGame();
    const command = moveCommand(game, "e2e4");
    const white = actorFor(game, "white");
    const cases = [
      [{ ...white, controlLeaseId: REPLACED_LEASE }, command, "invalid_control_lease"],
      [white, { ...command, controlLeaseId: REPLACED_LEASE }, "invalid_control_lease"],
      [white, { ...command, controlLeaseId: LEASES.black }, "invalid_control_lease"],
      [{ ...white, controlLeaseId: LEASES.black }, command, "invalid_control_lease"],
      [{ ...white, playerId: STRANGER }, command, "seat_player_mismatch"],
      [{ ...white, playerId: PLAYERS.black }, command, "seat_player_mismatch"],
      [{ ...white, gameId: OTHER_GAME_ID }, command, "wrong_game"],
      [white, { ...command, gameId: OTHER_GAME_ID }, "wrong_game"],
    ] as const;
    for (const [actor, sent, detail] of cases) {
      const decision = processCommand(game, actor, sent, at(START_MS + 1));
      expect(decision.response, detail).toMatchObject({ code: "Unauthorized", detail });
      expectUntouched(decision, game);
    }
    expect(submit(game, command, START_MS + 2).response.code).toBe("Accepted");
  });

  it("TST-LIVE-015 TST-RULE-E01-027 an actor_id naming the other seat is Unauthorized and the seat is unchanged", () => {
    const game = newGame();
    const decision = submit(
      game,
      moveCommand(game, "e2e4", { actorId: PLAYERS.black }),
      START_MS + 1,
    );
    expect(decision.response).toMatchObject({ code: "Unauthorized", detail: "actor_mismatch" });
    expectUntouched(decision, game);
    expect(game.players.white).toBe(PLAYERS.white);
    const echoed = submit(
      game,
      moveCommand(game, "e2e4", { actorId: PLAYERS.white }),
      START_MS + 1,
    );
    expect(echoed.response.code).toBe("Accepted");
  });

  it("TST-LIVE-016 TST-RULE-E01-024 the same id and squares after Accepted replays the stored response with one move only", () => {
    const game = newGame();
    const command = moveCommand(game, "e2e4");
    const first = submit(game, command, START_MS + 100);
    const replay = submit(first.nextState, command, START_MS + 900, "white");
    expect(replay.response).toEqual({ ...first.response, replayedResponse: true });
    expect(replay.nextState).toBe(first.nextState);
    expect(replay.events).toEqual([]);

    const later = playMoves(first.nextState, ["e7e5"], START_MS + 100).state;
    const hinted = { ...command, clientSan: "Nf3", clientObservedAt: 0, expectedGameSequence: 0 };
    const lateReplay = submit(later, hinted, START_MS + 5_000, "white");
    expect(lateReplay.response).toEqual({ ...first.response, replayedResponse: true });
    expect(lateReplay.response.sequence).toBe(1);
    expect(lateReplay.nextState).toBe(later);
    expect(later.history).toHaveLength(3);
  });

  it("TST-LIVE-017 TST-RULE-E01-025 the same id with a different payload is InvalidCommandIdentity with no execution", () => {
    const game = newGame();
    const command = moveCommand(game, "e2e4", { clientCommandId: "cmd-1" });
    const accepted = submit(game, command, START_MS + 1).nextState;
    const next = playMoves(accepted, ["e7e5"]).state;
    for (const conflicting of [
      moveCommand(next, "d2d4", { clientCommandId: "cmd-1" }),
      moveCommand(next, "g1f3", { clientCommandId: "cmd-1" }),
      claimCommand(next, "threefold_current", undefined, { clientCommandId: "cmd-1" }),
    ]) {
      const decision = submit(next, conflicting, START_MS + 50);
      expect(decision.response).toMatchObject({
        code: "InvalidCommandIdentity",
        replayedResponse: false,
      });
      expectUntouched(decision, next);
    }
    const illegal = submit(
      next,
      moveCommand(next, "e1e3", { clientCommandId: "cmd-2" }),
      START_MS + 60,
    );
    const retried = submit(
      illegal.nextState,
      moveCommand(next, "d2d4", { clientCommandId: "cmd-2" }),
      START_MS + 70,
    );
    expect(retried.response.code).toBe("InvalidCommandIdentity");
    expectUntouched(retried, illegal.nextState);
  });

  it("TST-LIVE-033 the fingerprint binds the normalized payload and the lease, and excludes hints, echoes, sequence, and the command id", () => {
    const game = newGame();
    const fingerprint = (command: LiveGameCommand): string => {
      const parsed = parseCommand(command);
      if (!parsed.ok) throw new Error(parsed.error);
      return fingerprintOf(parsed.value);
    };
    const base = fingerprint(moveCommand(game, "e2e4"));
    for (const variant of [
      moveCommand(game, "e2e4", { fromSquare: " E2", toSquare: "e4 " }),
      moveCommand(game, "e2e4", { promotionPiece: "" }),
      moveCommand(game, "e2e4", { clientSan: "e4!!", clientObservedAt: 5, actorId: PLAYERS.white }),
      moveCommand(game, "e2e4", { expectedGameSequence: 7 }),
      moveCommand(game, "e2e4", { clientCommandId: "another-id" }),
    ]) {
      expect(fingerprint(variant)).toBe(base);
    }
    for (const different of [
      moveCommand(game, "e2e3"),
      moveCommand(game, "e2e4", { gameId: OTHER_GAME_ID }),
      moveCommand(game, "e2e4", { controlLeaseId: REPLACED_LEASE }),
      moveCommand(game, "e2e4", { controlLeaseId: ROTATED_WHITE_LEASE }),
      claimCommand(game, "threefold_intended", "e2e4"),
      claimCommand(game, "fifty_move_intended", "e2e4"),
    ]) {
      expect(fingerprint(different)).not.toBe(base);
    }
    const claim = fingerprint(claimCommand(game, "threefold_intended", "e2e4"));
    for (const different of [
      claimCommand(game, "threefold_intended", "e2e3"),
      claimCommand(game, "threefold_intended", "e2e4", { controlLeaseId: ROTATED_WHITE_LEASE }),
      claimCommand(game, "threefold_current"),
    ]) {
      expect(fingerprint(different)).not.toBe(claim);
    }
    expect(
      fingerprint(
        claimCommand(game, "threefold_intended", "E2e4 ", {
          clientCommandId: "other",
          expectedGameSequence: 3,
          actorId: PLAYERS.white,
          clientObservedAt: 1,
        }),
      ),
    ).toBe(claim);
    expect(fingerprint(claimCommand(game, "threefold_current"))).not.toBe(
      fingerprint(claimCommand(game, "fifty_move_current")),
    );
  });

  it("TST-LIVE-018 command ids are scoped to the seat", () => {
    const game = newGame();
    const white = submit(
      game,
      moveCommand(game, "e2e4", { clientCommandId: "shared" }),
      START_MS + 1,
    );
    const state = white.nextState;
    const black = submit(
      state,
      moveCommand(state, "e7e5", { clientCommandId: "shared" }),
      START_MS + 2,
    );
    expect(black.response).toMatchObject({ code: "Accepted", replayedResponse: false, san: "e5" });
    expect(black.nextState.sequence).toBe(2);
  });

  it("TST-LIVE-019 TST-RULE-E01-026 client SAN is a hint: the server SAN from the squares is stored", () => {
    const game = newGame();
    const decision = submit(game, moveCommand(game, "e2e4", { clientSan: "Nf3" }), START_MS + 1);
    expect(decision.response.san).toBe("e4");
    expect(decision.nextState.commandBindings[0]?.response.san).toBe("e4");
    const plain = submit(game, moveCommand(game, "e2e4"), START_MS + 1);
    expect(snapshot(decision.nextState)).toEqual(snapshot(plain.nextState));
  });

  it("TST-LIVE-020 TST-RULE-E01-028 a client clock stamp far in the past leaves receipt time and the clock unchanged", () => {
    const game = newGame();
    const t = START_MS + 4_000;
    const stamped = submit(game, moveCommand(game, "e2e4", { clientObservedAt: 0 }), t);
    const future = submit(game, moveCommand(game, "e2e4", { clientObservedAt: 9e15 }), t);
    const plain = submit(game, moveCommand(game, "e2e4"), t);
    for (const decision of [stamped, future]) {
      expect(decision.response.receivedAtMonotonicMs).toBe(t);
      expect(snapshot(decision.nextState)).toEqual(snapshot(plain.nextState));
    }
    expect(plain.nextState.clock.remainingMs.white).toBe(INITIAL_MS - 4_000);
  });

  it("TST-LIVE-021 malformed commands are InvalidState before authority or identity and lock nothing", () => {
    const game = newGame();
    const cases = [
      [{ contractVersion: "2" }, "unsupported_contract_version"],
      [{ gameId: "" }, "malformed_game_id"],
      [{ clientCommandId: "has space" }, "malformed_command_id"],
      [{ clientCommandId: "x".repeat(129) }, "malformed_command_id"],
      [{ controlLeaseId: "" }, "malformed_control_lease_id"],
      [{ expectedGameSequence: -1 }, "malformed_expected_sequence"],
      [{ expectedGameSequence: 1.5 }, "malformed_expected_sequence"],
      [{ actorId: "" }, "malformed_actor_id"],
      [{ fromSquare: "z9" }, "invalid_from_square"],
      [{ toSquare: "e9" }, "invalid_to_square"],
      [{ toSquare: "e2" }, "same_square"],
      [{ promotionPiece: "k" }, "invalid_promotion_piece"],
    ] as const;
    for (const [fields, detail] of cases) {
      const decision = submit(game, moveCommand(game, "e2e4", fields), START_MS + 1);
      expect(decision.response, detail).toMatchObject({ code: "InvalidState", detail });
      expectUntouched(decision, game);
    }
    expect(submit(game, moveCommand(game, "e2e4"), START_MS + 1).response.code).toBe("Accepted");
  });

  it("TST-LIVE-022 StaleSequence and Unauthorized lock no command id", () => {
    const game = newGame();
    const stale = submit(
      game,
      moveCommand(game, "e2e4", { expectedGameSequence: 3 }),
      START_MS + 1,
    );
    expect(stale.response).toMatchObject({ code: "StaleSequence", sequence: 0 });
    expectUntouched(stale, game);
    const unauthorized = processCommand(
      game,
      { ...actorFor(game, "white"), controlLeaseId: REPLACED_LEASE },
      moveCommand(game, "e2e4"),
      at(START_MS + 2),
    );
    expect(unauthorized.response.code).toBe("Unauthorized");
    expect(submit(game, moveCommand(game, "e2e4"), START_MS + 3).response.code).toBe("Accepted");
  });

  it("TST-LIVE-023 checkmate finishes the game once, with a result, a stopped clock, and one game.finished event", () => {
    const { state, time } = playMoves(newGame(), FOOLS_MATE);
    const mate = submit(state, moveCommand(state, "d8h4"), time + 10, "black");
    const finished = mate.nextState;
    expect(mate.response).toMatchObject({ code: "Accepted", san: "Qh4#", sequence: 4 });
    expect(finished.status).toEqual({
      kind: "finished",
      result: { resultCode: "black_win", terminationReason: "checkmate", winner: "black" },
    });
    expect(finished.clock.running).toBe(false);
    expect(finished.clock.anchorMs).toBe(time + 10);
    expect(mate.events).toHaveLength(1);
    expect(mate.events[0]).toEqual({
      eventName: "game.finished",
      eventVersion: 1,
      producer: "live_game_authority",
      gameId: GAME_ID,
      gameSequence: 4,
      rulesetId: DEFAULT_RULESET_ID,
      playerIds: PLAYERS,
      result: { resultCode: "black_win", terminationReason: "checkmate", winner: "black" },
      finalPositionFen: formatFen(finished.position),
      finalClock: finished.clock,
      occurredAtWallClockMs: null,
      provenance: {
        command: "SubmitMoveCommand.v1",
        seat: "black",
        clientCommandId: "black-3-d8h4",
      },
    });
    const replay = submit(finished, moveCommand(state, "d8h4"), time + 20, "black");
    expect(replay.response).toEqual({ ...mate.response, replayedResponse: true });
    expect(replay.events).toEqual([]);
  });

  it("TST-LIVE-024 stalemate is a draw with detail stalemate", () => {
    const game = newGame({ startPosition: positionOf("7k/8/6K1/8/8/8/5Q2/8 w - - 0 1") });
    const decision = submit(game, moveCommand(game, "f2f7"), START_MS + 1);
    expect(decision.nextState.status).toEqual({
      kind: "finished",
      result: {
        resultCode: "draw",
        terminationReason: "draw_rule",
        drawRuleDetails: ["stalemate"],
      },
    });
    expect(decision.events).toHaveLength(1);
  });

  it("TST-LIVE-025 TST-RULE-E01-019 the fifth occurrence draws automatically; the third alone does not", () => {
    const third = playMoves(newGame(), [...KNIGHT_CYCLE, ...KNIGHT_CYCLE]);
    expect(third.state.status).toEqual({ kind: "active" });
    expect(third.state.clock.running).toBe(true);
    const fourth = playMoves(
      third.state,
      [...KNIGHT_CYCLE, ...KNIGHT_CYCLE.slice(0, 3)],
      third.time,
    );
    const fifth = submit(fourth.state, moveCommand(fourth.state, "f6g8"), fourth.time + 10);
    expect(fifth.nextState.status).toEqual({
      kind: "finished",
      result: { resultCode: "draw", terminationReason: "draw_rule", drawRuleDetails: ["fivefold"] },
    });
    expect(fifth.nextState.sequence).toBe(16);
    expect(fifth.events).toHaveLength(1);
  });

  it("TST-LIVE-026 TST-RULE-E01-021a the 150th halfmove without mate draws automatically as seventy_five_move", () => {
    const game = newGame({ startPosition: positionOf("4k3/8/8/8/8/8/8/R3K3 w - - 149 100") });
    const decision = submit(game, moveCommand(game, "a1a2"), START_MS + 1);
    expect(decision.nextState.status).toEqual({
      kind: "finished",
      result: {
        resultCode: "draw",
        terminationReason: "draw_rule",
        drawRuleDetails: ["seventy_five_move"],
      },
    });
  });

  it("TST-LIVE-027 TST-RULE-E01-021b a mate that completes the 75-move count is white_win checkmate", () => {
    const game = newGame({ startPosition: positionOf("k7/2K5/8/8/8/8/1Q6/8 w - - 149 80") });
    const decision = submit(game, moveCommand(game, "b2b7"), START_MS + 1);
    expect(decision.nextState.status).toEqual({
      kind: "finished",
      result: { resultCode: "white_win", terminationReason: "checkmate", winner: "white" },
    });
  });

  it("TST-LIVE-028 coexisting draw facts without approved precedence are all retained", () => {
    const game = newGame({ startPosition: positionOf("r3k3/8/8/8/8/8/8/R3K3 w - - 134 80") });
    const cycle = ["a1a2", "a8a7", "a2a1", "a7a8"];
    const { state, time } = playMoves(game, [...cycle, ...cycle, ...cycle, ...cycle.slice(0, 3)]);
    expect(state.status).toEqual({ kind: "active" });
    const decision = submit(state, moveCommand(state, "a7a8"), time + 10);
    expect(decision.nextState.status).toEqual({
      kind: "finished",
      result: {
        resultCode: "draw",
        terminationReason: "draw_rule",
        drawRuleDetails: ["fivefold", "seventy_five_move"],
      },
    });
  });

  it("TST-LIVE-029 a move that reaches a proven dead position is a draw with detail dead_position", () => {
    const game = newGame({ startPosition: positionOf("4k3/8/8/8/8/8/3n4/K1B5 w - - 0 1") });
    const decision = submit(game, moveCommand(game, "c1d2"), START_MS + 1);
    expect(decision.nextState.status).toEqual({
      kind: "finished",
      result: {
        resultCode: "draw",
        terminationReason: "draw_rule",
        drawRuleDetails: ["dead_position"],
      },
    });
  });

  it("TST-LIVE-032 TST-RULE-E01-014a TST-RULE-E01-014b TST-RULE-E01-014c reaching each ledger dead placement is a draw with detail dead_position", () => {
    for (const [start, reached] of [
      ["8/8/8/3k4/4R3/8/8/4K3 b - - 0 1", "8/8/8/8/4k3/8/8/4K3 w - - 0 2"],
      ["8/8/8/3k4/4R3/8/4B3/4K3 b - - 0 1", "8/8/8/8/4k3/8/4B3/4K3 w - - 0 2"],
      ["8/8/8/3k4/4R3/8/4N3/4K3 b - - 0 1", "8/8/8/8/4k3/8/4N3/4K3 w - - 0 2"],
    ] as const) {
      const game = newGame({ startPosition: positionOf(start) });
      const decision = submit(game, moveCommand(game, "d5e4"), START_MS + 1);
      expect(formatFen(decision.nextState.position), start).toBe(reached);
      expect(decision.nextState.status, start).toEqual({
        kind: "finished",
        result: {
          resultCode: "draw",
          terminationReason: "draw_rule",
          drawRuleDetails: ["dead_position"],
        },
      });
      expect(decision.nextState.clock.running).toBe(false);
      expect(decision.events).toHaveLength(1);
    }
  });

  it("TST-LIVE-030 a finished game answers GameAlreadyFinished to every new command, unbound, and keeps its result", () => {
    const { state, time } = playMoves(newGame(), FOOLS_MATE);
    const finished = submit(state, moveCommand(state, "d8h4"), time + 10).nextState;
    const result = finished.status.kind === "finished" ? finished.status.result : null;
    const later = [
      moveCommand(finished, "e2e4"),
      claimCommand(finished, "threefold_current"),
      moveCommand(finished, "a2a3", { expectedGameSequence: 99 }),
    ];
    for (const command of later) {
      const decision = submit(finished, command, time + 5_000_000);
      expect(decision.response).toMatchObject({
        code: "GameAlreadyFinished",
        sequence: 4,
        replayedResponse: false,
      });
      expectUntouched(decision, finished);
    }
    const retry = submit(finished, later[0] ?? moveCommand(finished, "e2e4"), time + 5_000_001);
    expect(retry.response).toMatchObject({ code: "GameAlreadyFinished", replayedResponse: false });
    expectUntouched(retry, finished);
    expect(finished.status.kind === "finished" && finished.status.result).toBe(result);
  });

  it("TST-LIVE-031 wall-clock audit time is recorded on the event but never decides anything", () => {
    const { state, time } = playMoves(newGame(), FOOLS_MATE);
    const command = moveCommand(state, "d8h4");
    const actor = actorFor(state, "black");
    const audits = [0, 1_700_000_000_000, 9_000_000_000_000].map((wall) => {
      if (!isWallClockMs(wall)) throw new Error("invalid wall clock");
      return processCommand(state, actor, command, {
        receivedAtMonotonicMs: ms(time + 10),
        auditWallClockMs: wall,
      });
    });
    expect(audits.map((decision) => decision.events[0]?.occurredAtWallClockMs)).toEqual([
      0, 1_700_000_000_000, 9_000_000_000_000,
    ]);
    for (const decision of audits) {
      expect(snapshot(decision.nextState)).toEqual(snapshot(audits[0]?.nextState ?? state));
      expect(decision.response).toEqual(audits[0]?.response);
    }
  });
});
