import { setTimeout as sleep } from "node:timers/promises";
import type { TrustedSessionResolver } from "@chess-one/edge";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  actorFor,
  GAME_ID,
  INITIAL_MS,
  LEASES,
  moveCommand,
  newGame,
  OTHER_GAME_ID,
  PLAYERS,
  playMoves,
  START_MS,
} from "../live-game/support/harness.ts";
import { ContractRepository } from "../live-game-persistence/support/contract-repository.ts";
import { activeWithBindings } from "../live-game-persistence/support/states.ts";
import {
  connect,
  field,
  ORIGIN,
  openClient,
  ready,
  type TestClient,
  typeOf,
} from "./support/client.ts";
import {
  commandMessage,
  type EdgeHarness,
  type EdgeHarnessOptions,
  edgeHarness,
  SteppingClock,
  TOKENS,
} from "./support/edge.ts";
import { DOMAIN_OLD, IDLE_MS, runtimeHarness, store, storedState } from "./support/runtime.ts";

const harnesses: EdgeHarness[] = [];

async function start(options: EdgeHarnessOptions = {}): Promise<EdgeHarness> {
  const h = await edgeHarness(options);
  harnesses.push(h);
  return h;
}

afterEach(async () => {
  const open = harnesses.splice(0);
  await Promise.all(open.map((h) => h.close()));
  for (const h of open) {
    expect(h.defects.errors).toEqual([]);
    expect(h.runtime.defects.errors).toEqual([]);
  }
});

/** Sequences of every state message, in the order the client received them. */
function stateSequences(client: TestClient): unknown[] {
  return client.received
    .filter((message) => typeOf(message) === "game_snapshot" || typeOf(message) === "game_update")
    .map((message) => field(message, "snapshot", "sequence"));
}

function isNonDecreasing(values: readonly unknown[]): boolean {
  return values.every((value, index) => {
    const previous = values[index - 1];
    return (
      index === 0 ||
      (typeof value === "number" && typeof previous === "number" && value >= previous)
    );
  });
}

/** Every message sent to `client` before this call has arrived once this resolves. */
async function drained(client: TestClient, nonce = "drain"): Promise<void> {
  client.send({ type: "ping", nonce });
  await client.next("pong");
}

async function players(h: EdgeHarness): Promise<{ white: TestClient; black: TestClient }> {
  const white = await ready(h.url, TOKENS.white);
  const black = await ready(h.url, TOKENS.black);
  await white.sync(GAME_ID);
  await black.sync(GAME_ID);
  return { white, black };
}

describe("TST-EDGE upgrade gating: refused before any WebSocket exists", () => {
  it("TST-EDGE-001 only GET /realtime upgrades; other paths and query strings are 404; plain HTTP gets 426", async () => {
    const h = await start();
    for (const path of ["/realtime/extra", "/realtime?v=1", "/", "/REALTIME"]) {
      expect(await openClient(h.url, { token: TOKENS.white, path })).toMatchObject({
        kind: "refused",
        status: 404,
        body: { code: "NOT_FOUND" },
      });
    }
    const plain = await h.edge.app.inject({ method: "GET", url: "/realtime" });
    expect(plain.statusCode).toBe(426);
    expect(plain.json()).toEqual({ code: "UPGRADE_REQUIRED" });
    expect(h.sessions.seen).toEqual([]);
    expect(h.edge.connectionCount).toBe(0);
  });

  it("TST-EDGE-002 the protocol version is the subprotocol: missing or unknown is UNSUPPORTED_PROTOCOL_VERSION", async () => {
    const h = await start();
    for (const protocols of [[], ["chess_one.realtime.v2"], ["chess_one.realtime"]]) {
      expect(await openClient(h.url, { token: TOKENS.white, protocols })).toMatchObject({
        kind: "refused",
        status: 400,
        body: { code: "UNSUPPORTED_PROTOCOL_VERSION" },
      });
    }
    expect(h.sessions.seen).toEqual([]);
    const client = await connect(h.url, {
      token: TOKENS.white,
      protocols: ["chess_one.realtime.v2", "chess_one.realtime.v1"],
    });
    expect(client.socket.protocol).toBe("chess_one.realtime.v1");
  });

  it("TST-EDGE-003 the origin must be exactly on the allowlist", async () => {
    const h = await start();
    for (const origin of [
      null,
      "http://evil.example",
      "http://127.0.0.1:5174",
      "null",
      `${ORIGIN}/`,
    ]) {
      expect(await openClient(h.url, { token: TOKENS.white, origin })).toMatchObject({
        kind: "refused",
        status: 403,
        body: { code: "ORIGIN_NOT_ALLOWED" },
      });
    }
    expect(h.sessions.seen).toEqual([]);
  });

  it("TST-EDGE-004 identity comes only from the trusted resolver: no or unknown credentials are 401", async () => {
    const h = await start();
    for (const token of [null, "not-a-token"]) {
      expect(await openClient(h.url, { token })).toMatchObject({
        kind: "refused",
        status: 401,
        body: { code: "UNAUTHENTICATED" },
      });
    }
    expect(h.sessions.seen).toEqual([
      { authorization: null, cookie: null },
      { authorization: "Bearer not-a-token", cookie: null },
    ]);
  });

  it("TST-EDGE-005 oversized credentials are refused before session resolution", async () => {
    const h = await start();
    const opened = await openClient(h.url, {
      token: TOKENS.white,
      headers: { cookie: `s=${"x".repeat(4_100)}` },
    });
    expect(opened).toMatchObject({
      kind: "refused",
      status: 400,
      body: { code: "CREDENTIAL_TOO_LARGE" },
    });
    expect(h.sessions.seen).toEqual([]);
  });

  it("TST-EDGE-006 a failing, hanging, or invalid resolver fails closed with 503 and reports the defect", async () => {
    const throwing: TrustedSessionResolver = {
      trust: "test_only",
      resolve: async () => {
        throw new Error("resolver down");
      },
    };
    const hanging: TrustedSessionResolver = {
      trust: "test_only",
      resolve: () => Promise.withResolvers<null>().promise,
    };
    const invalid: TrustedSessionResolver = {
      trust: "test_only",
      resolve: async () => ({
        actorId: PLAYERS.white,
        grants: [
          { gameId: GAME_ID, seat: "white", controlLeaseId: LEASES.white },
          { gameId: GAME_ID, seat: "black", controlLeaseId: LEASES.black },
        ],
      }),
    };
    for (const [resolver, defects] of [
      [throwing, 1],
      [hanging, 0],
      [invalid, 1],
    ] as const) {
      const h = await start({ resolver, limits: { sessionResolveTimeoutMs: 50 } });
      expect(await openClient(h.url, { token: TOKENS.white })).toMatchObject({
        kind: "refused",
        status: 503,
        body: { code: "SESSION_UNAVAILABLE" },
      });
      expect(h.defects.errors.splice(0)).toHaveLength(defects);
      expect(h.edge.connectionCount).toBe(0);
    }
  });

  it("TST-EDGE-007 connection capacity is bounded: over the limit is 503 SERVER_BUSY", async () => {
    const h = await start({ limits: { maxConnections: 1 } });
    const first = await connect(h.url, { token: TOKENS.white });
    expect(await openClient(h.url, { token: TOKENS.black })).toMatchObject({
      kind: "refused",
      status: 503,
      body: { code: "SERVER_BUSY" },
    });
    await first.close();
    await vi.waitFor(() => expect(h.edge.connectionCount).toBe(0));
    await connect(h.url, { token: TOKENS.black });
  });
});

