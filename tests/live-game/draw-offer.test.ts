import {
  type ActiveGameState,
  type CommandDecision,
  fingerprintOf,
  type LiveGameCommand,
  parseCommand,
  processCommand,
  processDeadline,
  type RespondDrawOfferCommandV1,
} from "@chess-one/live-game";
import { describe, expect, it } from "vitest";
import { positionOf } from "../rules/support/positions.ts";
import {
  actorFor,
  at,
  claimCommand,
  INITIAL_MS,
  LEASES,
  moveCommand,
  ms,
  newGame,
  offerCommand,
  PENALTY_MS,
  PLAYERS,
  playMoves,
  REPLACED_LEASE,
  resignCommand,
  respondCommand,
  START_MS,
  STRANGER,
  snapshot,
  submit,
} from "./support/harness.ts";

const OPENING = ["e2e4", "e7e5"];
const OFFER_AT = START_MS + 30;
const RESPOND_AT = START_MS + 50;
/** Position 012's non-terminal predecessor; after b2b3 a8a7 the lone king has moved and White is to move. */
const QUEEN_MATES_NEXT = "k7/2K5/8/8/8/8/1Q6/8 w - - 0 1";
const DRAW_AGREED = { resultCode: "draw", terminationReason: "draw_agreed" };

function fingerprint(command: LiveGameCommand): string {
  const parsed = parseCommand(command);
  if (!parsed.ok) throw new Error(parsed.error);
  return fingerprintOf(parsed.value);
}

function accepted(decision: CommandDecision): ActiveGameState {
  expect(decision.response.code).toBe("Accepted");
  return decision.nextState;
}

/** Each side has moved; Black just moved, so Black may offer and White receives. */
function opened(initialMs = INITIAL_MS): ActiveGameState {
  return playMoves(newGame({ initialMs }), OPENING).state;
}

/** Black's offer is pending, White to move. */
function offered(initialMs = INITIAL_MS): ActiveGameState {
  const game = opened(initialMs);
  return accepted(submit(game, offerCommand(game, "black"), OFFER_AT, "black"));
}

/** K+Q vs K after b2b3 a8a7, with the lone king's offer pending and White to move. */
function queenOffered(initialMs = INITIAL_MS): ActiveGameState {
  const start = newGame({ startPosition: positionOf(QUEEN_MATES_NEXT), initialMs });
  const game = playMoves(start, ["b2b3", "a8a7"]).state;
  return accepted(submit(game, offerCommand(game, "black"), OFFER_AT, "black"));
}

/** A rejection that decides nothing: no committed transition, the offer object kept. */
function expectOfferKept(before: ActiveGameState, decision: CommandDecision): void {
  expect(decision.nextState.pendingDrawOffer).toBe(before.pendingDrawOffer);
  expect(decision.nextState.sequence).toBe(before.sequence);
  expect(decision.nextState.position).toBe(before.position);
  expect(decision.nextState.history).toBe(before.history);
  expect(decision.nextState.clock).toBe(before.clock);
  expect(decision.nextState.status).toBe(before.status);
  expect(decision.events).toEqual([]);
}

