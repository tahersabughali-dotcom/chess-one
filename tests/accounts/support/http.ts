import type { AuthenticatedSession } from "@chess-one/accounts";
import {
  createRealtimeEdge,
  type EdgeFact,
  type EdgeLimits,
  LOOPBACK_SESSION_COOKIE,
  ProductionTrustedSessionResolver,
  type RealtimeEdge,
  sessionCookiePolicy,
} from "@chess-one/edge";
import type { GameAccessProvider, SeatListing, SessionGameAuthority } from "@chess-one/game-access";
import { type ActiveGameState, createActiveGame, type Seat } from "@chess-one/live-game";
import { isPlayerId, type PlayerId } from "@chess-one/live-game-runtime";
import {
  duration,
  GAME_ID,
  INITIAL_MS,
  LEASES,
  ms,
  START_MS,
} from "../../live-game/support/harness.ts";
import { field, ORIGIN } from "../../realtime/support/client.ts";
import { DefectLog, RecordingFacts } from "../../realtime/support/facts.ts";
import { type RuntimeHarness, runtimeHarness } from "../../realtime/support/runtime.ts";
import { type StaticSeat, staticAuthority } from "../../realtime/support/static-access.ts";
import { ManualClock } from "../../realtime/support/time.ts";
import { type AccountsHarness, type AccountsHarnessOptions, accountsHarness } from "./harness.ts";

function player(userId: string): PlayerId {
  if (!isPlayerId(userId)) throw new Error(`not a player id: ${userId}`);
  return userId;
}

/** A fresh game whose players are two signed-up accounts. */
export function seatedGame(white: string, black: string): ActiveGameState {
  const created = createActiveGame({
    gameId: GAME_ID,
    players: { white: player(white), black: player(black) },
    controlLeases: LEASES,
    timeControl: { kind: "sudden_death", initialMs: duration(INITIAL_MS) },
    startedAtMonotonicMs: ms(START_MS),
  });
  if (!created.ok) throw new Error(`game not created: ${created.error}`);
  return created.value;
}

/**
 * TEST ADAPTER: seats assigned by the test, each session always holding
 * control under the game's stored lease. It is for tests of authentication;
 * seat control itself is tested over the real game access.
 */
export class TestGameAccess implements GameAccessProvider {
  readonly trust = "test_only";
  readonly #seats = new Map<string, StaticSeat[]>();

  assign(playerId: string, seat: StaticSeat): void {
    this.#seats.set(playerId, [...(this.#seats.get(playerId) ?? []), seat]);
  }

  /** Gives the account playing `seat` in `state` that seat and its control lease. */
  seat(state: ActiveGameState, seat: Seat): void {
    this.assign(state.players[seat], {
      gameId: state.gameId,
      seat,
      controlLeaseId: state.controlLeases[seat],
    });
  }

