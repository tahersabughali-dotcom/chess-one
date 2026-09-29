import type { ActiveGameState } from "./active-game.ts";
import type { MonotonicMs, WallClockMs } from "./clock.ts";
import { commit } from "./decision.ts";
import { ACTIVE } from "./result.ts";

/**
 * The start deadline rule: a game awaiting its players may start while
 * `now < startDeadlineAtWallMs` and is aborted from the deadline itself on.
 */
export function isStartDeadlinePassed(
  startDeadlineAtWallMs: WallClockMs,
  now: WallClockMs,
): boolean {
  return now >= startDeadlineAtWallMs;
}

/**
 * One lifecycle transition of a game awaiting its players, decided by the
 * writer alone:
 * - `started`: sequence 0 to 1, the clock of the first side to move running
 *   from `startedAt`, the writer's monotonic instant of the start;
 * - `aborted`: the start deadline has passed; sequence 0 to 1, the clock
 *   stays stopped, and there is no result;
 * - `not_awaiting`: the game already started or was aborted; nothing changes.
 */
export type LifecycleDecision =
  | { readonly kind: "started"; readonly nextState: ActiveGameState }
  | { readonly kind: "aborted"; readonly nextState: ActiveGameState }
  | { readonly kind: "not_awaiting" };

function aborted(state: ActiveGameState, deadline: WallClockMs): LifecycleDecision {
  return Object.freeze({
    kind: "aborted",
    nextState: commit(state, {
      clock: state.clock,
      status: Object.freeze({
        kind: "aborted_before_start",
        reason: "START_DEADLINE_PASSED",
        startDeadlineAtWallMs: deadline,
      }),
    }),
  });
}

/**
 * Starts a game both of whose players are ready. The deadline is checked
 * here, in the same decision, so a ready that lands at or after it aborts
 * instead of starting. Readiness itself is the writer's to verify.
 */
export function startAwaitingGame(
  state: ActiveGameState,
  startedAt: MonotonicMs,
  now: WallClockMs,
): LifecycleDecision {
  const { status } = state;
  if (status.kind !== "awaiting_players") return Object.freeze({ kind: "not_awaiting" });
  if (isStartDeadlinePassed(status.startDeadlineAtWallMs, now)) {
    return aborted(state, status.startDeadlineAtWallMs);
  }
  return Object.freeze({
    kind: "started",
    nextState: commit(state, {
      clock: Object.freeze({ ...state.clock, running: true, anchorMs: startedAt }),
      status: ACTIVE,
    }),
  });
}

/** Aborts a game still awaiting its players once its start deadline has passed; else null. */
export function abortIfStartDeadlinePassed(
  state: ActiveGameState,
  now: WallClockMs,
): ActiveGameState | null {
  const { status } = state;
  if (status.kind !== "awaiting_players") return null;
  if (!isStartDeadlinePassed(status.startDeadlineAtWallMs, now)) return null;
  const decision = aborted(state, status.startDeadlineAtWallMs);
  return decision.kind === "aborted" ? decision.nextState : null;
}