describe("TST-LIVE OfferDrawCommand.v1 timing", () => {
  it("TST-LIVE-150 TST-RULE-E01-017a no seat may offer before both sides have moved: InvalidState, no offer", () => {
    const game = newGame();
    for (const seat of ["white", "black"] as const) {
      const decision = submit(game, offerCommand(game, seat), START_MS + 5, seat);
      expect(decision.response).toMatchObject({
        command: "OfferDrawCommand.v1",
        code: "InvalidState",
        detail: "draw_offer_not_allowed",
        sequence: 0,
      });
      expectOfferKept(game, decision);
      expect(decision.nextState.pendingDrawOffer).toBeNull();
      expect(decision.nextState.commandBindings).toHaveLength(1);
    }
    const afterWhite = playMoves(game, ["e2e4"]).state;
    for (const seat of ["white", "black"] as const) {
      const decision = submit(afterWhite, offerCommand(afterWhite, seat), START_MS + 20, seat);
      expect(decision.response.detail).toBe("draw_offer_not_allowed");
      expect(decision.nextState.pendingDrawOffer).toBeNull();
    }
  });

  it("TST-LIVE-151 once both have moved, only the seat that just moved may offer; the side to move may not", () => {
    const game = opened();
    const own = submit(game, offerCommand(game, "white"), OFFER_AT, "white");
    expect(own.response).toMatchObject({ code: "InvalidState", detail: "draw_offer_not_allowed" });
    expectOfferKept(game, own);
    const later = playMoves(game, ["g1f3"], OFFER_AT).state;
    const stale = submit(later, offerCommand(later, "black"), OFFER_AT + 20, "black");
    expect(stale.response.detail).toBe("draw_offer_not_allowed");
    const fresh = submit(later, offerCommand(later, "white"), OFFER_AT + 20, "white");
    expect(fresh.response.code).toBe("Accepted");
  });

  it("TST-LIVE-152 an accepted offer creates the one pending offer and changes nothing else but the sequence and binding", () => {
    const game = opened();
    const command = offerCommand(game, "black");
    const decision = submit(game, command, OFFER_AT, "black");
    const next = decision.nextState;
    expect(decision.response).toMatchObject({
      command: "OfferDrawCommand.v1",
      code: "Accepted",
      detail: null,
      san: null,
      sequence: 3,
      replayedResponse: false,
    });
    expect(next.pendingDrawOffer).toEqual({
      offeredBy: "black",
      offeredTo: "white",
      createdAtSequence: 3,
    });
    expect(Object.isFrozen(next.pendingDrawOffer)).toBe(true);
    expect(Object.isFrozen(next)).toBe(true);
    expect(next.sequence).toBe(game.sequence + 1);
    expect(next.clock).toBe(game.clock);
    expect(next.position).toBe(game.position);
    expect(next.history).toBe(game.history);
    expect(next.status).toBe(game.status);
    expect(next.position.sideToMove).toBe("white");
    expect(decision.events).toEqual([]);
    expect(next.commandBindings).toHaveLength(game.commandBindings.length + 1);
    expect(next.commandBindings.at(-1)?.response).toBe(decision.response);
  });

  it("TST-LIVE-153 a second offer while one is pending is rejected from either seat; the recipient's offer is not an acceptance", () => {
    const game = offered();
    const again = submit(
      game,
      offerCommand(game, "black", { clientCommandId: "black-again" }),
      RESPOND_AT,
      "black",
    );
    expect(again.response).toMatchObject({
      code: "InvalidState",
      detail: "draw_offer_already_pending",
    });
    expectOfferKept(game, again);
    const recipient = submit(game, offerCommand(game, "white"), RESPOND_AT, "white");
    expect(recipient.response).toMatchObject({
      code: "InvalidState",
      detail: "draw_offer_already_pending",
    });
    expectOfferKept(game, recipient);
    expect(recipient.nextState.status.kind).toBe("active");
  });

  it("TST-LIVE-154 an offer received after the active side's deadline commits that flag and creates no offer", () => {
    const game = opened(1_000);
    const deadline = START_MS + 20 + (1_000 - 10);
    const late = submit(game, offerCommand(game, "black"), deadline + 1, "black");
    expect(late.response).toMatchObject({ code: "MoveReceivedAfterDeadline", sequence: 3 });
    expect(late.nextState.pendingDrawOffer).toBeNull();
    expect(late.nextState.status).toEqual({
      kind: "unresolved",
      reason: "MATING_POSSIBILITY_UNRESOLVED",
      flaggedSide: "white",
    });
  });
});

