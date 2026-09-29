import {
  isClockDomainId,
  isMonotonicMs,
  isWallClockMs,
  type MonotonicMs,
  type WallClockMs,
} from "@chess-one/live-game";
import type { ClockDomain, WakeHandle, WakeScheduler, WallClock } from "./clock.ts";

/**
 * The runtime's only contact with the host's clock and timers. The boundary
 * checker allows `process.hrtime`, `crypto.randomUUID`, `Date.now`,
 * `setTimeout`, and `clearTimeout` in this file and nowhere else in the
 * runtime.
 */

const NANOS_PER_MS = 1_000_000n;

/** Node's timers cap a delay at 2^31 - 1 ms; a longer wait is re-armed on wake. */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

function systemDefect(message: string): never {
  throw new Error(`Runtime system defect: ${message}`);
}

/**
 * A new clock domain on `process.hrtime.bigint()`: integer nanoseconds that
 * never go backwards and ignore wall-clock changes. Readings are whole
 * milliseconds since the domain was created, rounded down, so they start at 0
 * and stay exact integers. The id is random, so no restart reuses it.
 */
export function createSystemClockDomain(): ClockDomain {
  const id = `boot-${crypto.randomUUID()}`;
  if (!isClockDomainId(id)) systemDefect("clock domain id");
  const origin = process.hrtime.bigint();
  return Object.freeze({
    id,
    clock: Object.freeze({
      now(): MonotonicMs {
        const ms = Number((process.hrtime.bigint() - origin) / NANOS_PER_MS);
        return isMonotonicMs(ms) ? ms : systemDefect("monotonic reading");
      },
    }),
  });
}

/** The host's UTC wall clock, in whole epoch milliseconds, for the start deadline only. */
export function createSystemWallClock(): WallClock {
  return Object.freeze({
    now(): WallClockMs {
      const ms = Date.now();
      return isWallClockMs(ms) ? ms : systemDefect("wall-clock reading");
    },
  });
}

export function createSystemWakeScheduler(): WakeScheduler {
  return Object.freeze({
    wakeAfter(delayMs: number, wake: () => void): WakeHandle {
      const delay = Math.min(Math.max(0, Math.ceil(delayMs)), MAX_TIMER_DELAY_MS);
      const timer = setTimeout(wake, delay);
      return Object.freeze({ cancel: () => clearTimeout(timer) });
    },
  });
}
