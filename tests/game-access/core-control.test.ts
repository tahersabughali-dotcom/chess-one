import { parseGameSequence } from "@chess-one/game-values";
import {
  type ActiveGameState,
  boundLease,
  type CommandResponse,
  type GameParticipant,
  historicalReplay,
  type LeaselessCommand,
  type LiveGameCommand,
  planCommit,
  planLeaseRotation,
  withControlLease,
} from "@chess-one/live-game";
import { describe, expect, it } from "vitest";
import {
  claimCommand,
  GAME_ID,
  LEASES,
  moveCommand,
  newGame,
  OTHER_GAME_ID,
  offerCommand,
  PLAYERS,
  playMoves,
  ROTATED_WHITE_LEASE,
  resignCommand,
  respondCommand,
  START_MS,
  STRANGER,
  snapshot,
  submit,
} from "../live-game/support/harness.ts";

const WHITE: GameParticipant = { gameId: GAME_ID, playerId: PLAYERS.white, seat: "white" };

function leaseless<T extends LiveGameCommand>(command: T): Omit<T, "controlLeaseId"> {
  const { controlLeaseId: _lease, ...rest } = command;
  return rest;
}

function rotated(state: ActiveGameState, lease = ROTATED_WHITE_LEASE): ActiveGameState {
  const next = withControlLease(state, "white", lease);
  if (!next.ok) throw new Error(next.error);
  return next.value;
}

function withoutLeases(state: ActiveGameState): unknown {
  const { controlLeases: _leases, ...rest } = state;
  return rest;
}

