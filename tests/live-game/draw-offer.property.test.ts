import { generateLegalMoves } from "@chess-one/chess-rules";
import { oppositeColor, SQUARES } from "@chess-one/game-values";
import type { ActiveGameState, LiveGameCommand, Seat } from "@chess-one/live-game";
import { processDeadline } from "@chess-one/live-game";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  claimCommand,
  moveCommand,
  ms,
  newGame,
  offerCommand,
  resignCommand,
  respondCommand,
  START_MS,
  snapshot,
  submit,
} from "./support/harness.ts";

const RUNS = { numRuns: 100, seed: 20260928 };
const MAX_STEPS = 40;

type Step =
  | { readonly kind: "legal"; readonly pick: number }
  | { readonly kind: "squares"; readonly from: number; readonly to: number }
  | { readonly kind: "offer"; readonly lastMover: boolean }
  | {
      readonly kind: "respond";
      readonly toMove: boolean;
      readonly accept: boolean;
      readonly rightId: boolean;
    }
  | { readonly kind: "claim"; readonly intended: boolean; readonly pick: number }
  | { readonly kind: "stale"; readonly white: boolean }
  | { readonly kind: "replay"; readonly pick: number }
  | { readonly kind: "resign"; readonly white: boolean }
  | { readonly kind: "deadline" };

const pick = fc.nat({ max: 10_000 });
const white = fc.boolean();
/** Mostly true, so that the valid seat is exercised often and the invalid one still occurs. */
const usually = fc.integer({ min: 0, max: 4 }).map((value) => value > 0);
const step: fc.Arbitrary<Step> = fc.oneof(
  { weight: 6, arbitrary: fc.record({ kind: fc.constant("legal"), pick }) },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant("squares"),
      from: fc.nat({ max: 63 }),
      to: fc.nat({ max: 63 }),
    }),
  },
  { weight: 4, arbitrary: fc.record({ kind: fc.constant("offer"), lastMover: usually }) },
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant("respond"),
      toMove: usually,
      accept: fc.integer({ min: 0, max: 3 }).map((value) => value === 0),
      rightId: usually,
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({ kind: fc.constant("claim"), intended: fc.boolean(), pick }),
  },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("stale"), white }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant("replay"), pick }) },
  { weight: 1, arbitrary: fc.constant({ kind: "deadline" as const }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("resign"), white }) },
);
const scenario = fc.record({
  initialMs: fc.constantFrom(4_000, 60_000),
  delays: fc.array(fc.integer({ min: 0, max: 400 }), {
    minLength: MAX_STEPS,
    maxLength: MAX_STEPS,
  }),
  steps: fc.array(step, { minLength: 10, maxLength: MAX_STEPS, size: "max" }),
});

interface Sent {
  readonly command: LiveGameCommand;
  readonly seat: Seat;
}

function legalUci(state: ActiveGameState, index: number): string {
  const moves = generateLegalMoves(state.position);
  const move = moves[index % Math.max(moves.length, 1)];
  return move === undefined ? "a1a2" : `${move.from}${move.to}${move.promotion ?? ""}`;
}

function build(
  state: ActiveGameState,
  current: Exclude<Step, { readonly kind: "deadline" }>,
  index: number,
  sent: readonly Sent[],
): Sent {
  const toMove = state.position.sideToMove;
  const id = { clientCommandId: `p${index}` };
  switch (current.kind) {
    case "legal":
      return { command: moveCommand(state, legalUci(state, current.pick), id), seat: toMove };
    case "squares": {
      const uci = `${SQUARES[current.from] ?? "a1"}${SQUARES[current.to] ?? "a2"}`;
      return { command: moveCommand(state, uci, id), seat: toMove };
    }
    case "offer": {
      const seat = current.lastMover ? oppositeColor(toMove) : toMove;
      return { command: offerCommand(state, seat, id), seat };
    }
    case "respond": {
      const seat = current.toMove ? toMove : oppositeColor(toMove);
      const pending = state.pendingDrawOffer?.createdAtSequence ?? 0;
      const offerId = current.rightId ? pending : pending + 1;
      const decision = current.accept ? "accept" : "decline";
      return { command: respondCommand(state, seat, decision, { ...id, offerId }), seat };
    }
    case "claim": {
      const intended = current.intended ? legalUci(state, current.pick) : undefined;
      const kind = current.intended ? "threefold_intended" : "threefold_current";
      return { command: claimCommand(state, kind, intended, id), seat: toMove };
    }
    case "stale": {
      const seat: Seat = current.white ? "white" : "black";
      const fields = { ...id, expectedGameSequence: state.sequence + 1 };
      return { command: offerCommand(state, seat, fields), seat };
    }
    case "resign": {
      const seat: Seat = current.white ? "white" : "black";
      return { command: resignCommand(state, seat, id), seat };
    }
    case "replay":
      return (
        sent[current.pick % Math.max(sent.length, 1)] ?? {
          command: offerCommand(state, "black", id),
          seat: "black",
        }
      );
  }
}

