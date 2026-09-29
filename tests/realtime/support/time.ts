import type {
  MonotonicClock,
  MonotonicMs,
  WakeHandle,
  WakeScheduler,
} from "@chess-one/live-game-runtime";
import { ms } from "../../live-game/support/harness.ts";

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
