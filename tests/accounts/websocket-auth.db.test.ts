import { newSecretToken } from "@chess-one/accounts";
import { PostgresAccountsRepository } from "@chess-one/accounts-persistence";
import { type ActiveGameState, isPlayerId, type PlayerId } from "@chess-one/live-game";
import { PostgresLiveGameRepository } from "@chess-one/live-game-persistence";
import { sql } from "kysely";
import { describe, expect, it } from "vitest";
import {
  duration,
  GAME_ID,
  INITIAL_MS,
  LEASES,
  moveCommand,
} from "../live-game/support/harness.ts";
import {
  type Closure,
  connect,
  field,
  ORIGIN,
  openClient,
  type TestClient,
} from "../realtime/support/client.ts";
import { commandMessage } from "../realtime/support/edge.ts";
import { runtimeHarness } from "../realtime/support/runtime.ts";
import { type AccountsSchema, withAccountsSchema } from "./support/db.ts";
import { PASSWORD } from "./support/harness.ts";
import { type AuthEdge, type AuthEdgeOptions, authEdge, listening } from "./support/http.ts";

/**
 * Batch 10 §58 end to end over the real stack: PostgreSQL for accounts and
 * games, real HTTP (fetch) for register, login, and logout, a real ws client,
 * the production session resolver, and a test-only game-access adapter that
 * assigns the seats matchmaking will assign later.
 */
const APP = "chess-one-auth-e2e-test";
const CLOSE_WAIT_MS = 3_000;

interface Stack {
  readonly auth: AuthEdge;
  readonly ws: string;
  readonly http: string;
}

async function withStack(
  options: Omit<AuthEdgeOptions, "repository" | "runtime">,
  run: (stack: Stack, schema: AccountsSchema) => Promise<void>,
): Promise<void> {
  await withAccountsSchema(APP, { migrateLiveGame: true }, async (schema) => {
    const auth = authEdge({
      ...options,
      repository: new PostgresAccountsRepository(schema.accounts()),
      runtime: runtimeHarness({}, new PostgresLiveGameRepository(schema.liveGame())),
    });
    try {
      const ws = await listening(auth);
      await run({ auth, ws, http: ws.replace("ws://", "http://") }, schema);
    } finally {
      await auth.close();
    }
    expect(auth.defects.errors).toEqual([]);
    expect(auth.runtime.defects.errors).toEqual([]);
    expect(auth.h.defects.errors).toEqual([]);
  });
}

