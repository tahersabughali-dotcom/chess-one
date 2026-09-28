import { nextGameSequence } from "@chess-one/game-values";
import type { ActiveGameState, PendingDrawOffer } from "./active-game.ts";
import { chargeToReceipt, stopClock } from "./clock.ts";
import type { DrawOfferDecision } from "./commands.ts";
import {
  bindRejection,
  type CommandDecision,
  commitAndBind,
  defect,
  type JudgedAttempt,
} from "./decision.ts";
import { DRAW_AGREED, type GameStatus } from "./result.ts";

/** Only a committed move adds a history key, so this counts moves since the start position. */
function committedMoves(state: ActiveGameState): number {
  return state.history.length - 1;
}

/**
 * CONTRACT_CATALOG_V1 10.2 and article 5.2.3. An offer is allowed only on the
 * opponent's turn after a completed move by the offerer, once each side has
 * moved. Moves alternate, so two committed moves mean both sides have moved,
 * and the seat not to move made the last one. At most one offer is pending; a
 * second offer, from either seat, is not an acceptance.
 *
 * One offer per committed move (LIVE-OFFER-006): the offer records the move
 * count it was based on, and no later offer is allowed on that same count,
 * even after a decline. Only another committed move opens a new opportunity.
 *
 * The committed offer changes nothing but the offer fields and the sequence:
 * the offerer is not the active side, so no clock field changes, and the
 * active side's time keeps running from its turn anchor. No event is emitted.
 */
export function offerDraw(attempt: JudgedAttempt): CommandDecision {
  const { state, actor } = attempt;
  if (state.pendingDrawOffer !== null) {
    return bindRejection(attempt, "InvalidState", "draw_offer_already_pending");
  }
  const moves = committedMoves(state);
  if (moves < 2 || actor.seat === state.position.sideToMove) {
    return bindRejection(attempt, "InvalidState", "draw_offer_not_allowed");
  }
  if (state.lastDrawOfferMove === moves) {
    return bindRejection(attempt, "InvalidState", "draw_offer_already_used_for_move");
  }
  const sequence = nextGameSequence(state.sequence);
  if (!sequence.ok) defect("sequence overflow");
  const offer: PendingDrawOffer = Object.freeze({
    offeredBy: actor.seat,
    offeredTo: state.position.sideToMove,
    createdAtSequence: sequence.value,
  });
  const changes = {
    clock: state.clock,
    status: state.status,
    pendingDrawOffer: offer,
    lastDrawOfferMove: moves,
  };
  return commitAndBind(attempt, changes, "Accepted", null, null);
}

/**
 * CONTRACT_CATALOG_V1 10.3. Only the recipient answers, and only the pending
 * offer named by `offer_id`. The recipient is always the side to move, because
 * any committed move clears the offer.
 * - accept: a draw `draw_agreed`. The recipient is charged to receipt, the
 *   clock stops, and the one `game.finished.v1` is emitted.
 * - decline: the offer is dropped and play continues; no clock field changes.
 * Position and history never change.
 */
export function respondDrawOffer(
  attempt: JudgedAttempt,
  offerId: number,
  decision: DrawOfferDecision,
): CommandDecision {
  const { state, actor } = attempt;
  const offer = state.pendingDrawOffer;
  if (offer === null) return bindRejection(attempt, "InvalidState", "no_pending_draw_offer");
  if (actor.seat !== offer.offeredTo) {
    return bindRejection(attempt, "InvalidState", "not_draw_offer_recipient");
  }
  if (offerId !== offer.createdAtSequence) {
    return bindRejection(attempt, "InvalidState", "draw_offer_id_mismatch");
  }
  if (decision === "decline") {
    const changes = { clock: state.clock, status: state.status, pendingDrawOffer: null };
    return commitAndBind(attempt, changes, "Accepted", null, null);
  }
  const charged = chargeToReceipt(state.clock, attempt.ingress.receivedAtMonotonicMs);
  const status: GameStatus = Object.freeze({ kind: "finished", result: DRAW_AGREED });
  return commitAndBind(attempt, { clock: stopClock(charged), status }, "Accepted", null, null);
}
