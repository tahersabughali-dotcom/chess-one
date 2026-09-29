import type { AccountsRepository } from "@chess-one/accounts";
import {
  challengeGameCreator,
  createRealtimeEdge,
  type EdgeFact,
  type EdgeLimits,
  ProductionTrustedSessionResolver,
  type RealtimeEdge,
  sessionCookiePolicy,
} from "@chess-one/edge";
import type { GameAccessLimits, GameAccessStore } from "@chess-one/game-access";
import { isUserId, type UserId } from "@chess-one/identity";
import {
  type ClockDomainId,
  type LiveGameRepository,
  SUBMIT_MOVE_COMMAND_V1,
} from "@chess-one/live-game";
import { expect } from "vitest";
import { PASSWORD } from "../../accounts/support/harness.ts";
import {
  type ChallengeHarness,
  type ChallengeHarnessOptions,
  challengeHarness,
} from "../../challenges/support/harness.ts";
import { GAME_ID } from "../../live-game/support/harness.ts";
import { ContractRepository } from "../../live-game-persistence/support/contract-repository.ts";
import { connect, field, ORIGIN, type TestClient } from "../../realtime/support/client.ts";
import { DefectLog, RecordingFacts } from "../../realtime/support/facts.ts";
import { DOMAIN_A, runtimeHarness } from "../../realtime/support/runtime.ts";
import { ManualClock, wallClockOf } from "../../realtime/support/time.ts";
import {
  type GameAccessHarness,
  gameAccessHarness,
  startDeadlineFrom,
  TIME_CONTROL,
} from "./harness.ts";

export interface AccessStackOptions {
  readonly accountsRepository?: AccountsRepository;
  readonly store?: GameAccessStore;
  readonly liveGame?: LiveGameRepository;
  readonly clockDomain?: ClockDomainId;
  readonly limits?: Partial<EdgeLimits>;
  readonly accessLimits?: Partial<GameAccessLimits>;
  /**
   * Serves the challenge routes over this store, creating games through
   * game access. The writer's wall clock is then the accounts clock, which
   * the challenge application also reads, so start deadlines agree.
   */
  readonly challengeStore?: ChallengeHarnessOptions["store"];
}

/**
 * One process of the real stack: accounts, game access, the writer
 * registry, and the edge with HTTP auth routes and the production session
 * resolver (loopback cookie). Every store is injectable, so the same stack
 * runs over memory doubles or PostgreSQL, and a second stack over the same
 * stores is a restarted process.
 */
export interface AccessStack {
  readonly ga: GameAccessHarness;
  /** Present when the stack serves the challenge routes. */
  readonly challenges: ChallengeHarness | null;
  readonly edge: RealtimeEdge;
  readonly facts: RecordingFacts<EdgeFact>;
  readonly defects: DefectLog;
  readonly ws: string;
  readonly http: string;
  close(): Promise<void>;
}

export async function accessStack(options: AccessStackOptions = {}): Promise<AccessStack> {
  const accountsClock: { source: { now(): number } | null } = { source: null };
  const runtime = runtimeHarness(
    {},
    options.liveGame ?? new ContractRepository(),
    options.clockDomain ?? DOMAIN_A,
    options.challengeStore === undefined
      ? undefined
      : wallClockOf({
          now: () => {
            if (accountsClock.source === null) throw new Error("accounts clock not bound yet");
            return accountsClock.source.now();
          },
        }),
  );
  const ga = gameAccessHarness({
    runtime,
    ...(options.store === undefined ? {} : { store: options.store }),
    ...(options.accessLimits === undefined ? {} : { limits: options.accessLimits }),
    accounts:
      options.accountsRepository === undefined ? {} : { repository: options.accountsRepository },
  });
  accountsClock.source = ga.accounts.clock;
  const challenges =
    options.challengeStore === undefined
      ? null
      : challengeHarness({
          accounts: ga.accounts,
          store: options.challengeStore,
          games: challengeGameCreator(ga.access),
        });
  const facts = new RecordingFacts<EdgeFact>();
  const defects = new DefectLog();
  const edge = createRealtimeEdge({
    environment: "test",
    allowedOrigins: [ORIGIN],
    sessionResolver: new ProductionTrustedSessionResolver({
      sessions: ga.accounts.accounts,
      gameAccess: ga.access,
      cookie: sessionCookiePolicy("insecure_loopback"),
      maxCookieLength: 4_096,
    }),
    writers: runtime.registry,
    clock: new ManualClock(0),
    facts,
    reportDefect: defects.report,
    auth: { accounts: ga.accounts.accounts, cookie: "insecure_loopback" },
    ...(challenges === null ? {} : { challenges: { challenges: challenges.challenges } }),
    ...(options.limits === undefined ? {} : { limits: options.limits }),
  });
  const address = await edge.listen({ host: "127.0.0.1", port: 0 });
  const ws = `ws://127.0.0.1:${address.port}`;
  let closing: Promise<void> | null = null;
  return {
    ga,
    challenges,
    edge,
    facts,
    defects,
    ws,
    http: `http://127.0.0.1:${address.port}`,
    close: () => {
      closing ??= (async () => {
        await edge.close();
        await ga.access.settled();
        ga.access.dispose();
        await runtime.registry.dispose();
      })();
      return closing;
    },
  };
}