describe("TST-EDGE handshake", () => {
  it("TST-EDGE-010 the first message must be hello; anything else closes with 1002", async () => {
    const h = await start();
    const client = await connect(h.url, { token: TOKENS.white });
    client.send({ type: "sync_game", gameId: GAME_ID });
    expect(await client.next("protocol_error")).toEqual({
      type: "protocol_error",
      code: "HELLO_REQUIRED",
      field: null,
    });
    expect(await client.closed).toEqual({ code: 1002, reason: "protocol_error" });
    expect(h.runtime.repository.loads).toBe(0);
  });

  it("TST-EDGE-011 hello with another version is UNSUPPORTED_PROTOCOL_VERSION and closes with 1002", async () => {
    const h = await start();
    const client = await connect(h.url, { token: TOKENS.white });
    client.send({ type: "hello", protocol: "chess_one.realtime.v2" });
    expect(await client.next("protocol_error")).toEqual({
      type: "protocol_error",
      code: "UNSUPPORTED_PROTOCOL_VERSION",
      field: "protocol",
    });
    expect((await client.closed).code).toBe(1002);
  });

  it("TST-EDGE-012 no hello within the handshake timeout closes with 1008", async () => {
    const h = await start({ limits: { handshakeTimeoutMs: 100 } });
    const client = await connect(h.url, { token: TOKENS.white });
    expect(await client.closed).toEqual({ code: 1008, reason: "hello_timeout" });
  });

  it("TST-EDGE-013 connection_ready carries the trusted actor and seats, never leases or credentials", async () => {
    const h = await start();
    const client = await connect(h.url, { token: TOKENS.white });
    const readyMessage = await client.hello();
    expect(readyMessage).toEqual({
      type: "connection_ready",
      protocol: "chess_one.realtime.v1",
      actorId: PLAYERS.white,
      games: [
        { gameId: GAME_ID, seat: "white" },
        { gameId: OTHER_GAME_ID, seat: "white" },
      ],
      limits: {
        maxMessageBytes: 4_096,
        heartbeatIntervalMs: 15_000,
        inboundBurst: 20,
        inboundRefillPerSecond: 10,
      },
    });
    const text = JSON.stringify(readyMessage);
    expect(text).not.toContain(LEASES.white);
    expect(text).not.toContain(TOKENS.white);
    client.send({ type: "hello", protocol: "chess_one.realtime.v1" });
    expect(await client.next("protocol_error")).toMatchObject({ code: "HELLO_ALREADY_RECEIVED" });
    client.send({ type: "ping", nonce: "n-1" });
    expect(await client.next("pong")).toEqual({ type: "pong", nonce: "n-1" });
  });
});

const move = JSON.stringify({
  command: "SubmitMoveCommand.v1",
  contractVersion: "1",
  gameId: GAME_ID,
  clientCommandId: "white-0-e2e4",
  controlLeaseId: LEASES.white,
  expectedGameSequence: 0,
  fromSquare: "e2",
  toSquare: "e4",
});

function commandWith(change: string): string {
  return `{"type":"game_command","command":${move.slice(0, -1)}${change}}}`;
}

