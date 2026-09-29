import { formatFen, type RulesetId } from "@chess-one/chess-rules";
import type { Color } from "@chess-one/game-values";
import type { ActiveGameState, GameId, GameStatus, MonotonicMs, Seat } from "@chess-one/live-game";
import { type RecoveryReason, recoveryReasonOf, type WriterCondition } from "./writer-recovery.ts";

/**
 * What a player may see of the authoritative state, for any transport. It
 * leaves out monotonic anchors, command bindings, fingerprints, control
 * leases, player ids, and the clock domain.
 */
export interface GameView {
  readonly gameId: GameId;
  readonly rulesetId: RulesetId;
  readonly sequence: number;
  readonly positionFen: string;
  readonly sideToMove: Color;
  readonly status: GameStatus;
  readonly condition: WriterCondition["kind"];
  /** Set while play waits for an operator recovery. */
  readonly recoveryReason: RecoveryReason | null;
  readonly clock: ClockView;
  readonly pendingDrawOffer: DrawOfferView | null;
}

/**
 * Balances as of the moment the view was taken. While `running`, the active
 * side's balance keeps falling from there; a balance past its deadline that
 * the writer has not yet flagged is shown as 0. Otherwise they are the
 * stored balances of the last durable state.
 */
export interface ClockView {
  /** Each side's budget at the start (sudden death). */
  readonly initialMs: number;
  readonly remainingMs: Readonly<Record<Color, number>>;
  readonly activeSide: Color;
  readonly running: boolean;
}

export interface DrawOfferView {
  readonly offerId: number;
  readonly offeredBy: Seat;
  readonly offeredTo: Seat;
}

function clockView(
  state: ActiveGameState,
  condition: WriterCondition,
  observedAt: MonotonicMs,
): ClockView {
  const { clock } = state;
  const running = condition.kind === "running" && clock.running;
  const remaining: Record<Color, number> = { ...clock.remainingMs };
  if (running) {
    const live = clock.remainingMs[clock.activeSide] - Math.max(0, observedAt - clock.anchorMs);
    remaining[clock.activeSide] = Math.max(0, live);
  }
  return Object.freeze({
    initialMs: clock.timeControl.initialMs,
    remainingMs: Object.freeze(remaining),
    activeSide: clock.activeSide,
    running,
  });
}

/** The view of `state` in `condition`, with running balances read at `observedAt`. */
export function viewOf(
  state: ActiveGameState,
  condition: WriterCondition,
  observedAt: MonotonicMs,
): GameView {
  const offer = state.pendingDrawOffer;
  return Object.freeze({
    gameId: state.gameId,
    rulesetId: state.rulesetId,
    sequence: state.sequence,
    positionFen: formatFen(state.position),
    sideToMove: state.position.sideToMove,
    status: state.status,
    condition: condition.kind,
    recoveryReason: recoveryReasonOf(condition),
    clock: clockView(state, condition, observedAt),
    pendingDrawOffer:
      offer === null
        ? null
        : Object.freeze({
            offerId: offer.createdAtSequence,
            offeredBy: offer.offeredBy,
            offeredTo: offer.offeredTo,
          }),
  });
}