  async seatsOf(playerId: PlayerId): Promise<readonly SeatListing[]> {
    return (this.#seats.get(playerId) ?? []).map(({ gameId, seat }) => ({ gameId, seat }));
  }

  forSession(_session: AuthenticatedSession, playerId: PlayerId): SessionGameAuthority {
    return staticAuthority(this.#seats.get(playerId) ?? []);
  }
}

export interface AuthEdgeOptions extends AccountsHarnessOptions {
  readonly runtime?: RuntimeHarness;
  readonly limits?: Partial<EdgeLimits>;
  readonly accountsHarness?: AccountsHarness;
}

export interface AuthEdge {
  readonly h: AccountsHarness;
  readonly runtime: RuntimeHarness;
  readonly access: TestGameAccess;
  readonly facts: RecordingFacts<EdgeFact>;
  readonly defects: DefectLog;
  readonly edge: RealtimeEdge;
  close(): Promise<void>;
}

/** The edge with auth routes and the production session resolver, over test accounts. */
export function authEdge(options: AuthEdgeOptions = {}): AuthEdge {
  const h = options.accountsHarness ?? accountsHarness(options);
  const runtime = options.runtime ?? runtimeHarness();
  const access = new TestGameAccess();
  const facts = new RecordingFacts<EdgeFact>();
  const defects = new DefectLog();
  const edge = createRealtimeEdge({
    environment: "test",
    allowedOrigins: [ORIGIN],
    sessionResolver: new ProductionTrustedSessionResolver({
      sessions: h.accounts,
      gameAccess: access,
      cookie: sessionCookiePolicy("insecure_loopback"),
      maxCookieLength: 4_096,
    }),
    writers: runtime.registry,
    clock: new ManualClock(0),
    facts,
    reportDefect: defects.report,
    auth: { accounts: h.accounts, cookie: "insecure_loopback" },
    ...(options.limits === undefined ? {} : { limits: options.limits }),
  });
  let closing: Promise<void> | null = null;
  return {
    h,
    runtime,
    access,
    facts,
    defects,
    edge,
    close: () => {
      closing ??= (async () => {
        await edge.close();
        await runtime.registry.dispose();
      })();
      return closing;
    },
  };
}

/** Starts the edge on a loopback port; returns the ws:// base URL. */
export async function listening(auth: AuthEdge): Promise<string> {
  const address = await auth.edge.listen({ host: "127.0.0.1", port: 0 });
  return `ws://127.0.0.1:${address.port}`;
}

export interface CallOptions {
  readonly body?: unknown;
  readonly rawBody?: string;
  readonly cookie?: string;
  /** Null sends no Origin header. */
  readonly origin?: string | null;
  readonly contentType?: string | null;
  readonly headers?: Readonly<Record<string, string>>;
  readonly remoteAddress?: string;
}

export interface Answer {
  readonly status: number;
  readonly body: unknown;
  readonly text: string;
  readonly headers: Readonly<Record<string, string | string[] | number | undefined>>;
  readonly setCookie: readonly string[];
}

export async function call(
  auth: AuthEdge,
  method: "GET" | "POST" | "DELETE" | "PUT",
  url: string,
  options: CallOptions = {},
): Promise<Answer> {
  const headers = new Map<string, string>(Object.entries(options.headers ?? {}));
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  if (origin !== null) headers.set("origin", origin);
  if (options.cookie !== undefined) headers.set("cookie", options.cookie);
  const payload =
    options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  const contentType =
    options.contentType === undefined
      ? payload === undefined
        ? null
        : "application/json"
      : options.contentType;
  if (contentType !== null) headers.set("content-type", contentType);
  const response = await auth.edge.app.inject({
    method,
    url,
    headers: Object.fromEntries(headers),
    remoteAddress: options.remoteAddress ?? "198.51.100.7",
    ...(payload === undefined ? {} : { payload }),
  });
  const raw = response.headers["set-cookie"];
  const setCookie = raw === undefined ? [] : Array.isArray(raw) ? raw : [String(raw)];
  const text = response.body;
  return {
    status: response.statusCode,
    body: text === "" ? null : JSON.parse(text),
    text,
    headers: response.headers,
    setCookie,
  };
}

/** The `name=value` pair of the session cookie a response set, for the next request. */
export function sessionCookie(answer: Answer): string {
  const line = answer.setCookie.find((value) => value.startsWith(`${LOOPBACK_SESSION_COOKIE}=`));
  if (line === undefined)
    throw new Error(`no session cookie in ${JSON.stringify(answer.setCookie)}`);
  return line.slice(0, line.indexOf(";"));
}

export function tokenOf(cookie: string): string {
  return cookie.slice(cookie.indexOf("=") + 1);
}

export async function registerOver(
  auth: AuthEdge,
  username: string,
  password = "correct horse battery staple",
): Promise<{ readonly cookie: string; readonly userId: string; readonly answer: Answer }> {
  const answer = await call(auth, "POST", "/auth/register", {
    body: { username, email: `${username.toLowerCase()}@example.test`, password },
  });
  if (answer.status !== 201) throw new Error(`register ${answer.status}: ${answer.text}`);
  const userId = field(answer.body, "user", "userId");
  if (typeof userId !== "string") throw new Error("no user id");
  return { cookie: sessionCookie(answer), userId, answer };
}