const MALFORMED: readonly (readonly [string, string, string | null])[] = [
  ["not json", "MALFORMED_JSON", null],
  ["", "MALFORMED_JSON", null],
  ['{"type":"ping"} trailing', "MALFORMED_JSON", null],
  ["null", "NOT_AN_OBJECT", null],
  ["[]", "NOT_AN_OBJECT", null],
  ['"ping"', "NOT_AN_OBJECT", null],
  ["42", "NOT_AN_OBJECT", null],
  ['[{"type":"hello"}]', "ARRAY_NOT_ALLOWED", null],
  ['{"type":"launch"}', "UNKNOWN_MESSAGE_TYPE", "type"],
  ['{"type":7}', "UNKNOWN_MESSAGE_TYPE", "type"],
  ['{"nonce":"a"}', "MISSING_FIELD", "type"],
  ['{"type":"ping","type":"ping"}', "DUPLICATE_FIELD", null],
  ['{"type":"ping","nonce":{"a":{"b":1}}}', "NESTING_TOO_DEEP", null],
  ['{"__proto__":{"admin":true},"type":"ping"}', "UNKNOWN_FIELD", null],
  ['{"type":"ping","constructor":"x"}', "UNKNOWN_FIELD", null],
  ['{"type":"ping","prototype":{"admin":true}}', "UNKNOWN_FIELD", null],
  ['{"type":"ping","nonce":"\\ud800"}', "MALFORMED_UNICODE", null],
  [`{"type":"ping","nonce":"${"x".repeat(129)}"}`, "FIELD_TOO_LONG", null],
  [`{"type":"ping","nonce":"${"x".repeat(65)}"}`, "FIELD_TOO_LONG", "nonce"],
  ['{"type":"ping","nonce":"a b"}', "INVALID_FIELD", "nonce"],
  ['{"type":"ping","nonce":1e999}', "NUMBER_OUT_OF_RANGE", null],
  [
    `{"type":"ping",${Array.from({ length: 16 }, (_, i) => `"k${i}":1`).join(",")}}`,
    "TOO_MANY_FIELDS",
    null,
  ],
  ['{"type":"sync_game","gameId":"game-1","admin":true}', "UNKNOWN_FIELD", null],
  ['{"type":"sync_game","gameId":7}', "INVALID_FIELD", "gameId"],
  ['{"type":"sync_game","requestId":"bad id!","gameId":"game-1"}', "INVALID_FIELD", "requestId"],
  ['{"type":"game_command","command":"x"}', "INVALID_FIELD", "command"],
  [
    '{"type":"game_command","command":{"command":"LaunchMissiles.v1","gameId":"game-1"}}',
    "UNKNOWN_COMMAND",
    "command",
  ],
  [commandWith(',"result":"white_win"'), "UNKNOWN_FIELD", null],
  [commandWith(',"receivedAtMonotonicMs":1'), "UNKNOWN_FIELD", null],
  [commandWith(',"seat":"black"'), "UNKNOWN_FIELD", null],
  [commandWith(',"clientSan":"e4","clientSan":"e4"'), "DUPLICATE_FIELD", null],
  [
    commandWith("").replace('"expectedGameSequence":0', '"expectedGameSequence":"0"'),
    "INVALID_FIELD",
    "expectedGameSequence",
  ],
  [
    commandWith("").replace('"clientCommandId":"white-0-e2e4",', ""),
    "MISSING_FIELD",
    "clientCommandId",
  ],
];

describe("TST-EDGE parsing security: nothing invalid reaches the runtime", () => {
  it("TST-EDGE-014 malformed, hostile, and out-of-schema messages are protocol errors with schema-only fields", async () => {
    const h = await start({ edgeClock: new SteppingClock(), limits: { maxProtocolErrors: 100 } });
    await store(h.runtime, newGame());
    const client = await ready(h.url, TOKENS.white);
    for (const [text, code, fieldName] of MALFORMED) {
      client.sendRaw(text);
      expect([text, await client.next("protocol_error")]).toEqual([
        text,
        { type: "protocol_error", code, field: fieldName },
      ]);
    }
    client.sendRaw(Buffer.from([1, 2, 3]), true);
    expect(await client.next("protocol_error")).toMatchObject({ code: "BINARY_NOT_SUPPORTED" });
    client.sendRaw(Buffer.from([0x7b, 0xff, 0xfe, 0x7d]));
    expect(await client.next("protocol_error")).toMatchObject({ code: "MALFORMED_UNICODE" });

    await drained(client);
    expect(client.isClosed).toBe(false);
    expect(h.runtime.repository.loads).toBe(0);
    expect(h.runtime.registry.size).toBe(0);
    expect(h.facts.count("malformed_message")).toBe(MALFORMED.length + 2);
    expect(Reflect.get({}, "admin")).toBeUndefined();
    expect(Reflect.get(Object.prototype, "admin")).toBeUndefined();
  });

  it("TST-EDGE-015 a frame over maxMessageBytes closes with 1009 before it is parsed", async () => {
    const h = await start({ limits: { maxMessageBytes: 1_024 } });
    const client = await ready(h.url, TOKENS.white);
    client.sendRaw(`{"type":"ping","nonce":"${"x".repeat(1_024)}"}`);
    expect((await client.closed).code).toBe(1009);
    expect(h.facts.count("message_too_large")).toBe(1);
    expect(h.facts.count("malformed_message")).toBe(0);
    await vi.waitFor(() =>
      expect(h.facts.named("connection_closed")).toMatchObject([{ reason: "message_too_large" }]),
    );
  });

  it("TST-EDGE-016 repeated protocol errors after hello close the connection with 1002", async () => {
    const h = await start({ limits: { maxProtocolErrors: 3 } });
    const client = await ready(h.url, TOKENS.white);
    for (let i = 0; i < 3; i += 1) client.sendRaw("{");
    expect(await client.closed).toEqual({ code: 1002, reason: "protocol_error" });
    expect(client.unread("protocol_error")).toHaveLength(3);
  });
});

