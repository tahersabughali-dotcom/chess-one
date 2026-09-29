/**
 * Challenge limits, version 1. Times are UTC wall-clock epoch milliseconds
 * from the server's clock: a challenge lives in wall time, never in a live
 * game writer's monotonic time.
 */
export const CHALLENGE_POLICY = Object.freeze({
  /** A challenge left pending this long expires. */
  ttlMs: 24 * 60 * 60 * 1_000,
  /** Pending challenges one user may have sent at once. */
  maxOutgoingPending: 20,
  /** Pending challenges one user may have received at once: nobody can be flooded. */
  maxIncomingPending: 100,
  defaultPageSize: 20,
  maxPageSize: 50,
  /**
   * The accepted challenge's game must start within this long of the
   * acceptance, or it is aborted before starting (GAME-START-LIFECYCLE-001).
   */
  startDeadlineMs: 10 * 60 * 1_000,
});

export function isWallTimeMs(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function expiresAtFor(createdAt: number): number {
  return createdAt + CHALLENGE_POLICY.ttlMs;
}

/** The game may start while `now < startDeadlineAt`; it is aborted from that instant on. */
export function startDeadlineFor(acceptedAt: number): number {
  return acceptedAt + CHALLENGE_POLICY.startDeadlineMs;
}

/**
 * The one boundary rule: a challenge can be acted on while `now < expiresAt`
 * and is expired from `expiresAt` itself onwards.
 */
export function isExpiredAt(expiresAt: number, now: number): boolean {
  return now >= expiresAt;
}
