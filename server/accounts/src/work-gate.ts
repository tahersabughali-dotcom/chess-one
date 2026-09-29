export type GateResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

/**
 * Runs at most `maxActive` tasks at once and lets at most `maxWaiting` wait;
 * a task beyond that is refused at once instead of queued. Password hashing
 * uses it so memory-hard work cannot pile up without bound.
 */
export class WorkGate {
  readonly #maxActive: number;
  readonly #maxWaiting: number;
  readonly #waiting: (() => void)[] = [];
  #active = 0;

  constructor(maxActive: number, maxWaiting: number) {
    this.#maxActive = maxActive;
    this.#maxWaiting = maxWaiting;
  }

  get active(): number {
    return this.#active;
  }

  get waiting(): number {
    return this.#waiting.length;
  }

  async run<T>(task: () => Promise<T>): Promise<GateResult<T>> {
    if (this.#active >= this.#maxActive) {
      if (this.#waiting.length >= this.#maxWaiting) return { ok: false };
      const turn = Promise.withResolvers<void>();
      this.#waiting.push(turn.resolve);
      await turn.promise;
    } else {
      this.#active += 1;
    }
    try {
      return { ok: true, value: await task() };
    } finally {
      const next = this.#waiting.shift();
      if (next === undefined) this.#active -= 1;
      else next();
    }
  }
}