describe("TST-EDGE live play over WebSocket", () => {
  it("TST-EDGE-020 sync returns game_snapshot.v1 with no monotonic anchor, lease, binding, or player id", async () => {
    const h = await start();
    const s0 = newGame();
    await store(h.runtime, s0);
    const client = await ready(h.url, TOKENS.white);
    const message = await client.sync(GAME_ID, "sync-7");
    expect(message).toEqual({
      type: "game_snapshot",
      requestId: "sync-7",
      snapshot: {
        format: "game_snapshot.v1",
        gameId: GAME_ID,
        rulesetId: s0.rulesetId,
        sequence: 0,
        positionFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        sideToMove: "white",
        seat: "white",
        status: { kind: "active" },
        playable: true,
        recoveryRequired: false,
        recoveryReason: null,
        clock: { whiteMs: INITIAL_MS, blackMs: INITIAL_MS, activeSide: "white", running: true },
        pendingDrawOffer: null,
      },
    });
    expect(JSON.stringify(message)).not.toMatch(
      /lease|anchor|fingerprint|domain|binding|player-|receivedAt/i,
    );
  });

  it("TST-EDGE-021 a move: DB commit, command_response to the mover before game_update, game_update to the opponent", async () => {
    const h = await start();
    const s0 = newGame();
    await store(h.runtime, s0);
    const { white, black } = await players(h);
    h.runtime.clock.set(1_500);
    white.send(commandMessage(moveCommand(s0, "e2e4"), "mv-1"));
    const response = await white.next("command_response");
    expect(response).toEqual({
      type: "command_response",
      requestId: "mv-1",
      response: {
        gameId: GAME_ID,
        command: "SubmitMoveCommand.v1",
        clientCommandId: "white-0-e2e4",
        code: "Accepted",
        detail: null,
        replayed: false,
        sequence: 1,
        san: "e4",
        status: { kind: "active" },
        clock: {
          whiteMs: INITIAL_MS - 500,
          blackMs: INITIAL_MS,
          activeSide: "black",
          running: true,
        },
      },
    });
    expect(JSON.stringify(response)).not.toMatch(/receivedAt|anchor|lease/i);
    expect(field(await white.next("game_update"), "snapshot", "sequence")).toBe(1);
    expect(white.types().slice(-2)).toEqual(["command_response", "game_update"]);
    const update = await black.next("game_update");
    expect(field(update, "snapshot")).toMatchObject({
      sequence: 1,
      seat: "black",
      sideToMove: "black",
    });
    expect(black.unread("command_response")).toEqual([]);
    expect((await storedState(h.runtime)).sequence).toBe(1);
    expect(h.runtime.repository.commits).toBe(1);
  });

  it("TST-EDGE-022 the seat comes from the session: a forged command or a game outside the session is refused", async () => {
    const h = await start();
    const s0 = newGame();
    await store(h.runtime, s0);
    const { white, black } = await players(h);
    black.send(commandMessage({ ...moveCommand(s0, "e2e4"), actorId: PLAYERS.white }, "forged"));
    const forged = await black.next("command_response");
    expect(field(forged, "response", "code")).not.toBe("Accepted");
    await drained(white);
    expect(white.unread("game_update")).toEqual([]);
    expect(h.runtime.repository.commits).toBe(0);

    const stranger = await ready(h.url, TOKENS.stranger);
    stranger.send({ type: "sync_game", requestId: "s-1", gameId: GAME_ID });
    expect(await stranger.next("request_failed")).toEqual({
      type: "request_failed",
      requestId: "s-1",
      code: "GAME_ACCESS_DENIED",
      retryable: false,
      clientCommandId: null,
    });
    stranger.send(commandMessage(moveCommand(s0, "e2e4"), "s-2"));
    expect(await stranger.next("request_failed")).toMatchObject({
      code: "GAME_ACCESS_DENIED",
      clientCommandId: "white-0-e2e4",
    });
    expect(h.runtime.registry.peek(GAME_ID)?.subscriberCount).toBe(2);
    expect(h.runtime.repository.commits).toBe(0);
  });

  it("TST-EDGE-023 resending a command replays the stored response: no second transition, no second update", async () => {
    const h = await start();
    const s0 = newGame();
    await store(h.runtime, s0);
    const { white, black } = await players(h);
    const command = moveCommand(s0, "e2e4");
    white.send(commandMessage(command, "mv-1"));
    await white.next("command_response");
    await black.next("game_update");
    white.send(commandMessage(command, "mv-2"));
    const replay = await white.next("command_response");
    expect(field(replay, "response")).toMatchObject({
      code: "Accepted",
      replayed: true,
      sequence: 1,
    });
    await drained(black);
    expect(black.unread("game_update")).toEqual([]);
    expect(h.runtime.repository.commits).toBe(1);
  });

  it("TST-EDGE-024 a disconnect changes nothing; reconnect and sync return the stored state", async () => {
    const h = await start();
    const s0 = newGame();
    await store(h.runtime, s0);
    const { white, black } = await players(h);
    h.runtime.clock.set(1_500);
    white.send(commandMessage(moveCommand(s0, "e2e4")));
    await white.next("command_response");
    expect(await white.close()).toEqual({ code: 1000, reason: "" });
    await vi.waitFor(() => expect(h.edge.connectionCount).toBe(1));
    expect(h.runtime.registry.peek(GAME_ID)?.subscriberCount).toBe(1);
    const stored = await storedState(h.runtime);
    expect(stored.sequence).toBe(1);
    expect(h.runtime.repository.commits).toBe(1);

    h.runtime.clock.set(6_500);
    const again = await ready(h.url, TOKENS.white);
    const snapshot = field(await again.sync(GAME_ID), "snapshot");
    expect(snapshot).toMatchObject({
      sequence: stored.sequence,
      sideToMove: "black",
      clock: {
        whiteMs: INITIAL_MS - 500,
        blackMs: INITIAL_MS - 5_000,
        activeSide: "black",
        running: true,
      },
    });
    await drained(black);
  });

  it("TST-EDGE-025 a burst from both players is decided in ingress order; no client ever sees a sequence go back", async () => {
    const h = await start();
    const s0 = newGame();
    const s1 = playMoves(s0, ["e2e4"]).state;
    const s2 = playMoves(s0, ["e2e4", "e7e5"]).state;
    await store(h.runtime, s0);
    const { white, black } = await players(h);
    h.runtime.repository.hold();
    const sends: readonly (readonly [TestClient, number, unknown])[] = [
      [white, 1_100, commandMessage(moveCommand(s0, "e2e4"), "a")],
      [black, 1_200, commandMessage(moveCommand(s1, "e7e5"), "b")],
      [white, 1_300, commandMessage(moveCommand(s2, "g1f3"), "c")],
    ];
    for (const [index, [client, time, message]] of sends.entries()) {
      h.runtime.clock.set(time);
      client.send(message);
      await vi.waitFor(() => expect(h.facts.count("command_submitted")).toBe(index + 1));
    }
    h.runtime.clock.set(90_000);
    h.runtime.repository.release();
    const a = await white.next("command_response");
    const b = await black.next("command_response");
    const c = await white.next("command_response");
    expect([a, b, c].map((r) => [field(r, "requestId"), field(r, "response", "sequence")])).toEqual(
      [
        ["a", 1],
        ["b", 2],
        ["c", 3],
      ],
    );
    expect(field(c, "response", "clock")).toEqual({
      whiteMs: INITIAL_MS - 200,
      blackMs: INITIAL_MS - 100,
      activeSide: "black",
      running: true,
    });
    await vi.waitFor(() => expect(black.unread("game_update")).toHaveLength(3));
    await drained(white);
    expect(stateSequences(white)).toEqual([0, 1, 2, 3]);
    expect(stateSequences(black)).toEqual([0, 1, 2, 3]);
    expect(isNonDecreasing(stateSequences(white))).toBe(true);
  });

  it("TST-EDGE-026 the deadline is exact in the writer's clock: receivedAt = D is timely; the flag needs no socket", async () => {
    const h = await start();
    const s0 = newGame({ initialMs: 5_000 });
    await store(h.runtime, s0);
    const white = await ready(h.url, TOKENS.white);
    await white.sync(GAME_ID);
    h.runtime.clock.set(START_MS + 5_000);
    white.send(commandMessage(moveCommand(s0, "e2e4")));
    expect(field(await white.next("command_response"), "response")).toMatchObject({
      code: "Accepted",
      clock: { whiteMs: 0, blackMs: 5_000 },
    });
    await white.close();
    await vi.waitFor(() => expect(h.edge.connectionCount).toBe(0));
    const wake = await vi.waitFor(() => h.runtime.scheduler.single(IDLE_MS));
    expect(wake.delayMs).toBe(5_001);
    h.runtime.clock.set(START_MS + 10_001);
    h.runtime.scheduler.fire(wake);
    await vi.waitFor(() => expect(h.runtime.facts.count("deadline_flagged")).toBe(1));

    const black = await ready(h.url, TOKENS.black);
    expect(field(await black.sync(GAME_ID), "snapshot")).toMatchObject({
      sequence: 2,
      playable: false,
      status: { kind: "unresolved", reason: "MATING_POSSIBILITY_UNRESOLVED", side: "black" },
      clock: { blackMs: 0, running: false },
    });

    const late = await start({ runtime: runtimeHarness() });
    await store(late.runtime, newGame({ initialMs: 5_000 }));
    const lateWhite = await ready(late.url, TOKENS.white);
    late.runtime.clock.set(START_MS + 5_001);
    lateWhite.send(commandMessage(moveCommand(s0, "e2e4")));
    expect(field(await lateWhite.next("command_response"), "response", "code")).toBe(
      "MoveReceivedAfterDeadline",
    );
  });

  it("TST-EDGE-027 several connections of one player share the writer; only the issuer gets the response", async () => {
    const h = await start();
    const s0 = newGame();
    await store(h.runtime, s0);
    const { white, black } = await players(h);
    const second = await ready(h.url, TOKENS.white);
    await second.sync(GAME_ID);
    expect(h.runtime.registry.peek(GAME_ID)?.subscriberCount).toBe(3);
    white.send(commandMessage(moveCommand(s0, "e2e4")));
    await white.next("command_response");
    await second.next("game_update");
    await black.next("game_update");
    await drained(second);
    expect(second.unread("command_response")).toEqual([]);
  });

  it("TST-EDGE-028 per-connection subscriptions are bounded; a granted but unknown game is GAME_NOT_FOUND", async () => {
    const h = await start({ limits: { maxGamesPerConnection: 1 } });
    await store(h.runtime, newGame());
    const white = await ready(h.url, TOKENS.white);
    await white.sync(GAME_ID);
    white.send({ type: "sync_game", requestId: "two", gameId: OTHER_GAME_ID });
    expect(await white.next("request_failed")).toMatchObject({
      code: "SUBSCRIPTION_LIMIT",
      requestId: "two",
    });

    const open = await start();
    const other = await ready(open.url, TOKENS.white);
    other.send({ type: "sync_game", requestId: "missing", gameId: OTHER_GAME_ID });
    expect(await other.next("request_failed")).toEqual({
      type: "request_failed",
      requestId: "missing",
      code: "GAME_NOT_FOUND",
      retryable: false,
      clientCommandId: null,
    });
  });
});