/** A–B: at most one pending offer, always owned by the seat not to move, and none once stopped. */
function checkOfferShape(state: ActiveGameState): void {
  const offer = state.pendingDrawOffer;
  if (state.status.kind !== "active") {
    expect(offer).toBeNull();
    return;
  }
  if (offer === null) return;
  expect(Object.isFrozen(offer)).toBe(true);
  expect(offer.offeredTo).toBe(state.position.sideToMove);
  expect(offer.offeredBy).not.toBe(offer.offeredTo);
  expect(offer.createdAtSequence).toBeLessThanOrEqual(state.sequence);
  expect(state.history.length - 1).toBeGreaterThanOrEqual(2);
}

describe("TST-LIVE draw offer properties", () => {
  it("TST-LIVE-180 draw offers keep their invariants across random sessions of moves, offers, responses, claims, resignations, and flags", () => {
    const seen = new Set<string>();
    fc.assert(
      fc.property(scenario, ({ initialMs, delays, steps }) => {
        let state = newGame({ initialMs });
        let now = START_MS;
        const sent: Sent[] = [];
        steps.forEach((current, index) => {
          now += delays[index] ?? 0;
          const before = state;
          if (current.kind === "deadline") {
            const decision = processDeadline(before, ms(now));
            if (!decision.flagged) expect(decision.nextState).toBe(before);
            if (decision.flagged && before.pendingDrawOffer !== null) seen.add("flag clears offer");
            checkOfferShape(decision.nextState);
            state = decision.nextState;
            return;
          }
          const outgoing = build(before, current, index, sent);
          const frozen = snapshot(before);
          const decision = submit(before, outgoing.command, now, outgoing.seat);
          const next = decision.nextState;
          const { response } = decision;
          expect(snapshot(before)).toEqual(frozen);
          checkOfferShape(next);

          const pending = before.pendingDrawOffer;
          const committed = next.sequence !== before.sequence;
          const kind = outgoing.command.command;
          // A: a pending offer is never replaced by another one.
          if (pending !== null && next.pendingDrawOffer !== null) {
            expect(next.pendingDrawOffer).toBe(pending);
          }
          // C: an acceptance commits draw_agreed with exactly one event.
          const acceptance =
            kind === "RespondDrawOfferCommand.v1" &&
            outgoing.command.decision === "accept" &&
            response.code === "Accepted" &&
            !response.replayedResponse;
          if (acceptance) {
            expect(next.status).toEqual({
              kind: "finished",
              result: { resultCode: "draw", terminationReason: "draw_agreed" },
            });
            expect(decision.events).toHaveLength(1);
            seen.add("accept");
          }
          if (next.status.kind === "finished" && !committed) expect(decision.events).toEqual([]);
          // D: a replay changes nothing.
          if (response.replayedResponse) {
            expect(next).toBe(before);
            seen.add("replay");
          }
          // E and G: nothing that commits nothing clears the offer, an illegal move included.
          if (!committed) {
            expect(next.pendingDrawOffer).toBe(pending);
            if (pending !== null && !response.replayedResponse) seen.add("rejection keeps offer");
          }
          if (response.code === "IllegalMove") {
            expect(next.pendingDrawOffer).toBe(pending);
            if (pending !== null) seen.add("illegal move keeps offer");
          }
          // F: a committed move clears the offer.
          if (next.history.length > before.history.length) {
            expect(next.pendingDrawOffer).toBeNull();
            if (pending !== null) seen.add("move clears offer");
          }
          // H: offers and responses never change the position or the history.
          if (kind === "OfferDrawCommand.v1" || kind === "RespondDrawOfferCommand.v1") {
            expect(next.position).toBe(before.position);
            expect(next.history).toBe(before.history);
          }
          if (kind === "OfferDrawCommand.v1" && committed && next.pendingDrawOffer !== null) {
            expect(pending).toBeNull();
            expect(next.clock).toBe(before.clock);
            // LIVE-OFFER-006: one offer per committed move.
            expect(before.lastDrawOfferMove).not.toBe(before.history.length - 1);
            expect(next.lastDrawOfferMove).toBe(before.history.length - 1);
            seen.add("offer");
          }
          if (response.detail === "draw_offer_already_used_for_move") {
            expect(before.lastDrawOfferMove).toBe(before.history.length - 1);
            seen.add("offer already used");
          }
          if (next.lastDrawOfferMove !== before.lastDrawOfferMove) {
            expect(kind).toBe("OfferDrawCommand.v1");
          }
          if (kind === "RespondDrawOfferCommand.v1" && committed && next.status.kind === "active") {
            expect(next.pendingDrawOffer).toBeNull();
            expect(next.clock).toBe(before.clock);
            seen.add("decline");
          }
          sent.push(outgoing);
          state = next;
        });
      }),
      RUNS,
    );
    expect([...seen]).toEqual(
      expect.arrayContaining([
        "offer",
        "accept",
        "decline",
        "replay",
        "rejection keeps offer",
        "illegal move keeps offer",
        "move clears offer",
        "flag clears offer",
        "offer already used",
      ]),
    );
  }, 60_000);
});
