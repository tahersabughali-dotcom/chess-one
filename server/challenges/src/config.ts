import type { AccountStanding, PlayerDirectory, RateLimit, WallClock } from "@chess-one/accounts";
import type { ChallengeFactSink } from "./facts.ts";
import type { ChallengeGameCreator, ChallengeStore } from "./ports.ts";

/**
 * Conditions beyond the fixed ones (two different, existing, active
 * accounts). The baseline requires nothing more: a verified email is not a
 * condition for challenging or being challenged.
 */
export interface ChallengeEligibilityPolicy {
  check(
    challenger: AccountStanding,
    opponent: AccountStanding,
  ): "eligible" | "challenger_ineligible" | "opponent_ineligible";
}

export const OPEN_CHALLENGE_ELIGIBILITY: ChallengeEligibilityPolicy = Object.freeze({
  check: () => "eligible",
});

/** Challenge creations per user: 10 at once, then one every 30 seconds. */
export const DEFAULT_CHALLENGE_RATE_LIMIT: RateLimit = Object.freeze({
  burst: 10,
  refillEveryMs: 30_000,
});

export interface ChallengesConfig {
  readonly store: ChallengeStore;
  readonly players: PlayerDirectory;
  /** Creates and checks an accepted challenge's game; the only way to games. */
  readonly games: ChallengeGameCreator;
  /** UTC wall clock: creation and expiry are wall-clock facts, not a writer's monotonic time. */
  readonly clock: WallClock;
  readonly facts: ChallengeFactSink;
  readonly reportDefect: (error: unknown) => void;
  readonly eligibility?: ChallengeEligibilityPolicy;
  /**
   * In-process only, like the auth limits: each process counts on its own
   * (CHALLENGE-RATE-LIMIT-DISTRIBUTED-001).
   */
  readonly rateLimit?: RateLimit;
  readonly maxRateLimitKeys?: number;
}

export class ChallengesConfigError extends Error {
  override readonly name = "ChallengesConfigError";
}

export interface ResolvedChallengesConfig {
  readonly store: ChallengeStore;
  readonly players: PlayerDirectory;
  readonly games: ChallengeGameCreator;
  readonly clock: WallClock;
  readonly facts: ChallengeFactSink;
  readonly reportDefect: (error: unknown) => void;
  readonly eligibility: ChallengeEligibilityPolicy;
  readonly rateLimit: RateLimit;
  readonly maxRateLimitKeys: number;
}

function positive(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ChallengesConfigError(`${name} must be a positive integer`);
  }
  return value;
}

export function resolveChallengesConfig(config: ChallengesConfig): ResolvedChallengesConfig {
  const rateLimit = config.rateLimit ?? DEFAULT_CHALLENGE_RATE_LIMIT;
  return Object.freeze({
    store: config.store,
    players: config.players,
    games: config.games,
    clock: config.clock,
    facts: config.facts,
    reportDefect: config.reportDefect,
    eligibility: config.eligibility ?? OPEN_CHALLENGE_ELIGIBILITY,
    rateLimit: Object.freeze({
      burst: positive(rateLimit.burst, "rateLimit.burst"),
      refillEveryMs: positive(rateLimit.refillEveryMs, "rateLimit.refillEveryMs"),
    }),
    maxRateLimitKeys: positive(config.maxRateLimitKeys ?? 10_000, "maxRateLimitKeys"),
  });
}
