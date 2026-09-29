import type { Outcome, RateLimited } from "./api.ts";
import type { AccountsContext } from "./config.ts";
import type { AuthThrottleScope } from "./facts.ts";
import { keyDigest } from "./tokens.ts";

export function ok<T>(value: T): Outcome<T, never> {
  return { ok: true, value };
}

export function fail<E>(error: E): Outcome<never, E> {
  return { ok: false, error };
}

/** One attempt against a scope's limiter; the key is digested first, so no raw value is held. */
export function throttle(
  context: AccountsContext,
  scope: AuthThrottleScope,
  key: string,
): RateLimited | null {
  const decision = context.limiters[scope].take(keyDigest(scope, key), context.clock.now());
  if (decision.allowed) return null;
  context.facts.record({ name: "auth_rate_limited", scope });
  return { kind: "rate_limited", retryAfterMs: decision.retryAfterMs };
}