describe("TST-LIVE RespondDrawOfferCommand.v1", () => {
  it("TST-LIVE-155 TST-RULE-E01-017b after each side has moved, an offer then an acceptance ends the game draw_agreed, once", () => {
    const game = offered();
    const command = respondCommand(game, "white", "accept");
    expect(command.offerId).toBe(3);
    const decision = submit(game, command, RESPOND_AT, "white");
    const next = decision.nextState;
    expect(decision.response).toMatchObject({
      command: "RespondDrawOfferCommand.v1",
      code: "Accepted",
      detail: null,
      san: null,
      sequence: 4,
    });
    expect(next.status).toEqual({ kind: "finished", result: DRAW_AGREED });
    expect(next.pendingDrawOffer).toBeNull();
    expect(next.position).toBe(game.position);
    expect(next.history).toBe(game.history);
    expect(next.clock).toMatchObject({
      remainingMs: { white: INITIAL_MS - 10 - 30, black: INITIAL_MS - 10 },
      activeSide: "white",
      running: false,
      anchorMs: RESPOND_AT,
    });
    expect(decision.events).toHaveLength(1);
    expect(decision.events[0]).toMatchObject({
      gameSequence: 4,
      result: DRAW_AGREED,
      provenance: {
        command: "RespondDrawOfferCommand.v1",
        seat: "white",
        clientCommandId: command.clientCommandId,
      },
    });

    const replay = submit(next, command, RESPOND_AT + 100, "white");
    expect(replay.response).toEqual({ ...decision.response, replayedResponse: true });
    expect(replay.nextState).toBe(next);
    expect(replay.events).toEqual([]);
  });

  it("TST-LIVE-156 the offerer cannot answer its own offer, in either direction", () => {
    const game = offered();
    for (const decision of ["accept", "decline"]) {
      const own = submit(game, respondCommand(game, "black", decision), RESPOND_AT, "black");
      expect(own.response).toMatchObject({
        code: "InvalidState",
        detail: "not_draw_offer_recipient",
      });
      expectOfferKept(game, own);
      expect(own.nextState.commandBindings).toHaveLength(game.commandBindings.length + 1);
    }
  });

  it("TST-LIVE-157 an explicit decline drops the offer; play, position, history, and clock continue unchanged", () => {
    const game = offered();
    const command = respondCommand(game, "white", "decline");
    const decision = submit(game, command, RESPOND_AT, "white");
    const next = decision.nextState;
    expect(decision.response).toMatchObject({ code: "Accepted", sequence: 4, san: null });
    expect(next.pendingDrawOffer).toBeNull();
    expect(next.status).toBe(game.status);
    expect(next.clock).toBe(game.clock);
    expect(next.position).toBe(game.position);
    expect(next.history).toBe(game.history);
    expect(decision.events).toEqual([]);

    const before = snapshot(next);
    const replay = submit(next, command, RESPOND_AT + 10, "white");
    expect(replay.response).toEqual({ ...decision.response, replayedResponse: true });
    expect(replay.nextState).toBe(next);
    expect(replay.events).toEqual([]);
    expect(snapshot(next)).toEqual(before);

    const move = submit(next, moveCommand(next, "g1f3"), RESPOND_AT + 20, "white");
    expect(move.response).toMatchObject({ code: "Accepted", san: "Nf3" });
  });

  it("TST-LIVE-158 a response with no pending offer, or naming another offer, is InvalidState and decides nothing", () => {
    const game = opened();
    const none = submit(game, respondCommand(game, "white", "accept"), RESPOND_AT, "white");
    expect(none.response).toMatchObject({ code: "InvalidState", detail: "no_pending_draw_offer" });
    expectOfferKept(game, none);

    const declined = accepted(
      submit(offered(), respondCommand(offered(), "white", "decline"), RESPOND_AT, "white"),
    );
    const moved = playMoves(declined, ["g1f3", "b8c6"], RESPOND_AT).state;
    const again = accepted(submit(moved, offerCommand(moved, "black"), RESPOND_AT + 30, "black"));
    expect(again.pendingDrawOffer?.createdAtSequence).toBe(7);
    const old = submit(
      again,
      respondCommand(again, "white", "accept", { offerId: 3 }),
      RESPOND_AT + 20,
      "white",
    );
    expect(old.response).toMatchObject({ code: "InvalidState", detail: "draw_offer_id_mismatch" });
    expectOfferKept(again, old);
    const current = submit(again, respondCommand(again, "white", "accept"), RESPOND_AT + 20);
    expect(current.nextState.status).toEqual({ kind: "finished", result: DRAW_AGREED });
  });

  it("TST-LIVE-159 malformed responses are unbound shape errors", () => {
    const game = offered();
    const cases = [
      [{ offerId: -1 }, "malformed_offer_id"],
      [{ offerId: 2.5 }, "malformed_offer_id"],
      [{ decision: "maybe" }, "unknown_draw_offer_decision"],
      [{ decision: "Accept" }, "unknown_draw_offer_decision"],
    ] as const;
    for (const [fields, detail] of cases) {
      const decision = submit(game, respondCommand(game, "white", "accept", fields), RESPOND_AT);
      expect(decision.response).toMatchObject({ code: "InvalidState", detail });
      expect(decision.nextState).toBe(game);
    }
  });
});