describe("TST-EDGE failures reach the client as retryable refusals, never as false success", () => {
  it("TST-EDGE-030 a full writer queue answers server_busy WRITER_QUEUE_FULL; the command was not received", async () => {
    const h = await start({ runtime: runtimeHarness({ maxQueuedRequests: 1 }) });
    const s0 = newGame();
    await store(h.runtime, s0);
    const white = await ready(h.url, TOKENS.white);
    await white.sync(GAME_ID);
    h.runtime.repository.hold();
    white.send({ type: "sync_game", requestId: "held", gameId: GAME_ID });
    await vi.waitFor(() => expect(h.runtime.repository.heldLoads).toBe(1));
    white.send(commandMessage(moveCommand(s0, "e2e4"), "busy"));
    expect(await white.next("server_busy")).toEqual({
      type: "server_busy",
      requestId: "busy",
      code: "WRITER_QUEUE_FULL",
      retryable: true,
      clientCommandId: "white-0-e2e4",
    });
    h.runtime.repository.release();
    await white.next("game_snapshot");
    expect(h.runtime.repository.commits).toBe(0);
    white.send(commandMessage(moveCommand(s0, "e2e4"), "retry"));
    expect(field(await white.next("command_response"), "response")).toMatchObject({
      code: "Accepted",
      replayed: false,
      sequence: 1,
    });
  });

  it("TST-EDGE-031 a persistence failure pauses play: recovery_required PERSISTENCE_UNAVAILABLE to the mover and every subscriber, no update, no SQLSTATE, play refused", async () => {
    const h = await start();
    const s0 = newGame();
    await store(h.runtime, s0);
    const { white, black } = await players(h);
    const command = moveCommand(s0, "e2e4");
    h.runtime.repository.commitFault = "fail";
    white.send(commandMessage(command, "try-1"));
    const notice = {
      type: "recovery_required",
      requestId: null,
      gameId: GAME_ID,
      reason: "PERSISTENCE_UNAVAILABLE",
      clientCommandId: null,
    };
    expect(await white.next("recovery_required")).toEqual(notice);
    expect(await white.next("recovery_required")).toEqual({
      ...notice,
      requestId: "try-1",
      clientCommandId: "white-0-e2e4",
    });
    expect(await black.next("recovery_required")).toEqual(notice);
    await drained(black);
    expect(black.unread("game_update")).toEqual([]);
    expect(white.unread("command_response")).toEqual([]);
    expect(h.runtime.repository.commits).toBe(0);

    h.runtime.repository.commitFault = "none";
    white.send(commandMessage(command, "try-2"));
    expect(await white.next("recovery_required")).toEqual({
      ...notice,
      requestId: "try-2",
      clientCommandId: "white-0-e2e4",
    });
    expect(field(await black.sync(GAME_ID, "s-1"), "snapshot")).toMatchObject({
      sequence: 0,
      playable: false,
      recoveryRequired: true,
      recoveryReason: "PERSISTENCE_UNAVAILABLE",
      clock: { whiteMs: INITIAL_MS, blackMs: INITIAL_MS, running: false },
    });
    expect(await black.next("recovery_required")).toEqual({ ...notice, requestId: "s-1" });
    expect(h.runtime.repository.commits).toBe(0);
    const wire = JSON.stringify([...white.received, ...black.received]);
    expect(wire).not.toMatch(/08006|sqlstate|postgres|stack|relation|trigger/i);
  });

  it("TST-EDGE-032 a real concurrency conflict: recovery_required CONCURRENCY_OWNERSHIP_UNCERTAIN, then sync_required; no update, no writer started by itself, play refused, the store is served", async () => {
    const contract = new ContractRepository();
    const h = await start({ runtime: runtimeHarness({}, contract) });
    const other = runtimeHarness({}, contract);
    const s0 = newGame();
    await store(h.runtime, s0);
    const { white, black } = await players(h);
    const foreign = moveCommand(s0, "d2d4");
    h.runtime.repository.beforeCommit = async () => {
      const answer = Promise.withResolvers<unknown>();
      const writer = other.registry.acquire(GAME_ID);
      if (writer === null) throw new Error("no writer in the other process");
      writer.submitCommand(actorFor(s0, "white"), foreign, answer.resolve);
      expect(await answer.promise).toMatchObject({ response: { code: "Accepted" } });
    };
    white.send(commandMessage(moveCommand(s0, "e2e4"), "c-1"));
    const notice = {
      type: "recovery_required",
      requestId: null,
      gameId: GAME_ID,
      reason: "CONCURRENCY_OWNERSHIP_UNCERTAIN",
      clientCommandId: null,
    };
    expect(await white.next("recovery_required")).toEqual(notice);
    expect(await white.next("recovery_required")).toEqual({
      ...notice,
      requestId: "c-1",
      clientCommandId: "white-0-e2e4",
    });
    const stopped = { type: "sync_required", gameId: GAME_ID, reason: "WRITER_STOPPED" };
    expect(await white.next("sync_required")).toEqual(stopped);
    expect(await black.next("recovery_required")).toEqual(notice);
    expect(await black.next("sync_required")).toEqual(stopped);
    await drained(white);
    await drained(black);
    expect(white.unread("game_update")).toEqual([]);
    expect(black.unread("game_update")).toEqual([]);
    expect(white.unread("command_response")).toEqual([]);
    expect(h.runtime.registry.size).toBe(0);
    expect(h.runtime.scheduler.pending()).toEqual([]);

    h.runtime.clock.set(900_000);
    const stored = await storedState(h.runtime);
    expect(stored.sequence).toBe(1);
    expect(field(await black.sync(GAME_ID, "resync"), "snapshot")).toMatchObject({
      sequence: 1,
      playable: false,
      recoveryRequired: true,
      recoveryReason: "CONCURRENCY_OWNERSHIP_UNCERTAIN",
      clock: {
        whiteMs: stored.clock.remainingMs.white,
        blackMs: stored.clock.remainingMs.black,
        running: false,
      },
    });
    expect(await black.next("recovery_required")).toEqual({ ...notice, requestId: "resync" });
    white.send(commandMessage(moveCommand(s0, "e2e4"), "c-2"));
    expect(await white.next("recovery_required")).toEqual({
      ...notice,
      requestId: "c-2",
      clientCommandId: "white-0-e2e4",
    });
    expect(h.runtime.repository.commits).toBe(0);
    expect(await storedState(h.runtime)).toEqual(stored);
    expect(h.runtime.scheduler.pending().filter((wake) => wake.delayMs !== IDLE_MS)).toEqual([]);
    await other.registry.dispose();
    expect(other.defects.errors).toEqual([]);
  });

  it("TST-EDGE-033 a recovery-paused game: snapshot marked, recovery_required sent, play refused, stored replays answered", async () => {
    const h = await start();
    const fixture = activeWithBindings();
    await store(h.runtime, fixture.state, DOMAIN_OLD);
    const black = await ready(h.url, TOKENS.black);
    black.send({ type: "sync_game", requestId: "r-1", gameId: GAME_ID });
    expect(field(await black.next("game_snapshot"), "snapshot")).toMatchObject({
      sequence: fixture.state.sequence,
      playable: false,
      recoveryRequired: true,
      recoveryReason: "RECOVERY_PAUSED_CLOCK_DOMAIN_CHANGED",
      clock: { running: false },
    });
    const required = {
      type: "recovery_required",
      requestId: "r-1",
      gameId: GAME_ID,
      reason: "RECOVERY_PAUSED_CLOCK_DOMAIN_CHANGED",
      clientCommandId: null,
    };
    expect(await black.next("recovery_required")).toEqual(required);
    const fresh = moveCommand(fixture.state, "g8f6");
    black.send(commandMessage(fresh, "r-2"));
    expect(await black.next("recovery_required")).toEqual({
      ...required,
      requestId: "r-2",
      clientCommandId: fresh.clientCommandId,
    });
    black.send(
      commandMessage(
        {
          command: "SubmitMoveCommand.v1",
          contractVersion: "1",
          gameId: GAME_ID,
          clientCommandId: "black-3-bad-promotion",
          controlLeaseId: LEASES.black,
          expectedGameSequence: 3,
          fromSquare: "b8",
          toSquare: "c6",
          promotionPiece: "q",
        },
        "r-3",
      ),
    );
    expect(field(await black.next("command_response"), "response")).toMatchObject({
      code: "InvalidState",
      replayed: true,
    });
    expect(h.runtime.repository.commits).toBe(0);
    expect(h.runtime.scheduler.pending().filter((wake) => wake.delayMs !== IDLE_MS)).toEqual([]);
  });

  it("TST-EDGE-035 a writer fault reaches clients as recovery_required WRITER_FAULT with no error text; the exception goes only to the defect report", async () => {
    const h = await start();
    const s0 = newGame();
    await store(h.runtime, s0);
    const { white, black } = await players(h);
    h.runtime.repository.loadThrows = true;
    white.send(commandMessage(moveCommand(s0, "e2e4"), "f-1"));
    const notice = {
      type: "recovery_required",
      requestId: null,
      gameId: GAME_ID,
      reason: "WRITER_FAULT",
      clientCommandId: null,
    };
    expect(await white.next("recovery_required")).toEqual(notice);
    expect(await white.next("recovery_required")).toEqual({
      ...notice,
      requestId: "f-1",
      clientCommandId: "white-0-e2e4",
    });
    expect(await black.next("recovery_required")).toEqual(notice);
    expect(await black.next("sync_required")).toMatchObject({ reason: "WRITER_STOPPED" });
    await drained(white);
    const wire = JSON.stringify([...white.received, ...black.received]);
    expect(wire).not.toMatch(/injected|defect|error|stack|\.ts/i);
    expect(h.runtime.facts.named("writer_fault")).toEqual([
      { name: "writer_fault", gameId: GAME_ID, job: "command" },
    ]);
    expect(h.runtime.defects.errors).toHaveLength(1);
    h.runtime.defects.errors.splice(0);
  });

  it("TST-EDGE-034 writer capacity is bounded: a new game over the limit is server_busy WRITER_CAPACITY", async () => {
    const h = await start({ runtime: runtimeHarness({ maxWriters: 1 }) });
    await store(h.runtime, newGame());
    const white = await ready(h.url, TOKENS.white);
    await white.sync(GAME_ID);
    white.send({ type: "sync_game", requestId: "cap", gameId: OTHER_GAME_ID });
    expect(await white.next("server_busy")).toMatchObject({
      code: "WRITER_CAPACITY",
      requestId: "cap",
    });
  });
});

