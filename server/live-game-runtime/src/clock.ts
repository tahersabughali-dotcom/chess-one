import type { ClockDomainId, MonotonicMs } from "@chess-one/live-game";

/**
 * DEC-061, DEC-063: the writer's monotonic clock, in whole milliseconds. It is
 * the only time source for `received_at`, deadline checks, and the clock view
 * shown to clients. It is never wall clock and never a client or edge stamp.
 */
export interface MonotonicClock {
  now(): MonotonicMs;
}

/**
 * One clock domain: a monotonic clock and the id stored with every commit made
 * on it. Instants of different domains are never compared.
 */
export interface ClockDomain {
  readonly id: ClockDomainId;
  readonly clock: MonotonicClock;
}

export interface WakeHandle {
  cancel(): void;
}

/**
 * Wake-up only. A wake may come early or late; whoever is woken reads the
 * monotonic clock and decides from that reading, never from the fact that it
 * was woken.
 */
export interface WakeScheduler {
  wakeAfter(delayMs: number, wake: () => void): WakeHandle;
}
