import type { FactSink, MonotonicClock, WriterDirectory } from "@chess-one/live-game-runtime";
import type { EdgeFact } from "./facts.ts";
import type { TrustedSessionResolver } from "./session.ts";

export interface EdgeLimits {
  /** WebSocket frame payload limit; a larger message closes the connection with 1009. */
  readonly maxMessageBytes: number;
  /** Bytes queued for one connection beyond which it is closed as a slow consumer. */
  readonly maxOutboundBufferBytes: number;
  /** Time from upgrade to `hello`. */
  readonly handshakeTimeoutMs: number;
  /** Protocol ping interval; a missing pong by the next ping terminates the connection. */
  readonly heartbeatIntervalMs: number;
  /** Time a closing connection gets to finish the close handshake before it is terminated. */
  readonly closeTimeoutMs: number;
  readonly sessionResolveTimeoutMs: number;
  readonly inboundBurst: number;
  readonly inboundRefillPerSecond: number;
  /** Consecutive rate-limited messages before the connection is closed with 1008. */
  readonly maxRateLimitStrikes: number;
  /** Invalid messages after `hello` before the connection is closed with 1002. */
  readonly maxProtocolErrors: number;
  readonly maxConnections: number;
  readonly maxGamesPerConnection: number;
  readonly maxCredentialLength: number;
  readonly maxGrantsPerSession: number;
}

/**
 * Baseline values. 4096 bytes is over twice the largest legal client message
 * (about 1.5 KB); 256 KiB of outbound backlog is hundreds of snapshots.
 */
export const DEFAULT_EDGE_LIMITS: EdgeLimits = Object.freeze({
  maxMessageBytes: 4_096,
  maxOutboundBufferBytes: 262_144,
  handshakeTimeoutMs: 5_000,
  heartbeatIntervalMs: 15_000,
  closeTimeoutMs: 3_000,
  sessionResolveTimeoutMs: 3_000,
  inboundBurst: 20,
  inboundRefillPerSecond: 10,
  maxRateLimitStrikes: 50,
  maxProtocolErrors: 10,
  maxConnections: 1_000,
  maxGamesPerConnection: 8,
  maxCredentialLength: 4_096,
  maxGrantsPerSession: 64,
});

/** No limit may exceed these: the message cap stays at or under 16 KiB. */
const LIMIT_CEILINGS: Readonly<Record<keyof EdgeLimits, number>> = {
  maxMessageBytes: 16_384,
  maxOutboundBufferBytes: 16_777_216,
  handshakeTimeoutMs: 60_000,
  heartbeatIntervalMs: 300_000,
  closeTimeoutMs: 60_000,
  sessionResolveTimeoutMs: 60_000,
  inboundBurst: 1_000,
  inboundRefillPerSecond: 1_000,
  maxRateLimitStrikes: 10_000,
  maxProtocolErrors: 1_000,
  maxConnections: 100_000,
  maxGamesPerConnection: 64,
  maxCredentialLength: 16_384,
  maxGrantsPerSession: 1_024,
};

export interface EdgeConfig {
  readonly environment: "production" | "test";
  /** Exact browser origins, such as `https://play.example`. Never `*`. */
  readonly allowedOrigins: readonly string[];
  readonly sessionResolver: TrustedSessionResolver | null;
  readonly writers: WriterDirectory;
  /** Paces inbound rate control only; chess time is the writer's. */
  readonly clock: MonotonicClock;
  readonly facts: FactSink<EdgeFact>;
  readonly reportDefect: (error: unknown) => void;
  readonly limits?: Partial<EdgeLimits>;
}

export interface ResolvedEdgeConfig {
  readonly allowedOrigins: ReadonlySet<string>;
  readonly sessionResolver: TrustedSessionResolver;
  readonly writers: WriterDirectory;
  readonly clock: MonotonicClock;
  readonly facts: FactSink<EdgeFact>;
  readonly reportDefect: (error: unknown) => void;
  readonly limits: EdgeLimits;
}

export class EdgeConfigError extends Error {
  override readonly name = "EdgeConfigError";
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function checkOrigin(origin: string, environment: EdgeConfig["environment"]): string {
  if (origin.includes("*"))
    throw new EdgeConfigError(`Wildcard origins are not allowed: ${origin}`);
  let url: URL;
  try {
    url = new URL(origin);
  } catch (error: unknown) {
    if (error instanceof TypeError) throw new EdgeConfigError(`Invalid origin ${origin}`);
    throw error;
  }
  if (url.origin !== origin) throw new EdgeConfigError(`Origin must be exact: ${origin}`);
  if (environment === "production" && url.protocol !== "https:") {
    throw new EdgeConfigError(`A production origin must use https: ${origin}`);
  }
  if (environment === "test" && !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new EdgeConfigError(`A test origin must be a loopback origin: ${origin}`);
  }
  return origin;
}

function checkLimits(overrides: Partial<EdgeLimits> | undefined): EdgeLimits {
  const limits: EdgeLimits = { ...DEFAULT_EDGE_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    const ceiling = new Map(Object.entries(LIMIT_CEILINGS)).get(name);
    if (!Number.isSafeInteger(value) || value < 1 || ceiling === undefined || value > ceiling) {
      throw new EdgeConfigError(`Edge limit ${name} is out of range`);
    }
  }
  return Object.freeze(limits);
}

/**
 * Fails closed: no endpoint starts without a session resolver, with a
 * test-only resolver in production, with an empty origin allowlist, with a
 * wildcard or malformed origin, or with limits out of range.
 */
export function resolveEdgeConfig(config: EdgeConfig): ResolvedEdgeConfig {
  const resolver = config.sessionResolver;
  if (resolver === null) throw new EdgeConfigError("A trusted session resolver is required");
  if (config.environment === "production" && resolver.trust !== "production") {
    throw new EdgeConfigError("A production endpoint needs a production session resolver");
  }
  if (config.allowedOrigins.length === 0) {
    throw new EdgeConfigError("The origin allowlist is empty");
  }
  const origins = new Set(
    config.allowedOrigins.map((origin) => checkOrigin(origin, config.environment)),
  );
  return Object.freeze({
    allowedOrigins: origins,
    sessionResolver: resolver,
    writers: config.writers,
    clock: config.clock,
    facts: config.facts,
    reportDefect: config.reportDefect,
    limits: checkLimits(config.limits),
  });
}
