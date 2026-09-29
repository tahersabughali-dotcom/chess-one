import {
  createRealtimeEdge,
  type EdgeFact,
  type EdgeLimits,
  type RealtimeEdge,
  type TrustedSessionContext,
  type TrustedSessionResolver,
} from "@chess-one/edge";
import type { LiveGameCommand } from "@chess-one/live-game";
import type { MonotonicClock, MonotonicMs } from "@chess-one/live-game-runtime";
import {
  GAME_ID,
  LEASES,
  ms,
  OTHER_GAME_ID,
  PLAYERS,
  STRANGER,
} from "../../live-game/support/harness.ts";
import { ORIGIN } from "./client.ts";
import { DefectLog, RecordingFacts } from "./facts.ts";
import type { RuntimeHarness } from "./runtime.ts";
import { runtimeHarness } from "./runtime.ts";
import { TestTrustedSessionResolver } from "./sessions.ts";
import { staticSession } from "./static-access.ts";
import { ManualClock } from "./time.ts";

export const TOKENS = Object.freeze({
  white: "token-white-7f3a",
  black: "token-black-19c2",
  stranger: "token-stranger-5d0e",
});

/** White holds game-1 and game-2 (never stored), black holds game-1, the stranger holds nothing. */
export const TEST_SESSIONS: Readonly<Record<string, TrustedSessionContext>> = Object.freeze({
  [TOKENS.white]: staticSession(PLAYERS.white, [
    { gameId: GAME_ID, seat: "white", controlLeaseId: LEASES.white },
    { gameId: OTHER_GAME_ID, seat: "white", controlLeaseId: LEASES.white },
  ]),
  [TOKENS.black]: staticSession(PLAYERS.black, [
    { gameId: GAME_ID, seat: "black", controlLeaseId: LEASES.black },
  ]),
  [TOKENS.stranger]: staticSession(STRANGER, []),
});

/** An edge clock that moves one second per reading, so rate control never engages. */
export class SteppingClock implements MonotonicClock {
  #now = 0;

  now(): MonotonicMs {
    this.#now += 1_000;
    return ms(this.#now);
  }
}

export interface EdgeHarnessOptions {
  readonly runtime?: RuntimeHarness;
  readonly limits?: Partial<EdgeLimits>;
  readonly resolver?: TrustedSessionResolver;
  readonly edgeClock?: MonotonicClock;
}

export interface EdgeHarness {
  readonly runtime: RuntimeHarness;
  readonly facts: RecordingFacts<EdgeFact>;
  readonly defects: DefectLog;
  /** The default resolver; `seen` shows which credentials reached session resolution. */
  readonly sessions: TestTrustedSessionResolver;
  readonly edge: RealtimeEdge;
  readonly url: string;
  /** Closes the edge, then disposes the registry. Safe to call twice. */
  close(): Promise<void>;
}

/** A real Fastify + ws endpoint on 127.0.0.1 over a writer registry with manual time. */
export async function edgeHarness(options: EdgeHarnessOptions = {}): Promise<EdgeHarness> {
  const runtime = options.runtime ?? runtimeHarness();
  const facts = new RecordingFacts<EdgeFact>();
  const defects = new DefectLog();
  const sessions = new TestTrustedSessionResolver(TEST_SESSIONS);
  const edge = createRealtimeEdge({
    environment: "test",
    allowedOrigins: [ORIGIN],
    sessionResolver: options.resolver ?? sessions,
    writers: runtime.registry,
    clock: options.edgeClock ?? new ManualClock(0),
    facts,
    reportDefect: defects.report,
    ...(options.limits === undefined ? {} : { limits: options.limits }),
  });
  const address = await edge.listen({ host: "127.0.0.1", port: 0 });
  let closing: Promise<void> | null = null;
  return {
    runtime,
    facts,
    defects,
    sessions,
    edge,
    url: `ws://127.0.0.1:${address.port}`,
    close: () => {
      closing ??= (async () => {
        await edge.close();
        await runtime.registry.dispose();
      })();
      return closing;
    },
  };
}

export function commandMessage(command: LiveGameCommand, requestId = "req-1"): unknown {
  return { type: "game_command", requestId, command };
}