describe("TST-LIVE draw offer and moves", () => {
  it("TST-LIVE-160 TST-RULE-E01-017c the recipient's legal move declines the offer in the same transition", () => {
    const game = offered();
    const decision = submit(game, moveCommand(game, "g1f3"), RESPOND_AT);
    const next = decision.nextState;
    expect(decision.response).toMatchObject({ code: "Accepted", san: "Nf3", sequence: 4 });
    expect(next.pendingDrawOffer).toBeNull();
    expect(next.sequence).toBe(game.sequence + 1);
    expect(next.history).toHaveLength(game.history.length + 1);
    expect(next.status.kind).toBe("active");
    expect(next.clock).toMatchObject({ activeSide: "black", running: true, anchorMs: RESPOND_AT });
    expect(decision.events).toEqual([]);
    expect(next.commandBindings).toHaveLength(game.commandBindings.length + 1);
  });

  it("TST-LIVE-161 TST-RULE-E01-017c the declining move is judged on its own: a mating reply is checkmate, not a draw", () => {
    const game = playMoves(newGame(), ["f2f3", "e7e5", "g2g4"]).state;
    const pending = accepted(submit(game, offerCommand(game, "white"), OFFER_AT, "white"));
    const mate = submit(pending, moveCommand(pending, "d8h4"), RESPOND_AT);
    expect(mate.response).toMatchObject({ code: "Accepted", san: "Qh4#" });
    expect(mate.nextState.status).toEqual({
      kind: "finished",
      result: { resultCode: "black_win", terminationReason: "checkmate", winner: "black" },
    });
    expect(mate.nextState.pendingDrawOffer).toBeNull();
    expect(mate.events).toHaveLength(1);
    expect(mate.events[0]?.result.terminationReason).toBe("checkmate");
  });

  it("TST-LIVE-162 an illegal move by the recipient keeps the offer", () => {
    const game = offered();
    const decision = submit(game, moveCommand(game, "e4e5"), RESPOND_AT);
    expect(decision.response).toMatchObject({ code: "IllegalMove", detail: "illegal_move" });
    expectOfferKept(game, decision);
    const accept = submit(decision.nextState, respondCommand(game, "white", "accept"), RESPOND_AT);
    expect(accept.nextState.status).toEqual({ kind: "finished", result: DRAW_AGREED });
  });

  it("TST-LIVE-163 the offer survives every rejection that commits nothing", () => {
    let state = offered();
    const offer = state.pendingDrawOffer;
    const respond = (id: string, fields: Partial<RespondDrawOfferCommandV1> = {}) =>
      respondCommand(state, "white", "accept", { clientCommandId: id, ...fields });
    const cases: readonly [string, () => CommandDecision][] = [
      [
        "Unauthorized",
        () =>
          processCommand(
            state,
            { ...actorFor(state, "white"), playerId: STRANGER },
            respond("u1"),
            at(RESPOND_AT),
          ),
      ],
      [
        "Unauthorized",
        () => submit(state, respond("u2", { controlLeaseId: REPLACED_LEASE }), RESPOND_AT),
      ],
      ["Unauthorized", () => submit(state, respond("u3", { actorId: PLAYERS.black }), RESPOND_AT)],
      [
        "StaleSequence",
        () => submit(state, respond("s1", { expectedGameSequence: 9 }), RESPOND_AT),
      ],
      ["InvalidState", () => submit(state, respond("i1", { contractVersion: "2" }), RESPOND_AT)],
      ["InvalidCommandIdentity", () => submit(state, respond("white-0-e2e4"), RESPOND_AT)],
      [
        "NotYourTurn",
        () =>
          submit(
            state,
            moveCommand(state, "d7d5", {
              clientCommandId: "black-move",
              controlLeaseId: LEASES.black,
            }),
            RESPOND_AT,
            "black",
          ),
      ],
      ["IllegalMove", () => submit(state, moveCommand(state, "a1a5"), RESPOND_AT)],
      ["InvalidState", () => submit(state, respond("m1", { offerId: 2 }), RESPOND_AT)],
      [
        "InvalidState",
        () => submit(state, respondCommand(state, "black", "accept"), RESPOND_AT, "black"),
      ],
    ];
    for (const [code, run] of cases) {
      const decision = run();
      expect(decision.response.code).toBe(code);
      expectOfferKept(state, decision);
      expect(decision.nextState.pendingDrawOffer).toBe(offer);
      state = decision.nextState;
    }
    const accept = submit(state, respondCommand(state, "white", "accept"), RESPOND_AT + 1);
    expect(accept.nextState.status).toEqual({ kind: "finished", result: DRAW_AGREED });
  });
});

