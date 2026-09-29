import {
  isWallClockMs,
  type MonotonicClock,
  type MonotonicMs,
  type WakeHandle,
  type WakeScheduler,
  type WallClock,
  type WallClockMs,
} from "@chess-one/live-game-runtime";
import { ms } from "../../live-game/support/harness.ts";

/** 2030-01-01T00:00:00Z: an arbitrary UTC wall-clock start for runtime tests. */
export const RUNTIME_WALL_START = 1_893_456_000_000;

export function wallMs(value: number): WallClockMs {
  if (!isWallClockMs(value)) throw new Error(`invalid wall time ${value}`);
  return value;
}

/** The runtime's UTC wall clock, set by hand. Unlike a monotonic clock it may be stepped back. */
export class ManualWallTime implements WallClock {
  #now: number;

  constructor(start = RUNTIME_WALL_START) {
    this.#now = start;
  }

  now(): WallClockMs {
    return wallMs(this.#now);
  }

  set(value: number): void {
    this.#now = value;
  }

  advance(delta: number): void {
    this.#now += delta;
  }
}

/** A runtime wall clock that reads another wall clock (an accounts or challenge clock). */
export function wallClockOf(source: { now(): number }): WallClock {
  return { now: () => wallMs(source.now()) };
}

/** A writer clock the test sets by hand. It never goes backwards. */
export class ManualClock implements MonotonicClock {
  #now: number;
  /** Readings taken so far, so a test can prove a path read no clock. */
  reads = 0;

  constructor(start: number) {
    this.#now = start;
  }

  now(): MonotonicMs {
    this.reads += 1;
    return ms(this.#now);
  }

  set(value: number): void {
    if (value < this.#now) throw new Error("a monotonic clock cannot go backwards");
    this.#now = value;
  }

  advance(delta: number): void {
    this.set(this.#now + delta);
  }
}

export interface ManualWake {
  readonly delayMs: number;
  readonly wake: () => void;
  cancelled: boolean;
  fired: boolean;
}

/**
 * Wake-ups fire only when the test says so, early, late, or on time, which is
 * exactly the freedom a real timer has.
 */
export class ManualScheduler implements WakeScheduler {
  readonly wakes: ManualWake[] = [];

  wakeAfter(delayMs: number, wake: () => void): WakeHandle {
    const entry: ManualWake = { delayMs, wake, cancelled: false, fired: false };
    this.wakes.push(entry);
    return {
      cancel: () => {
        entry.cancelled = true;
      },
    };
  }

  pending(): readonly ManualWake[] {
    return this.wakes.filter((entry) => !entry.cancelled && !entry.fired);
  }

  /** The only pending wake whose delay is not `excludeDelay`; fails unless exactly one. */
  single(excludeDelay?: number): ManualWake {
    const matching = this.pending().filter((entry) => entry.delayMs !== excludeDelay);
    const [first] = matching;
    if (matching.length !== 1 || first === undefined) {
      throw new Error(`expected one pending wake, found ${matching.length}`);
    }
    return first;
  }

  fire(entry: ManualWake): void {
    if (entry.cancelled || entry.fired) throw new Error("wake is not pending");
    entry.fired = true;
    entry.wake();
  }
}