async function post(
  stack: Stack,
  path: string,
  body: Readonly<Record<string, string>>,
  cookie?: string,
): Promise<Response> {
  const headers = new Headers({ origin: ORIGIN, "content-type": "application/json" });
  if (cookie !== undefined) headers.set("cookie", cookie);
  return fetch(`${stack.http}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

async function me(stack: Stack, cookie: string): Promise<number> {
  const response = await fetch(`${stack.http}/auth/me`, { headers: { cookie } });
  await response.body?.cancel();
  return response.status;
}

/** The `name=value` of the one Set-Cookie a response carried. */
function cookieOf(response: Response): string {
  const lines = response.headers.getSetCookie();
  expect(lines).toHaveLength(1);
  const [line = ""] = lines;
  return line.slice(0, line.indexOf(";"));
}

function player(value: unknown): PlayerId {
  if (typeof value !== "string" || !isPlayerId(value)) throw new Error("not a player id");
  return value;
}

async function signUp(stack: Stack, username: string): Promise<PlayerId> {
  const response = await post(stack, "/auth/register", {
    username,
    email: `${username.toLowerCase()}@example.test`,
    password: PASSWORD,
  });
  expect(response.status).toBe(201);
  return player(field(await response.json(), "user", "userId"));
}

async function logIn(stack: Stack, identifier: string): Promise<string> {
  const response = await post(stack, "/auth/login", { identifier, password: PASSWORD });
  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  const cookie = cookieOf(response);
  expect(JSON.stringify(body)).not.toContain(cookie.slice(cookie.indexOf("=") + 1));
  return cookie;
}

async function startGame(stack: Stack, white: PlayerId, black: PlayerId): Promise<ActiveGameState> {
  const game = await stack.auth.runtime.registry.startGame({
    gameId: GAME_ID,
    players: { white, black },
    controlLeases: LEASES,
    timeControl: { kind: "sudden_death", initialMs: duration(INITIAL_MS) },
  });
  if (!game.ok) throw new Error(`game not started: ${JSON.stringify(game.error)}`);
  stack.auth.access.seat(game.value.state, "white");
  stack.auth.access.seat(game.value.state, "black");
  return game.value.state;
}

function closedWithin(client: TestClient): Promise<Closure> {
  return Promise.race([
    client.closed,
    new Promise<Closure>((_resolve, reject) => {
      setTimeout(() => reject(new Error("socket still open")), CLOSE_WAIT_MS);
    }),
  ]);
}

describe("TST-AUTH-E2E real login, real WebSocket, PostgreSQL (§58)", () => {
  it("TST-AUTH-E2E-001 user, login, cookie, socket, identity, seat, sync, command, logout, revocation, refused reconnect", async () => {
    await withStack({}, async (stack, schema) => {
      // 1. Create users (real HTTP registration).
      const whiteId = await signUp(stack, "Whitey");
      const blackId = await signUp(stack, "Blacky");
      // 2–3. Real login; the session cookie is the only credential returned.
      const cookie = await logIn(stack, "whitey@example.test");
      expect(cookie).toMatch(/^chess_one_session=[A-Za-z0-9_-]{43}$/);
      const blackCookie = await logIn(stack, "blacky");
      const game = await startGame(stack, whiteId, blackId);

      // 4. A real WebSocket carrying the cookie, and nothing else.
      const white = await connect(stack.ws, { token: null, headers: { cookie } });
      const black = await connect(stack.ws, { token: null, headers: { cookie: blackCookie } });
      // 5. The resolver identified the account.
      const ready = await white.hello();
      expect(field(ready, "actorId")).toBe(whiteId);
      // 6. Game access granted the seat (the lease stays server-side).
      expect(field(ready, "games")).toEqual([{ gameId: GAME_ID, seat: "white" }]);
      expect(field(await black.hello(), "actorId")).toBe(blackId);
      // 7. Sync.
      expect(field(await white.sync(GAME_ID), "snapshot", "sequence")).toBe(0);
      await black.sync(GAME_ID);
      // 8. A command, committed to PostgreSQL.
      white.send(commandMessage(moveCommand(game, "e2e4"), "mv-1"));
      expect(field(await white.next("command_response"), "response", "code")).toBe("Accepted");
      expect(field(await black.next("game_update"), "snapshot", "sequence")).toBe(1);
      const stored = await sql<{ sequence: string }>`
        select sequence::text as sequence from live_games`.execute(schema.liveGame());
      expect(stored.rows.map((row) => row.sequence)).toEqual(["1"]);
      expect(JSON.stringify([...white.received, ...black.received])).not.toMatch(
        /example\.test|@|password|token_hash/i,
      );

      // 9. Logout over real HTTP.
      const logout = await post(stack, "/auth/logout", {}, cookie);
      expect(logout.status).toBe(204);
      expect(logout.headers.getSetCookie()).toEqual([
        "chess_one_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
      ]);
      // 10. Revoked in PostgreSQL, and the open socket ends at once.
      expect(await closedWithin(white)).toEqual({ code: 1008, reason: "session_ended" });
      const revoked = await sql<{ reason: string | null }>`
        select s.revocation_reason as reason from user_sessions s
        where s.user_id = ${whiteId}::uuid order by s.created_at`.execute(schema.accounts(1));
      expect(revoked.rows.map((row) => row.reason)).toEqual([null, "logout"]);
      // 11. The same cookie can neither reconnect nor call the API.
      expect(await openClient(stack.ws, { token: null, headers: { cookie } })).toMatchObject({
        kind: "refused",
        status: 401,
      });
      expect(await me(stack, cookie)).toBe(401);
      // The opponent's session is untouched.
      black.send({ type: "ping", nonce: "still-here" });
      expect(field(await black.next("pong"), "nonce")).toBe("still-here");
      await black.close();
    });
  });

  it("TST-AUTH-E2E-002 a revocation written by another process closes the socket at the next recheck", async () => {
    await withStack({ limits: { sessionRecheckIntervalMs: 100 } }, async (stack, schema) => {
      const userId = await signUp(stack, "Taher");
      const cookie = await logIn(stack, "taher");
      const client = await connect(stack.ws, { token: null, headers: { cookie } });
      await client.hello();
      await sql`update user_sessions set revoked_at = now(), revocation_reason = 'logout_all'
                where user_id = ${userId}::uuid`.execute(schema.accounts(1));
      expect(await closedWithin(client)).toEqual({ code: 1008, reason: "session_ended" });
      expect(await me(stack, cookie)).toBe(401);
    });
  });

  it("TST-AUTH-E2E-003 session fixation: a cookie planted before login is never adopted", async () => {
    await withStack({}, async (stack) => {
      await signUp(stack, "Taher");
      const planted = `chess_one_session=${newSecretToken()}`;
      const response = await post(
        stack,
        "/auth/login",
        { identifier: "taher", password: PASSWORD },
        planted,
      );
      expect(response.status).toBe(200);
      await response.body?.cancel();
      const issued = cookieOf(response);
      expect(issued).not.toBe(planted);
      expect(await me(stack, planted)).toBe(401);
      expect(await me(stack, issued)).toBe(200);
    });
  });
});