describe("TST-LIVE draw offer and claims", () => {
  it("TST-LIVE-164 a correct claim by the recipient finishes the game by the claim and drops the offer", () => {
    const plies = ["g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1"];
    const game = playMoves(newGame(), plies).state;
    const pending = accepted(submit(game, offerCommand(game, "white"), OFFER_AT + 100, "white"));
    const claim = submit(
      pending,
      claimCommand(pending, "threefold_intended", "f6g8"),
      RESPOND_AT + 100,
    );
    expect(claim.response.code).toBe("Accepted");
    expect(claim.nextState.status).toEqual({
      kind: "finished",
      result: {
        resultCode: "draw",
        terminationReason: "draw_rule",
        drawRuleDetails: ["threefold_claim"],
      },
    });
    expect(claim.nextState.pendingDrawOffer).toBeNull();
    expect(claim.events).toHaveLength(1);
  });

  it("TST-LIVE-165 an incorrect current claim keeps the offer; the penalty is still committed", () => {
    const game = offered();
    const claim = submit(game, claimCommand(game, "threefold_current"), RESPOND_AT);
    expect(claim.response).toMatchObject({ code: "IncorrectClaim", sequence: 4 });
    expect(claim.nextState.pendingDrawOffer).toBe(game.pendingDrawOffer);
    expect(claim.nextState.clock.remainingMs.black).toBe(game.clock.remainingMs.black + PENALTY_MS);
    expect(claim.nextState.position).toBe(game.position);
    const next = claim.nextState;
    const accept = submit(next, respondCommand(next, "white", "accept"), RESPOND_AT + 10);
    expect(accept.response.code).toBe("Accepted");
  });

  it("TST-LIVE-166 an incorrect intended claim whose legal move is applied declines the offer in that one transition", () => {
    const game = offered();
    const claim = submit(game, claimCommand(game, "threefold_intended", "g1f3"), RESPOND_AT);
    expect(claim.response).toMatchObject({ code: "IncorrectClaim", san: "Nf3", sequence: 4 });
    expect(claim.nextState.pendingDrawOffer).toBeNull();
    expect(claim.nextState.history).toHaveLength(game.history.length + 1);
  });

  it("TST-LIVE-167 an incorrect intended claim with an illegal move keeps the offer", () => {
    const game = offered();
    const claim = submit(game, claimCommand(game, "threefold_intended", "e4e5"), RESPOND_AT);
    expect(claim.response).toMatchObject({ code: "IllegalMove", sequence: 4 });
    expect(claim.nextState.pendingDrawOffer).toBe(game.pendingDrawOffer);
    expect(claim.nextState.position).toBe(game.position);
    expect(claim.nextState.history).toBe(game.history);
  });
});

