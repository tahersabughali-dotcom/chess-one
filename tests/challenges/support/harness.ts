import type { AuthenticatedSession, PlayerDirectory, RateLimit } from "@chess-one/accounts";
import {
  type ChallengeEligibilityPolicy,
  type ChallengeFact,
  type ChallengeGameCreator,
  type ChallengeStore,
  Challenges,
  type CreateChallengeInput,
} from "@chess-one/challenges";
import {
  type AccountsHarness,
  accountsHarness,
  registered,
} from "../../accounts/support/harness.ts";
import { DefectLog, RecordingFacts } from "../../realtime/support/facts.ts";
import { FakeGameCreator } from "./games.ts";
import { MemoryChallengeStore } from "./memory-store.ts";

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** Five minutes of sudden death on the default ruleset, White for the challenger. */
export function createInput(
  opponentUsername: string,
  overrides: Partial<CreateChallengeInput> = {},
): CreateChallengeInput {
  return {
    opponentUsername,
    rulesetId: null,
    timeControl: { type: "sudden_death", initialMs: 5 * MINUTE, incrementMs: 0 },
    seatPreference: "white",
    ...overrides,
  };
}

export interface Player {
  readonly username: string;
  readonly userId: string;
  readonly session: AuthenticatedSession;
  /** The session token, for a cookie in HTTP tests. */
  readonly token: string;
}

export interface ChallengeHarness {
  readonly accounts: AccountsHarness;
  readonly store: ChallengeStore;
  readonly memory: MemoryChallengeStore | null;
  /** The game creator when it is the in-memory one (the default). */
  readonly fakeGames: FakeGameCreator | null;
  readonly challenges: Challenges;
  readonly facts: RecordingFacts<ChallengeFact>;
  readonly defects: DefectLog;
  player(username: string): Promise<Player>;
}

export interface ChallengeHarnessOptions {
  readonly accounts?: AccountsHarness;
  readonly store?: ChallengeStore;
  readonly rateLimit?: RateLimit;
  readonly eligibility?: ChallengeEligibilityPolicy;
  readonly games?: ChallengeGameCreator;
  /** Replaces the accounts' player lookups (to inject failures); defaults to the accounts. */
  readonly players?: PlayerDirectory;
}

/** RELAXED: only tests about throttling meet the creation limit. */
const RELAXED_RATE_LIMIT: RateLimit = Object.freeze({ burst: 10_000, refillEveryMs: 1 });

export function challengeHarness(options: ChallengeHarnessOptions = {}): ChallengeHarness {
  const accounts = options.accounts ?? accountsHarness();
  const names = new Map<string, string>();
  const memory =
    options.store === undefined
      ? new MemoryChallengeStore((userId) => names.get(userId) ?? "unknown")
      : null;
  const store = options.store ?? memory ?? new MemoryChallengeStore(() => "unknown");
  const games = options.games ?? new FakeGameCreator();
  const fakeGames = games instanceof FakeGameCreator ? games : null;
  const facts = new RecordingFacts<ChallengeFact>();
  const defects = new DefectLog();
  const challenges = new Challenges({
    store,
    games,
    players: options.players ?? accounts.accounts,
    clock: accounts.clock,
    facts,
    reportDefect: defects.report,
    rateLimit: options.rateLimit ?? RELAXED_RATE_LIMIT,
    ...(options.eligibility === undefined ? {} : { eligibility: options.eligibility }),
  });
  return {
    accounts,
    store,
    memory,
    fakeGames,
    challenges,
    facts,
    defects,
    player: async (username) => {
      const signedIn = await registered(accounts, username);
      const session = await accounts.accounts.authenticate(signedIn.session.token);
      if (session === null) throw new Error("fresh session did not authenticate");
      names.set(signedIn.account.userId, signedIn.account.username);
      return {
        username,
        userId: signedIn.account.userId,
        session,
        token: signedIn.session.token,
      };
    },
  };
}