describe("TST-EDGE flow control", () => {
  it("TST-EDGE-040 a slow consumer is closed with 1008 at the outbound limit; the game and other players are unaffected", async () => {
    const h = await start({
      edgeClock: new SteppingClock(),
      limits: { maxOutboundBufferBytes: 8_192, closeTimeoutMs: 20_000 },
    });
    await store(h.runtime, newGame());
    const { white, black } = await players(h);
    white.socket.pause();
    const burst = JSON.stringify({ type: "sync_game", gameId: GAME_ID });
    for (let batch = 0; batch < 400 && h.facts.count("slow_consumer") === 0; batch += 1) {
      for (let i = 0; i < 250; i += 1) white.sendRaw(burst);
      await sleep(5);
    }
    expect(h.facts.count("slow_consumer")).toBe(1);
    white.socket.resume();
    expect(await white.closed).toEqual({ code: 1008, reason: "slow_consumer" });
    expect(isNonDecreasing(stateSequences(white))).toBe(true);
    await drained(black);
    expect(h.runtime.repository.commits).toBe(0);
    expect((await storedState(h.runtime)).sequence).toBe(0);
    await vi.waitFor(() => expect(h.runtime.registry.peek(GAME_ID)?.subscriberCount).toBe(1));
    const again = await ready(h.url, TOKENS.white);
    expect(field(await again.sync(GAME_ID), "snapshot", "sequence")).toBe(0);
  });

  it("TST-EDGE-041 an inbound flood is dropped unparsed, answered RATE_LIMITED once, then closed with 1008; others are unaffected", async () => {
    const h = await start({
      limits: { inboundBurst: 5, inboundRefillPerSecond: 1, maxRateLimitStrikes: 20 },
    });
    const s0 = newGame();
    await store(h.runtime, s0);
    const black = await ready(h.url, TOKENS.black);
    expect(field(await black.sync(GAME_ID, "before"), "snapshot", "sequence")).toBe(0);
    const white = await ready(h.url, TOKENS.white);
    const loadsBefore = h.runtime.repository.loads;
    for (let i = 0; i < 40; i += 1) white.send(commandMessage(moveCommand(s0, "e2e4"), `f-${i}`));
    expect(await white.closed).toEqual({ code: 1008, reason: "rate_limited" });
    expect(white.received.filter((message) => typeOf(message) === "server_busy")).toEqual([
      {
        type: "server_busy",
        requestId: null,
        code: "RATE_LIMITED",
        retryable: true,
        clientCommandId: null,
      },
    ]);
    expect(h.facts.count("command_submitted")).toBe(4);
    expect(field(await black.sync(GAME_ID, "after"), "snapshot", "sequence")).toBe(1);
    expect(h.runtime.repository.loads - loadsBefore).toBe(5);
    expect(h.runtime.repository.commits).toBe(1);
  });

  it("TST-EDGE-042 a connection that stops answering heartbeats is terminated", async () => {
    const h = await start({ limits: { heartbeatIntervalMs: 50 } });
    const white = await ready(h.url, TOKENS.white);
    white.socket.pause();
    await vi.waitFor(() => expect(h.facts.count("dead_connection")).toBe(1));
    await vi.waitFor(() => expect(h.edge.connectionCount).toBe(0));
    white.socket.resume();
    await white.closed;
  });
});

