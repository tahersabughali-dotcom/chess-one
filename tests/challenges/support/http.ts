import type { RateLimit } from "@chess-one/accounts";
import type { ChallengeStore } from "@chess-one/challenges";
import { LOOPBACK_SESSION_COOKIE } from "@chess-one/edge";
import { type AccountsHarness, accountsHarness } from "../../accounts/support/harness.ts";
import { type AuthEdge, authEdge } from "../../accounts/support/http.ts";
import { type ChallengeHarness, challengeHarness, type Player } from "./harness.ts";

export interface ChallengeEdge {
  readonly auth: AuthEdge;
  readonly h: ChallengeHarness;
  close(): Promise<void>;
}

export interface ChallengeEdgeOptions {
  readonly accounts?: AccountsHarness;
  readonly store?: ChallengeStore;
  readonly rateLimit?: RateLimit;
}

/**
 * The real edge with the auth and challenge routes and the production
 * session resolver, over test accounts and the challenge application.
 */
export function challengeEdge(options: ChallengeEdgeOptions = {}): ChallengeEdge {
  const accounts = options.accounts ?? accountsHarness();
  const h = challengeHarness({
    accounts,
    ...(options.store === undefined ? {} : { store: options.store }),
    ...(options.rateLimit === undefined ? {} : { rateLimit: options.rateLimit }),
  });
  const auth = authEdge({ accountsHarness: accounts, challenges: { challenges: h.challenges } });
  return { auth, h, close: () => auth.close() };
}

export function cookieOf(player: Player): string {
  return `${LOOPBACK_SESSION_COOKIE}=${player.token}`;
}

/** Every object key anywhere in a JSON value. */
export function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, member]) => [key, ...keysOf(member)]);
}