describe("TST-LIVE draw offer and stops", () => {
  it("TST-LIVE-168 a resignation takes precedence over a pending offer and is never turned into draw_agreed", () => {
    const game = queenOffered();
    const offerer = submit(game, resignCommand(game, "black"), RESPOND_AT, "black");
    expect(offerer.nextState.status).toEqual({
      kind: "finished",
      result: { resultCode: "white_win", terminationReason: "resignation", winner: "white" },
    });
    expect(offerer.nextState.pendingDrawOffer).toBeNull();
    expect(offerer.events).toHaveLength(1);

    const recipient = submit(game, resignCommand(game, "white"), RESPOND_AT, "white");
    expect(recipient.nextState.status).toEqual({
      kind: "finished",
      result: {
        resultCode: "draw",
        terminationReason: "draw_rule",
        drawRuleDetails: ["resign_no_mate_possible"],
      },
    });
    expect(recipient.nextState.pendingDrawOffer).toBeNull();
  });

  it("TST-LIVE-169 an UNKNOWN resignation leaves the game unresolved and no actionable offer", () => {
    const game = offered();
    const decision = submit(game, resignCommand(game, "black"), RESPOND_AT, "black");
    expect(decision.nextState.status).toEqual({
      kind: "unresolved",
      reason: "MATING_POSSIBILITY_UNRESOLVED",
      resigningSide: "black",
    });
    expect(decision.nextState.pendingDrawOffer).toBeNull();
    expect(decision.events).toEqual([]);
    const accept = submit(decision.nextState, respondCommand(game, "white", "accept"), RESPOND_AT);
    expect(accept.response.code).toBe("MatingPossibilityUnresolved");
    expect(accept.nextState).toBe(decision.nextState);
  });

  it("TST-LIVE-170 a flag decides the game and clears the offer; acceptance after the flag creates no draw", () => {
    const game = queenOffered(1_000);
    const deadline = START_MS + 20 + (1_000 - 10);
    const flag = processDeadline(game, ms(deadline + 1));
    const timeoutDraw = {
      kind: "finished",
      result: {
        resultCode: "draw",
        terminationReason: "draw_rule",
        drawRuleDetails: ["timeout_no_mate"],
      },
    };
    expect(flag.nextState.status).toEqual(timeoutDraw);
    expect(flag.nextState.pendingDrawOffer).toBeNull();
    expect(flag.events).toHaveLength(1);
    const afterFlag = submit(flag.nextState, respondCommand(game, "white", "accept"), deadline + 2);
    expect(afterFlag.response.code).toBe("GameAlreadyFinished");
    expect(afterFlag.nextState).toBe(flag.nextState);

    const lateAccept = submit(game, respondCommand(game, "white", "accept"), deadline + 1);
    expect(lateAccept.response.code).toBe("MoveReceivedAfterDeadline");
    expect(lateAccept.nextState.status).toEqual(timeoutDraw);
    expect(lateAccept.nextState.pendingDrawOffer).toBeNull();
    expect(lateAccept.events[0]?.result).toEqual(timeoutDraw.result);

    const onTime = submit(game, respondCommand(game, "white", "accept"), deadline);
    expect(onTime.nextState.status).toEqual({ kind: "finished", result: DRAW_AGREED });
  });

  it("TST-LIVE-171 an unresolved flag clears the offer", () => {
    const game = offered(1_000);
    const flag = processDeadline(game, ms(START_MS + 20 + 990 + 1));
    expect(flag.nextState.status).toMatchObject({
      kind: "unresolved",
      reason: "MATING_POSSIBILITY_UNRESOLVED",
      flaggedSide: "white",
    });
    expect(flag.nextState.pendingDrawOffer).toBeNull();
    expect(flag.events).toEqual([]);
  });

  it("TST-LIVE-172 after the game finishes, new offers and responses are GameAlreadyFinished and bind nothing; stored ones still replay", () => {
    const game = offered();
    const offer = offerCommand(opened(), "black");
    const accept = respondCommand(game, "white", "accept");
    const finished = accepted(submit(game, accept, RESPOND_AT, "white"));
    const fresh: readonly [LiveGameCommand, "white" | "black"][] = [
      [offerCommand(finished, "black", { clientCommandId: "black-late-offer" }), "black"],
      [offerCommand(finished, "white", { clientCommandId: "white-late-offer" }), "white"],
      [respondCommand(finished, "white", "decline", { clientCommandId: "white-late" }), "white"],
    ];
    for (const [command, seat] of fresh) {
      const decision = submit(finished, command, RESPOND_AT + 10, seat);
      expect(decision.response).toMatchObject({
        code: "GameAlreadyFinished",
        replayedResponse: false,
      });
      expect(decision.nextState).toBe(finished);
      expect(decision.events).toEqual([]);
    }
    const offerReplay = submit(finished, offer, RESPOND_AT + 20, "black");
    expect(offerReplay.response).toMatchObject({ code: "Accepted", replayedResponse: true });
    expect(offerReplay.nextState).toBe(finished);
    const acceptReplay = submit(finished, accept, RESPOND_AT + 20, "white");
    expect(acceptReplay.response).toMatchObject({ code: "Accepted", replayedResponse: true });
    expect(acceptReplay.events).toEqual([]);
  });
});

