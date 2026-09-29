import type { AccountsRepository } from "@chess-one/accounts";
import {
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
import { GAME_ID } from "../../live-game/support/harness.ts";
import { ContractRepository } from "../../live-game-persistence/support/contract-repository.ts";
import { connect, field, ORIGIN, type TestClient } from "../../realtime/support/client.ts";
import { DefectLog, RecordingFacts } from "../../realtime/support/facts.ts";
import { DOMAIN_A, runtimeHarness } from "../../realtime/support/runtime.ts";
import { ManualClock } from "../../realtime/support/time.ts";
import { type GameAccessHarness, gameAccessHarness, TIME_CONTROL } from "./harness.ts";

export interface AccessStackOptions {
  readonly accountsRepository?: AccountsRepository;
  readonly store?: GameAccessStore;
  readonly liveGame?: LiveGameRepository;
  readonly clockDomain?: ClockDomainId;
  readonly limits?: Partial<EdgeLimits>;
  readonly accessLimits?: Partial<GameAccessLimits>;
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
  readonly edge: RealtimeEdge;
  readonly facts: RecordingFacts<EdgeFact>;
  readonly defects: DefectLog;
  readonly ws: string;
  readonly http: string;
  close(): Promise<void>;
}

export async function accessStack(options: AccessStackOptions = {}): Promise<AccessStack> {
  const runtime = runtimeHarness(
    {},
    options.liveGame ?? new ContractRepository(),
    options.clockDomain ?? DOMAIN_A,
  );
  const ga = gameAccessHarness({
    runtime,
    ...(options.store === undefined ? {} : { store: options.store }),
    ...(options.accessLimits === undefined ? {} : { limits: options.accessLimits }),
    accounts:
      options.accountsRepository === undefined ? {} : { repository: options.accountsRepository },
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
    ...(options.limits === undefined ? {} : { limits: options.limits }),
  });
  const address = await edge.listen({ host: "127.0.0.1", port: 0 });
  const ws = `ws://127.0.0.1:${address.port}`;
  let closing: Promise<void> | null = null;
  return {
    ga,
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

export async function claimGranted(client: TestClient, requestId: string): Promise<unknown> {
  client.send(claimMessage(requestId));
  const granted = await client.next("control_granted");
  expect(field(granted, "requestId")).toBe(requestId);
  return granted;
}

export async function claimDenied(client: TestClient, requestId: string): Promise<unknown> {
  client.send(claimMessage(requestId));
  const denied = await client.next("control_denied");
  expect(field(denied, "requestId")).toBe(requestId);
  return denied;
}