/** No stack reported a defect of its own. */
export function expectNoDefects(stack: AccessStack): void {
  expect(stack.defects.errors).toEqual([]);
  expect(stack.ga.defects.errors).toEqual([]);
  expect(stack.ga.runtime.defects.errors).toEqual([]);
  expect(stack.ga.accounts.defects.errors).toEqual([]);
  expect(stack.challenges?.defects.errors ?? []).toEqual([]);
}

async function post(
  stack: AccessStack,
  path: string,
  body: Readonly<Record<string, string>>,
  cookie?: string,
): Promise<Response> {
  const headers = new Headers({ origin: ORIGIN, "content-type": "application/json" });
  if (cookie !== undefined) headers.set("cookie", cookie);
  return fetch(`${stack.http}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

function cookieOf(response: Response): string {
  const [line = ""] = response.headers.getSetCookie();
  return line.slice(0, line.indexOf(";"));
}

/** Real HTTP registration; returns the new user's id. */
export async function signUp(stack: AccessStack, username: string): Promise<UserId> {
  const response = await post(stack, "/auth/register", {
    username,
    email: `${username.toLowerCase()}@example.test`,
    password: PASSWORD,
  });
  expect(response.status).toBe(201);
  const userId = field(await response.json(), "user", "userId");
  if (typeof userId !== "string" || !isUserId(userId)) throw new Error("not a user id");
  return userId;
}

/** Real HTTP login; returns the `name=value` session cookie. */
export async function logIn(stack: AccessStack, identifier: string): Promise<string> {
  const response = await post(stack, "/auth/login", { identifier, password: PASSWORD });
  expect(response.status).toBe(200);
  await response.body?.cancel();
  return cookieOf(response);
}

export async function logOut(stack: AccessStack, cookie: string): Promise<void> {
  const response = await post(stack, "/auth/logout", {}, cookie);
  expect(response.status).toBe(204);
  await response.body?.cancel();
}

export async function assign(
  stack: AccessStack,
  white: UserId,
  black: UserId,
  gameId = GAME_ID,
): Promise<void> {
  const created = await stack.ga.access.createAssignedGame({
    gameId,
    white,
    black,
    timeControl: TIME_CONTROL,
    startDeadlineAtWallMs: startDeadlineFrom(stack.ga.runtime),
  });
  if (!created.ok) throw new Error(`not assigned: ${JSON.stringify(created.error)}`);
}

/** A socket carrying only the session cookie, past `hello`. */
export async function socketOf(stack: AccessStack, cookie: string): Promise<TestClient> {
  const client = await connect(stack.ws, { token: null, headers: { cookie } });
  await client.hello();
  return client;
}

export function claimMessage(requestId: string, gameId: string = GAME_ID): unknown {
  return { type: "claim_game_control", requestId, gameId };
}

export function readyMessage(requestId: string, gameId: string = GAME_ID): unknown {
  return { type: "ready_game", requestId, gameId };
}

/** Sends `ready_game` and returns its answer: `game_ready_state` or `request_failed`. */
export async function readyAnswer(
  client: TestClient,
  requestId: string,
  gameId: string = GAME_ID,
): Promise<unknown> {
  client.send(readyMessage(requestId, gameId));
  return client.nextWhere(
    (message) =>
      (field(message, "type") === "game_ready_state" ||
        field(message, "type") === "request_failed") &&
      field(message, "requestId") === requestId,
  );
}

/**
 * Both clients claim their seat and declare ready, so the game starts:
 * sequence 1, White's clock running.
 */
export async function claimAndStart(white: TestClient, black: TestClient): Promise<void> {
  await claimGranted(white, "claim-white");
  await claimGranted(black, "claim-black");
  expect(field(await readyAnswer(white, "ready-white"), "myReady")).toBe(true);
  const started = await readyAnswer(black, "ready-black");
  expect(field(started, "gameLifecycle")).toBe("in_progress");
}

/**
 * Starts the game from fresh sessions of both players, which claim, declare
 * ready, and disconnect: afterwards the game is in progress at sequence 1 and
 * the seats are held by sessions the test never uses, so the test's own
 * sessions hold no control until they claim.
 */
export async function startFromOtherSessions(
  stack: AccessStack,
  whiteLogin: string,
  blackLogin: string,
): Promise<void> {
  const white = await socketOf(stack, await logIn(stack, whiteLogin));
  const black = await socketOf(stack, await logIn(stack, blackLogin));
  await claimAndStart(white, black);
  await Promise.all([white.close(), black.close()]);
}

/** A move as a browser sends it: no lease, the edge fills in the session's. */
export function moveMessage(
  requestId: string,
  clientCommandId: string,
  expectedGameSequence: number,
  uci: string,
  gameId: string = GAME_ID,
): unknown {
  return {
    type: "game_command",
    requestId,
    command: {
      command: SUBMIT_MOVE_COMMAND_V1,
      contractVersion: "1",
      gameId,
      clientCommandId,
      expectedGameSequence,
      fromSquare: uci.slice(0, 2),
      toSquare: uci.slice(2, 4),
    },
  };
}

export async function claimGranted(
  client: TestClient,
  requestId: string,
  gameId: string = GAME_ID,
): Promise<unknown> {
  client.send(claimMessage(requestId, gameId));
  const granted = await client.next("control_granted");
  expect(field(granted, "requestId")).toBe(requestId);
  return granted;
}

export async function claimDenied(
  client: TestClient,
  requestId: string,
  gameId: string = GAME_ID,
): Promise<unknown> {
  client.send(claimMessage(requestId, gameId));
  const denied = await client.next("control_denied");
  expect(field(denied, "requestId")).toBe(requestId);
  return denied;
}