describe("TST-LIVE LIVE-OFFER-006 one draw offer per committed move", () => {
  function declined(): ActiveGameState {
    const game = offered();
    return accepted(submit(game, respondCommand(game, "white", "decline"), RESPOND_AT, "white"));
  }

  it("TST-LIVE-176 after a decline, the offerer may not offer again before another move is committed", () => {
    const game = declined();
    expect(game.lastDrawOfferMove).toBe(2);
    const again = submit(
      game,
      offerCommand(game, "black", { clientCommandId: "black-again" }),
      RESPOND_AT + 10,
      "black",
    );
    expect(again.response).toMatchObject({
      code: "InvalidState",
      detail: "draw_offer_already_used_for_move",
    });
    expectOfferKept(game, again);
    expect(again.nextState.pendingDrawOffer).toBeNull();
    expect(again.nextState.lastDrawOfferMove).toBe(2);
    expect(again.nextState.commandBindings).toHaveLength(game.commandBindings.length + 1);
  });

  it("TST-LIVE-177 the decline does not reset the marker; the recipient's move opens an offer for the new last mover only", () => {
    const game = declined();
    const moved = playMoves(game, ["g1f3"], RESPOND_AT).state;
    expect(moved.lastDrawOfferMove).toBe(2);
    const stale = submit(moved, offerCommand(moved, "black"), RESPOND_AT + 20, "black");
    expect(stale.response.detail).toBe("draw_offer_not_allowed");
    const white = submit(moved, offerCommand(moved, "white"), RESPOND_AT + 20, "white");
    expect(white.response.code).toBe("Accepted");
    expect(white.nextState.lastDrawOfferMove).toBe(3);
    expect(white.nextState.pendingDrawOffer).toMatchObject({ offeredBy: "white" });
  });

  it("TST-LIVE-178 the original offerer may offer again after completing another legal move", () => {
    const game = declined();
    const moved = playMoves(game, ["g1f3", "b8c6"], RESPOND_AT).state;
    const offer = submit(moved, offerCommand(moved, "black"), RESPOND_AT + 30, "black");
    expect(offer.response.code).toBe("Accepted");
    expect(offer.nextState.lastDrawOfferMove).toBe(4);
    const accept = submit(
      offer.nextState,
      respondCommand(offer.nextState, "white", "accept"),
      RESPOND_AT + 40,
    );
    expect(accept.nextState.status).toEqual({ kind: "finished", result: DRAW_AGREED });
    expect(accept.events).toHaveLength(1);
  });

  it("TST-LIVE-179 the original offer still replays after the decline, and acceptance and terminal behaviour are unchanged", () => {
    const opening = opened();
    const original = offerCommand(opening, "black");
    const first = submit(opening, original, OFFER_AT, "black");
    const game = declined();
    const replay = submit(game, original, RESPOND_AT + 10, "black");
    expect(replay.response).toEqual({ ...first.response, replayedResponse: true });
    expect(replay.nextState).toBe(game);

    const agreed = submit(offered(), respondCommand(offered(), "white", "accept"), RESPOND_AT);
    expect(agreed.nextState.status).toEqual({ kind: "finished", result: DRAW_AGREED });
    expect(agreed.nextState.lastDrawOfferMove).toBe(2);
    const late = submit(
      agreed.nextState,
      offerCommand(agreed.nextState, "black", { clientCommandId: "black-late" }),
      RESPOND_AT + 10,
      "black",
    );
    expect(late.response.code).toBe("GameAlreadyFinished");
    expect(late.nextState).toBe(agreed.nextState);
  });
});

