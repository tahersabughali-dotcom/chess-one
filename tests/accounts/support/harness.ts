import {
  Accounts,
  type AccountsConfig,
  type AccountsFact,
  type AccountsRepository,
  type AccountTokenDelivery,
  Argon2idHasher,
  type Argon2idParameters,
  type AuthRateLimits,
  type AuthRequest,
  type SessionPolicy,
  type SignedIn,
  type TokenDelivery,
  type WallClock,
} from "@chess-one/accounts";
import { DefectLog, RecordingFacts } from "../../realtime/support/facts.ts";
import { MemoryAccountsRepository } from "./memory-repository.ts";

/** 2027-01-15T08:00:00Z: an arbitrary fixed wall time for every accounts test. */
export const WALL_START = 1_800_000_000_000;
export const MINUTE = 60_000;
export const DAY = 24 * 60 * MINUTE;

export const PASSWORD = "correct horse battery staple";
export const OTHER_PASSWORD = "a different long passphrase";
export const CLIENT: AuthRequest = { clientAddress: "198.51.100.7" };

/**
 * Minimal Argon2id cost (8 KiB, one pass): far below the production floor,
 * so the hasher reports `test_only` and production configurations refuse it.
 */
export const TEST_ARGON2: Argon2idParameters = Object.freeze({
  memoryKiB: 8,
  passes: 1,
  parallelism: 1,
  saltBytes: 16,
  tagBytes: 32,
});

export function testHasher(
  parameters: Argon2idParameters = TEST_ARGON2,
  limits: { readonly maxConcurrent: number; readonly maxWaiting: number } = {
    maxConcurrent: 4,
    maxWaiting: 256,
  },
): Argon2idHasher {
  return new Argon2idHasher({ parameters, ...limits });
}

/** A wall clock the test sets by hand. */
export class ManualWallClock implements WallClock {
  #now: number;

  constructor(start = WALL_START) {
    this.#now = start;
  }

  now(): number {
    return this.#now;
  }

  advance(delta: number): void {
    this.#now += delta;
  }
}

/** TEST SINK for reset and verification tokens; no message ever leaves the process. */
export class RecordingDelivery implements AccountTokenDelivery {
  readonly trust = "test_only";
  readonly deliveries: TokenDelivery[] = [];
  failNext = false;

  async deliver(delivery: TokenDelivery): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("injected delivery failure");
    }
    this.deliveries.push(delivery);
  }

  last(purpose: TokenDelivery["purpose"]): TokenDelivery {
    const found = this.deliveries.filter((delivery) => delivery.purpose === purpose).at(-1);
    if (found === undefined) throw new Error(`no ${purpose} delivery`);
    return found;
  }
}

/** Limits high enough that only tests about throttling ever meet them. */
export const RELAXED_LIMITS: Partial<AuthRateLimits> = Object.freeze({
  client_address: { burst: 10_000, refillEveryMs: 1 },
  registration: { burst: 10_000, refillEveryMs: 1 },
  login_identifier: { burst: 10_000, refillEveryMs: 1 },
  password_change: { burst: 10_000, refillEveryMs: 1 },
  password_reset_request: { burst: 10_000, refillEveryMs: 1 },
  email_verification_request: { burst: 10_000, refillEveryMs: 1 },
});

export interface AccountsHarnessOptions {
  readonly repository?: AccountsRepository;
  readonly hasher?: Argon2idHasher;
  readonly delivery?: boolean;
  readonly sessions?: Partial<SessionPolicy>;
  readonly rateLimits?: Partial<AuthRateLimits>;
  readonly compromised?: readonly string[];
}

export interface AccountsHarness {
  readonly accounts: Accounts;
  readonly repository: AccountsRepository;
  readonly memory: MemoryAccountsRepository | null;
  readonly hasher: Argon2idHasher;
  readonly clock: ManualWallClock;
  readonly facts: RecordingFacts<AccountsFact>;
  readonly defects: DefectLog;
  readonly delivery: RecordingDelivery;
  readonly config: AccountsConfig;
}

export function accountsHarness(options: AccountsHarnessOptions = {}): AccountsHarness {
  const memory = options.repository === undefined ? new MemoryAccountsRepository() : null;
  const repository = options.repository ?? memory ?? new MemoryAccountsRepository();
  const hasher = options.hasher ?? testHasher();
  const clock = new ManualWallClock();
  const facts = new RecordingFacts<AccountsFact>();
  const defects = new DefectLog();
  const delivery = new RecordingDelivery();
  const compromised = new Set(options.compromised ?? []);
  const config: AccountsConfig = {
    environment: "test",
    repository,
    hasher,
    clock,
    facts,
    reportDefect: defects.report,
    delivery: options.delivery === false ? null : delivery,
    compromisedPasswords: { isCompromised: async (password) => compromised.has(password) },
    rateLimits: { ...RELAXED_LIMITS, ...options.rateLimits },
    ...(options.sessions === undefined ? {} : { sessions: options.sessions }),
  };
  return {
    accounts: new Accounts(config),
    repository,
    memory,
    hasher,
    clock,
    facts,
    defects,
    delivery,
    config,
  };
}

export async function registered(
  h: AccountsHarness,
  username: string,
  password = PASSWORD,
  email = `${username.toLowerCase()}@example.test`,
): Promise<SignedIn> {
  const result = await h.accounts.register({ username, email, password }, CLIENT);
  if (!result.ok) throw new Error(`registration failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

export async function signedIn(
  h: AccountsHarness,
  identifier: string,
  password = PASSWORD,
): Promise<SignedIn> {
  const result = await h.accounts.login({ identifier, password }, CLIENT);
  if (!result.ok) throw new Error(`login failed: ${JSON.stringify(result.error)}`);
  return result.value;
}
