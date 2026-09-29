/**
 * The time control a challenge asks for. Only what the live game can play
 * today: sudden death, the same whole-second budget for both sides. The live
 * game has no increment yet (LIVE-TIME-INCREMENT-001), so the increment is
 * carried explicitly and must be 0; a later policy widens the bound, never
 * silently drops a value.
 */
export interface TimeControlRequest {
  readonly type: "sudden_death";
  readonly initialMs: number;
  readonly incrementMs: number;
}

export const CHALLENGE_TIME_CONTROL_POLICY = Object.freeze({
  /** One minute. */
  minInitialMs: 60_000,
  /** Three hours: live play only; correspondence is a separate product. */
  maxInitialMs: 10_800_000,
  /** Budgets are whole seconds. */
  initialStepMs: 1_000,
  maxIncrementMs: 0,
});

function isWholeMs(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/** The request, or null when any part is outside the policy (NaN, fractions, and infinities included). */
export function parseTimeControlRequest(
  type: string,
  initialMs: number,
  incrementMs: number,
): TimeControlRequest | null {
  const policy = CHALLENGE_TIME_CONTROL_POLICY;
  if (type !== "sudden_death") return null;
  if (!isWholeMs(initialMs) || !isWholeMs(incrementMs)) return null;
  if (initialMs < policy.minInitialMs || initialMs > policy.maxInitialMs) return null;
  if (initialMs % policy.initialStepMs !== 0) return null;
  if (incrementMs > policy.maxIncrementMs) return null;
  return Object.freeze({ type, initialMs, incrementMs });
}