describe("TST-LIVE draw offer identity", () => {
  it("TST-LIVE-173 an offer is created once: an exact replay returns the stored response and adds no sequence", () => {
    const game = opened();
    const command = offerCommand(game, "black");
    const first = submit(game, command, OFFER_AT, "black");
    const pending = first.nextState;
    const before = snapshot(pending);
    for (const retry of [command, { ...command, expectedGameSequence: 9, clientObservedAt: 7 }]) {
      const replay = submit(pending, retry, OFFER_AT + 10, "black");
      expect(replay.response).toEqual({ ...first.response, replayedResponse: true });
      expect(replay.nextState).toBe(pending);
      expect(replay.events).toEqual([]);
    }
    expect(snapshot(pending)).toEqual(before);
    expect(pending.sequence).toBe(3);
  });

  it("TST-LIVE-174 the same command id with a different command is InvalidCommandIdentity", () => {
    const game = offered();
    const offerId = offerCommand(opened(), "black").clientCommandId;
    const respond = respondCommand(game, "black", "accept", { clientCommandId: offerId });
    const conflict = submit(game, respond, RESPOND_AT, "black");
    expect(conflict.response).toMatchObject({ code: "InvalidCommandIdentity" });
    expect(conflict.nextState).toBe(game);

    const decline = respondCommand(game, "white", "decline", { clientCommandId: "white-answer" });
    const declined = accepted(submit(game, decline, RESPOND_AT, "white"));
    const flipped = submit(declined, { ...decline, decision: "accept" }, RESPOND_AT + 1, "white");
    expect(flipped.response.code).toBe("InvalidCommandIdentity");
    expect(flipped.nextState).toBe(declined);
  });

  it("TST-LIVE-175 fingerprints: an offer binds version, game, and lease; a response adds offer_id and decision", () => {
    const game = offered();
    const offer = offerCommand(game, "black");
    expect(fingerprint(offer)).toBe(`OfferDrawCommand.v1 ${game.gameId} ${LEASES.black}`);
    const echoed = { actorId: PLAYERS.black, clientObservedAt: 5, expectedGameSequence: 8 };
    expect(fingerprint({ ...offer, ...echoed })).toBe(fingerprint(offer));
    expect(fingerprint({ ...offer, controlLeaseId: REPLACED_LEASE })).not.toBe(fingerprint(offer));

    const accept = respondCommand(game, "white", "accept");
    expect(fingerprint(accept)).toBe(
      `RespondDrawOfferCommand.v1 ${game.gameId} ${LEASES.white} 3 accept`,
    );
    expect(fingerprint({ ...accept, actorId: PLAYERS.white, clientObservedAt: 1 })).toBe(
      fingerprint(accept),
    );
    expect(fingerprint({ ...accept, decision: "decline" })).not.toBe(fingerprint(accept));
    expect(fingerprint({ ...accept, offerId: 5 })).not.toBe(fingerprint(accept));
    const stored = submit(game, accept, RESPOND_AT).nextState.commandBindings.at(-1);
    expect(stored?.fingerprint).toBe(fingerprint(accept));
  });
});