describe("TST-GACC-CORE control lease rotation in the live-game core", () => {
  it("TST-GACC-CORE-001 a rotation changes the seat's lease and nothing else; the same lease is the same state", () => {
    const { state } = playMoves(newGame(), ["e2e4", "e7e5", "g1f3"]);
    const next = rotated(state);
    expect(next.controlLeases).toEqual({ white: ROTATED_WHITE_LEASE, black: LEASES.black });
    expect(withoutLeases(next)).toEqual(withoutLeases(state));
    expect(next.sequence).toBe(state.sequence);
    expect(next.commandBindings).toBe(state.commandBindings);
    expect(snapshot({ ...next, controlLeases: state.controlLeases })).toEqual(snapshot(state));
    expect(Object.isFrozen(next) && Object.isFrozen(next.controlLeases)).toBe(true);
    const same = withControlLease(state, "white", LEASES.white);
    expect(same.ok && same.value).toBe(state);
  });

  it("TST-GACC-CORE-002 two seats never share a lease", () => {
    expect(withControlLease(newGame(), "white", LEASES.black)).toEqual({
      ok: false,
      error: "shared_control_lease",
    });
  });

  it("TST-GACC-CORE-003 after a rotation the old lease is refused before any binding and the new one plays", () => {
    const state = rotated(newGame());
    const stale = submit(newGame(), moveCommand(newGame(), "e2e4"), START_MS + 10);
    expect(stale.response.code).toBe("Accepted");
    const refused = submit(state, moveCommand(newGame(), "e2e4"), START_MS + 10);
    expect(refused.response).toMatchObject({
      code: "Unauthorized",
      detail: "invalid_control_lease",
    });
    expect(refused.nextState).toBe(state);
    const accepted = submit(
      state,
      moveCommand(state, "e2e4", { controlLeaseId: ROTATED_WHITE_LEASE }),
      START_MS + 10,
    );
    expect(accepted.response.code).toBe("Accepted");
  });

  it("TST-GACC-CORE-004 historicalReplay answers an exact resend from the stored binding under the lease it was bound with", () => {
    const s0 = newGame();
    const command = moveCommand(s0, "e2e4");
    const first = submit(s0, command, START_MS + 10);
    expect(first.response.code).toBe("Accepted");
    const later = playMoves(rotated(first.nextState), ["e7e5"], START_MS + 20).state;
    const replay = historicalReplay(later, WHITE, leaseless(command));
    expect(replay).toEqual({
      kind: "replayed",
      response: { ...first.response, replayedResponse: true },
    });
    expect(Object.isFrozen(replay)).toBe(true);
    const withStaleClientLease = { ...leaseless(command), controlLeaseId: ROTATED_WHITE_LEASE };
    expect(historicalReplay(later, WHITE, withStaleClientLease).kind).toBe("replayed");
  });

  it("TST-GACC-CORE-007 an altered payload under a bound id is an identity conflict; an unbound id is not bound", () => {
    const s0 = newGame();
    const command = moveCommand(s0, "e2e4");
    const after = rotated(submit(s0, command, START_MS + 10).nextState);
    const base = leaseless(command);
    expect(historicalReplay(after, WHITE, { ...base, toSquare: "e3" })).toEqual({
      kind: "identity_conflict",
    });
    expect(historicalReplay(after, WHITE, { ...base, promotionPiece: "q" }).kind).toBe(
      "identity_conflict",
    );
    const resign = {
      ...leaseless(resignCommand(s0, "white")),
      clientCommandId: command.clientCommandId,
    };
    expect(historicalReplay(after, WHITE, resign).kind).toBe("identity_conflict");
    expect(historicalReplay(after, WHITE, { ...base, gameId: OTHER_GAME_ID })).toEqual({
      kind: "not_bound",
    });
    expect(historicalReplay(after, WHITE, { ...base, clientCommandId: "white-new" }).kind).toBe(
      "not_bound",
    );
    expect(historicalReplay(after, WHITE, { ...base, clientCommandId: "bad id" }).kind).toBe(
      "not_bound",
    );
  });

  it("TST-GACC-CORE-008 only the player holding the seat reads its bindings", () => {
    const s0 = newGame();
    const command = moveCommand(s0, "e2e4");
    const after = submit(s0, command, START_MS + 10).nextState;
    const base = leaseless(command);
    const black: GameParticipant = { gameId: GAME_ID, playerId: PLAYERS.black, seat: "black" };
    expect(historicalReplay(after, black, base).kind).toBe("not_bound");
    expect(historicalReplay(after, { ...WHITE, playerId: PLAYERS.black }, base).kind).toBe(
      "not_bound",
    );
    expect(historicalReplay(after, { ...WHITE, playerId: STRANGER }, base).kind).toBe("not_bound");
    expect(historicalReplay(after, { ...WHITE, gameId: OTHER_GAME_ID }, base).kind).toBe(
      "not_bound",
    );
    expect(historicalReplay(after, WHITE, { ...base, actorId: STRANGER }).kind).toBe("not_bound");
    expect(historicalReplay(after, WHITE, { ...base, actorId: PLAYERS.white }).kind).toBe(
      "replayed",
    );
  });

  it("TST-GACC-CORE-009 every command kind is rebuilt exactly under its bound lease", () => {
    const s0 = playMoves(newGame(), ["e2e4", "e7e5"]).state;
    const offer = offerCommand(s0, "black");
    const offered = submit(s0, offer, START_MS + 30, "black");
    expect(offered.response.code).toBe("Accepted");
    const respond = respondCommand(offered.nextState, "white", "decline");
    const responded = submit(offered.nextState, respond, START_MS + 40, "white");
    expect(responded.response.code).toBe("Accepted");
    const claim = claimCommand(responded.nextState, "threefold_intended", "g1f3");
    const claimed = submit(responded.nextState, claim, START_MS + 50);
    const resign = resignCommand(claimed.nextState, "black");
    const resigned = submit(claimed.nextState, resign, START_MS + 60, "black");
    expect(resigned.response.code).toBe("Accepted");
    const final = resigned.nextState;
    const black: GameParticipant = { gameId: GAME_ID, playerId: PLAYERS.black, seat: "black" };
    const cases: readonly {
      seat: GameParticipant;
      command: LeaselessCommand;
      response: CommandResponse;
    }[] = [
      { seat: black, command: leaseless(offer), response: offered.response },
      { seat: WHITE, command: leaseless(respond), response: responded.response },
      { seat: WHITE, command: leaseless(claim), response: claimed.response },
      { seat: black, command: leaseless(resign), response: resigned.response },
    ];
    for (const { seat, command, response } of cases) {
      expect(historicalReplay(final, seat, command)).toEqual({
        kind: "replayed",
        response: { ...response, replayedResponse: true },
      });
    }
    expect(historicalReplay(final, WHITE, { ...leaseless(respond), decision: "accept" }).kind).toBe(
      "identity_conflict",
    );
    expect(historicalReplay(final, WHITE, { ...leaseless(respond), offerId: 99 }).kind).toBe(
      "identity_conflict",
    );
    expect(historicalReplay(final, WHITE, { ...leaseless(claim), toSquare: "h3" }).kind).toBe(
      "identity_conflict",
    );
  });

  it("TST-GACC-CORE-010 a stored fingerprint whose lease field is not a lease is a conflict, never a guess", () => {
    const s0 = newGame();
    const command = moveCommand(s0, "e2e4");
    const bound = submit(s0, command, START_MS + 10).nextState;
    const [binding] = bound.commandBindings;
    if (binding === undefined) throw new Error("no binding");
    expect(boundLease(binding.fingerprint)).toBe(LEASES.white);
    expect(boundLease("submit_move.v1 game-1")).toBeNull();
    expect(boundLease("submit_move.v1 game-1 bad/lease e2 e4 -")).toBeNull();
    const damaged: ActiveGameState = {
      ...bound,
      commandBindings: [{ ...binding, fingerprint: "submit_move.v1 game-1" }],
    };
    expect(historicalReplay(damaged, WHITE, leaseless(command)).kind).toBe("identity_conflict");
  });

  it("TST-GACC-CORE-005 planLeaseRotation writes only the lease; anything else is a defect", () => {
    const { state } = playMoves(newGame(), ["e2e4"]);
    const next = rotated(state);
    expect(planLeaseRotation(state, next)).toEqual({
      kind: "control",
      gameId: state.gameId,
      expectedSequence: state.sequence,
      state: next,
    });
    expect(() => planLeaseRotation(state, state)).toThrow(/changed no lease/);
    const bumped = parseGameSequence(state.sequence + 1);
    if (bumped === undefined) throw new Error("no next sequence");
    expect(() => planLeaseRotation(state, { ...next, sequence: bumped })).toThrow(/sequence/);
    expect(() => planLeaseRotation(state, { ...next, commandBindings: [] })).toThrow(/bindings/);
    expect(() => planLeaseRotation(state, { ...next, lastDrawOfferMove: 7 })).toThrow(
      /more than the leases/,
    );
    expect(() => planLeaseRotation(state, { ...next, history: [...next.history] })).toThrow(
      /more than the leases/,
    );
    expect(() =>
      planLeaseRotation(state, {
        ...next,
        controlLeases: { white: LEASES.black, black: LEASES.black },
      }),
    ).toThrow(/shares/);
  });

  it("TST-GACC-CORE-006 a decision that changes a lease is still refused as a defect by planCommit", () => {
    const s0 = newGame();
    const move = submit(s0, moveCommand(s0, "e2e4"), START_MS + 10);
    expect(planCommit(s0, move.nextState, move.events)?.kind).toBe("transition");
    expect(() => planCommit(s0, rotated(move.nextState), move.events)).toThrow(
      /changed a control lease/,
    );
    const bad = submit(s0, moveCommand(s0, "e2e4", { promotionPiece: "q" }), START_MS + 10);
    expect(() => planCommit(s0, rotated(bad.nextState), bad.events)).toThrow();
  });
});
