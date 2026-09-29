import type { ActiveGameState } from "@chess-one/live-game";
import type { MonotonicClock, WakeHandle, WakeScheduler } from "./clock.ts";

/**
 * The first late instant of a running clock, `deadline + 1`: a receipt at the
 * deadline itself is timely.
 */
export function lateInstant(clock: ActiveGameState["clock"]): number {
  return clock.anchorMs + clock.remainingMs[clock.activeSide] + 1;
}

/**
 * The one deadline wake-up of one writer. Arming the instant already armed
 * keeps the timer, so repeated activation or refresh never adds a second one.
 */
export class DeadlineWatch {
  readonly #clock: MonotonicClock;
  readonly #scheduler: WakeScheduler;
  readonly #onWake: () => void;
  #timer: WakeHandle | null = null;
  #wakeAt: number | null = null;

  constructor(clock: MonotonicClock, scheduler: WakeScheduler, onWake: () => void) {
    this.#clock = clock;
    this.#scheduler = scheduler;
    this.#onWake = onWake;
  }

  get armed(): boolean {
    return this.#timer !== null;
  }

  arm(wakeAt: number): void {
    if (this.#timer !== null && this.#wakeAt === wakeAt) return;
    this.disarm();
    this.#wakeAt = wakeAt;
    this.#timer = this.#scheduler.wakeAfter(Math.max(0, wakeAt - this.#clock.now()), () => {
      this.#timer = null;
      this.#wakeAt = null;
      this.#onWake();
    });
  }

  disarm(): void {
    this.#timer?.cancel();
    this.#timer = null;
    this.#wakeAt = null;
  }
}
