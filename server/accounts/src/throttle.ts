/** `burst` attempts at once, then one more every `refillEveryMs`. */
export interface RateLimit {
  readonly burst: number;
  readonly refillEveryMs: number;
}

export type ThrottleDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterMs: number };

interface Bucket {
  /** Earned time credit in ms; each attempt costs `refillEveryMs`. */
  credit: number;
  last: number;
}

/**
 * In-process attempt limiter keyed by an opaque digest. Memory is bounded:
 * at most `maxKeys` buckets, least recently used evicted first, and buckets
 * that have refilled completely are dropped as they are passed. It protects
 * one process only; there is no shared store (AUTH-RATE-LIMIT-DISTRIBUTED-001).
 */
export class AttemptLimiter {
  readonly #limit: RateLimit;
  readonly #capacity: number;
  readonly #maxKeys: number;
  readonly #buckets = new Map<string, Bucket>();

  constructor(limit: RateLimit, maxKeys: number) {
    this.#limit = limit;
    this.#capacity = limit.burst * limit.refillEveryMs;
    this.#maxKeys = maxKeys;
  }

  get size(): number {
    return this.#buckets.size;
  }

  take(key: string, now: number): ThrottleDecision {
    this.#sweep(now);
    const cost = this.#limit.refillEveryMs;
    const bucket = this.#buckets.get(key);
    let credit = this.#capacity;
    if (bucket !== undefined) {
      credit = Math.min(this.#capacity, bucket.credit + Math.max(0, now - bucket.last));
      this.#buckets.delete(key);
    } else if (this.#buckets.size >= this.#maxKeys) {
      const oldest = this.#buckets.keys().next();
      if (oldest.done !== true) this.#buckets.delete(oldest.value);
    }
    const allowed = credit >= cost;
    this.#buckets.set(key, { credit: allowed ? credit - cost : credit, last: now });
    return allowed ? { allowed: true } : { allowed: false, retryAfterMs: cost - credit };
  }

  /** Drops up to a few least recently used buckets that are full again. */
  #sweep(now: number): void {
    for (let checked = 0; checked < 4; checked += 1) {
      const oldest = this.#buckets.entries().next();
      if (oldest.done === true) return;
      const [key, bucket] = oldest.value;
      if (bucket.credit + Math.max(0, now - bucket.last) < this.#capacity) return;
      this.#buckets.delete(key);
    }
  }
}