describe("TST-EDGE lifecycle and hygiene", () => {
  it("TST-EDGE-050 repeated connect, sync, and disconnect leaves no connection or subscriber behind", async () => {
    const h = await start();
    await store(h.runtime, newGame());
    for (let i = 0; i < 10; i += 1) {
      const client = await ready(h.url, i % 2 === 0 ? TOKENS.white : TOKENS.black);
      await client.sync(GAME_ID);
      await client.close();
    }
    await vi.waitFor(() => expect(h.edge.connectionCount).toBe(0));
    expect(h.runtime.registry.peek(GAME_ID)?.subscriberCount).toBe(0);
    expect(h.facts.count("connection_opened")).toBe(10);
    expect(h.facts.count("connection_closed")).toBe(10);
  });

  it("TST-EDGE-051 facts carry codes and ids only: no token, credential, or lease", async () => {
    const h = await start();
    const s0 = newGame();
    await store(h.runtime, s0);
    await openClient(h.url, { token: "leaked-token-value" });
    const { white } = await players(h);
    white.send(commandMessage(moveCommand(s0, "e2e4")));
    await white.next("command_response");
    white.sendRaw("{");
    await white.next("protocol_error");
    const recorded = JSON.stringify([h.facts.facts, h.runtime.facts.facts]);
    for (const secret of [
      "leaked-token-value",
      TOKENS.white,
      TOKENS.black,
      "Bearer",
      LEASES.white,
      LEASES.black,
    ]) {
      expect(recorded).not.toContain(secret);
    }
  });

  it("TST-EDGE-052 shutdown closes every connection with 1000 and disposes nothing mid-decision", async () => {
    const h = await start();
    await store(h.runtime, newGame());
    const { white, black } = await players(h);
    await h.close();
    expect(await white.closed).toEqual({ code: 1000, reason: "server_shutdown" });
    expect(await black.closed).toEqual({ code: 1000, reason: "server_shutdown" });
    expect(h.runtime.registry.size).toBe(0);
    const codes = h.facts
      .named("connection_closed")
      .map((fact) => ("code" in fact ? fact.code : null));
    expect(codes).toEqual([1000, 1000]);
  });
});
