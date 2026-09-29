import type { WallClock } from "./clock.ts";
import {
  type AccountTokenDelivery,
  type CompromisedPasswordScreen,
  NO_COMPROMISED_PASSWORD_SCREEN,
} from "./extensions.ts";
import type { AccountsFactSink, AuthThrottleScope } from "./facts.ts";
import type { PasswordHasher } from "./password-hasher.ts";
import type { AccountsRepository } from "./ports.ts";
import { SessionRevocations } from "./revocations.ts";
import { AttemptLimiter, type RateLimit } from "./throttle.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Session lifetime (AUTH-SESSION-002). A session ends at the first of: its
 * absolute expiry (30 days after login, never extended), 7 days without
 * activity, logout, or revocation. Activity is written at most once per
 * `touchIntervalMs`, so a busy session costs one UPDATE per 15 minutes, not
 * one per request; the idle window is therefore exact to within 15 minutes.
 */
export interface SessionPolicy {
  readonly absoluteLifetimeMs: number;
  readonly idleTimeoutMs: number;
  readonly touchIntervalMs: number;
  /** Counting sessions per user; creating one more revokes the least recently seen. */
  readonly maxSessionsPerUser: number;
}

export const DEFAULT_SESSION_POLICY: SessionPolicy = Object.freeze({
  absoluteLifetimeMs: 30 * DAY,
  idleTimeoutMs: 7 * DAY,
  touchIntervalMs: 15 * MINUTE,
  maxSessionsPerUser: 32,
});

export interface ActionTokenPolicy {
  readonly passwordResetTtlMs: number;
  readonly emailVerificationTtlMs: number;
}

export const DEFAULT_ACTION_TOKEN_POLICY: ActionTokenPolicy = Object.freeze({
  passwordResetTtlMs: 30 * MINUTE,
  emailVerificationTtlMs: DAY,
});

export type AuthRateLimits = Readonly<Record<AuthThrottleScope, RateLimit>> & {
  readonly maxKeysPerLimiter: number;
};

/**
 * In-process limits (AUTH-RATE-LIMIT-001). The client-address bucket covers
 * every unauthenticated auth request; the others are per scope. Refused
 * attempts cost no hashing. None locks an account: each refills with time.
 */
export const DEFAULT_AUTH_RATE_LIMITS: AuthRateLimits = Object.freeze({
  client_address: { burst: 30, refillEveryMs: 2_000 },
  registration: { burst: 10, refillEveryMs: 5 * MINUTE },
  login_identifier: { burst: 10, refillEveryMs: MINUTE },
  password_change: { burst: 5, refillEveryMs: MINUTE },
  password_reset_request: { burst: 3, refillEveryMs: 15 * MINUTE },
  email_verification_request: { burst: 3, refillEveryMs: 15 * MINUTE },
  maxKeysPerLimiter: 50_000,
});

export interface AccountsConfig {
  readonly environment: "production" | "test";
  readonly repository: AccountsRepository;
  readonly hasher: PasswordHasher;
  readonly clock: WallClock;
  readonly facts: AccountsFactSink;
  readonly reportDefect: (error: unknown) => void;
  /** Null: password reset and email verification are unavailable. */
  readonly delivery: AccountTokenDelivery | null;
  readonly compromisedPasswords?: CompromisedPasswordScreen;
  readonly sessions?: Partial<SessionPolicy>;
  readonly tokens?: Partial<ActionTokenPolicy>;
  readonly rateLimits?: Partial<AuthRateLimits>;
}

export interface AccountsContext {
  readonly repository: AccountsRepository;
  readonly hasher: PasswordHasher;
  readonly clock: WallClock;
  readonly facts: AccountsFactSink;
  readonly reportDefect: (error: unknown) => void;
  readonly delivery: AccountTokenDelivery | null;
  readonly screen: CompromisedPasswordScreen;
  readonly sessions: SessionPolicy;
  readonly tokens: ActionTokenPolicy;
  readonly limiters: Readonly<Record<AuthThrottleScope, AttemptLimiter>>;
  readonly revocations: SessionRevocations;
}

export class AccountsConfigError extends Error {
  override readonly name = "AccountsConfigError";
}

function inRange(name: string, value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new AccountsConfigError(`Accounts setting ${name} is out of range`);
  }
  return value;
}

function checkSessions(overrides: Partial<SessionPolicy> | undefined): SessionPolicy {
  const policy = { ...DEFAULT_SESSION_POLICY, ...overrides };
  inRange("absoluteLifetimeMs", policy.absoluteLifetimeMs, HOUR, 90 * DAY);
  inRange("idleTimeoutMs", policy.idleTimeoutMs, 5 * MINUTE, policy.absoluteLifetimeMs);
  inRange("touchIntervalMs", policy.touchIntervalMs, 1_000, Math.floor(policy.idleTimeoutMs / 2));
  inRange("maxSessionsPerUser", policy.maxSessionsPerUser, 1, 256);
  return Object.freeze(policy);
}

function checkTokens(overrides: Partial<ActionTokenPolicy> | undefined): ActionTokenPolicy {
  const policy = { ...DEFAULT_ACTION_TOKEN_POLICY, ...overrides };
  inRange("passwordResetTtlMs", policy.passwordResetTtlMs, MINUTE, 2 * HOUR);
  inRange("emailVerificationTtlMs", policy.emailVerificationTtlMs, MINUTE, 7 * DAY);
  return Object.freeze(policy);
}

function limiters(
  overrides: Partial<AuthRateLimits> | undefined,
): Readonly<Record<AuthThrottleScope, AttemptLimiter>> {
  const limits = { ...DEFAULT_AUTH_RATE_LIMITS, ...overrides };
  const maxKeys = inRange("maxKeysPerLimiter", limits.maxKeysPerLimiter, 1, 1_000_000);
  const build = (scope: AuthThrottleScope): AttemptLimiter => {
    const limit = limits[scope];
    inRange(`${scope}.burst`, limit.burst, 1, 10_000);
    inRange(`${scope}.refillEveryMs`, limit.refillEveryMs, 1, DAY);
    return new AttemptLimiter(limit, maxKeys);
  };
  return Object.freeze({
    client_address: build("client_address"),
    registration: build("registration"),
    login_identifier: build("login_identifier"),
    password_change: build("password_change"),
    password_reset_request: build("password_reset_request"),
    email_verification_request: build("email_verification_request"),
  });
}

/**
 * Fails closed: production refuses a hasher below the production floor and
 * a test-only token delivery; every duration and limit has fixed bounds.
 */
export function resolveAccountsConfig(config: AccountsConfig): AccountsContext {
  if (config.environment === "production" && config.hasher.strength !== "production") {
    throw new AccountsConfigError("Production accounts need production password hashing");
  }
  if (config.environment === "production" && config.delivery?.trust === "test_only") {
    throw new AccountsConfigError("Production accounts refuse a test-only token delivery");
  }
  return Object.freeze({
    repository: config.repository,
    hasher: config.hasher,
    clock: config.clock,
    facts: config.facts,
    reportDefect: config.reportDefect,
    delivery: config.delivery,
    screen: config.compromisedPasswords ?? NO_COMPROMISED_PASSWORD_SCREEN,
    sessions: checkSessions(config.sessions),
    tokens: checkTokens(config.tokens),
    limiters: limiters(config.rateLimits),
    revocations: new SessionRevocations(config.reportDefect),
  });
}
