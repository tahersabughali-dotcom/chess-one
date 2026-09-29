/**
 * Per-connection inbound rate control in integer milli-tokens: `burst`
 * messages at once, refilled at `refillPerSecond`. `now` is any monotonic
 * millisecond reading; it only paces ingress and never touches chess time.
 */
export class TokenBucket {
  readonly #capacity: number;
  readonly #refillPerMs: number;
  #tokens: number;
  #last: number;

  constructor(burst: number, refillPerSecond: number, now: number) {
    this.#capacity = burst * 1000;
    this.#refillPerMs = refillPerSecond;
    this.#tokens = this.#capacity;
    this.#last = now;
  }

  take(now: number): boolean {
    const elapsed = Math.max(0, now - this.#last);
    this.#last = Math.max(this.#last, now);
    this.#tokens = Math.min(this.#capacity, this.#tokens + elapsed * this.#refillPerMs);
    if (this.#tokens < 1000) return false;
    this.#tokens -= 1000;
    return true;
  }
}
