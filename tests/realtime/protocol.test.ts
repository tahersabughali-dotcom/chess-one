import {
  CLIENT_JSON_LIMITS,
  DEFAULT_EDGE_LIMITS,
  decodeClientMessage,
  encodeCommandResponse,
  encodeSnapshot,
  parseStrictJson,
  REALTIME_PROTOCOL,
  SNAPSHOT_FORMAT,
  TokenBucket,
} from "@chess-one/edge";
import { BoundedQueue } from "@chess-one/live-game-runtime";
import { describe, expect, it } from "vitest";
import {
  GAME_ID,
  moveCommand,
  newGame,
  offerCommand,
  resignCommand,
  respondCommand,
  submit,
} from "../live-game/support/harness.ts";
import { runtimeHarness, store, viewOf, writerOf } from "./support/runtime.ts";

const LIMITS = { maxDepth: 2, maxStringLength: 16, maxObjectKeys: 4, maxArrayLength: 2 };

describe("TST-PROTO strict JSON", () => {
  it("TST-PROTO-001 objects are Maps: __proto__, constructor, and prototype are plain keys and pollute nothing", () => {
    const parsed = parseStrictJson(
      '{"__proto__":{"polluted":1},"constructor":2,"prototype":3}',
      LIMITS,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toBeInstanceOf(Map);
    expect(parsed.value instanceof Map ? [...parsed.value.keys()] : null).toEqual([
      "__proto__",
      "constructor",
      "prototype",
    ]);
    expect(Reflect.get({}, "polluted")).toBeUndefined();
  });

  it("TST-PROTO-002 duplicates, depth, sizes, and malformed text are rejected while parsing", () => {
    const cases: readonly (readonly [string, string])[] = [
      ['{"a":1,"a":1}', "duplicate_key"],
      ['{"a":{"b":{"c":1}}}', "too_deep"],
      ['{"a":"12345678901234567"}', "string_too_long"],
      ['{"a":1,"b":2,"c":3,"d":4,"e":5}', "too_many_keys"],
      ["[1,2,3]", "array_too_long"],
      ['"\\udc00"', "malformed_unicode"],
      ['"\\ud800x"', "malformed_unicode"],
      ["1e400", "number_out_of_range"],
      ['{"a":1,}', "invalid_json"],
      ["{'a':1}", "invalid_json"],
      ['"tab\there"', "invalid_json"],
      ['"\\x41"', "invalid_json"],
      ["01", "invalid_json"],
      ["NaN", "invalid_json"],
      ["", "invalid_json"],
      ["true false", "invalid_json"],
    ];
    for (const [text, error] of cases) {
      expect([text, parseStrictJson(text, LIMITS)]).toEqual([text, { ok: false, error }]);
    }
  });

  it("TST-PROTO-003 well-formed input parses exactly, surrogate pairs included", () => {
    expect(parseStrictJson(' {"a" : [1, -2.5e1], "b":null} ', LIMITS)).toEqual({
      ok: true,
      value: new Map<string, unknown>([
        ["a", [1, -25]],
        ["b", null],
      ]),
    });
    expect(parseStrictJson('"\\ud83d\\ude00\\n\\u0041"', LIMITS)).toEqual({
      ok: true,
      value: "😀\nA",
    });
  });
});

describe("TST-PROTO client messages", () => {
  const s0 = newGame();
  const withOffer = submit(s0, offerCommand(s0, "white"), 1_010, "white").nextState;

  it("TST-PROTO-010 every client message type and command decodes to exactly its fields", () => {
    expect(
      decodeClientMessage(JSON.stringify({ type: "hello", protocol: REALTIME_PROTOCOL })),
    ).toEqual({
      ok: true,
      message: { type: "hello" },
    });
    expect(decodeClientMessage('{"type":"ping"}')).toEqual({
      ok: true,
      message: { type: "ping", nonce: null },
    });
    expect(decodeClientMessage('{"type":"sync_game","gameId":"game-1"}')).toEqual({
      ok: true,
      message: { type: "sync_game", requestId: null, gameId: GAME_ID },
    });
    expect(
      decodeClientMessage('{"type":"claim_game_control","requestId":"c-1","gameId":"game-1"}'),
    ).toEqual({
      ok: true,
      message: { type: "claim_game_control", requestId: "c-1", gameId: GAME_ID },
    });
    expect(
      decodeClientMessage('{"type":"claim_game_control","gameId":"game-1","seat":"white"}'),
    ).toEqual({ ok: false, violation: { code: "UNKNOWN_FIELD", field: null } });
    const commands = [
      moveCommand(s0, "e2e4", { clientSan: "e4" }),
      moveCommand(s0, "e2e4", { promotionPiece: "q" }),
      { ...moveCommand(s0, "e2e4"), actorId: "player-alice", clientObservedAt: 5 },
      resignCommand(s0, "black"),
      offerCommand(s0, "white"),
      respondCommand(withOffer, "black", "accept"),
      {
        command: "ClaimDrawCommand.v1",
        contractVersion: "1",
        gameId: GAME_ID,
        clientCommandId: "claim-1",
        controlLeaseId: s0.controlLeases.white,
        expectedGameSequence: 0,
        claimKind: "threefold_repetition",
        fromSquare: "g1",
        toSquare: "f3",
      },
    ];
    for (const command of commands) {
      const { controlLeaseId: _sent, ...withoutLease } = command;
      const expected = {
        ok: true,
        message: { type: "game_command", requestId: "r-1", gameId: GAME_ID, command: withoutLease },
      };
      expect(
        decodeClientMessage(JSON.stringify({ type: "game_command", requestId: "r-1", command })),
      ).toEqual(expected);
      expect(
        decodeClientMessage(
          JSON.stringify({ type: "game_command", requestId: "r-1", command: withoutLease }),
        ),
      ).toEqual(expected);
    }
  });

  it("TST-PROTO-012 a client control lease is still type- and length-checked, then discarded", () => {
    const s0 = newGame();
    const send = (controlLeaseId: unknown) =>
      decodeClientMessage(
        JSON.stringify({
          type: "game_command",
          command: { ...moveCommand(s0, "e2e4"), controlLeaseId },
        }),
      );
    expect(send(7)).toEqual({
      ok: false,
      violation: { code: "INVALID_FIELD", field: "controlLeaseId" },
    });
    expect(send("x".repeat(129))).toMatchObject({ ok: false });
    const decoded = send("any-lease-the-client-likes");
    expect(decoded.ok).toBe(true);
    expect(JSON.stringify(decoded)).not.toContain("any-lease-the-client-likes");
  });

  it("TST-PROTO-011 the largest legal message fits the frame limit, which stays at or under 16 KiB", () => {
    const id = "i".repeat(128);
    const largest = JSON.stringify({
      type: "game_command",
      requestId: "r".repeat(64),
      command: {
        command: "ClaimDrawCommand.v1",
        contractVersion: "1".repeat(8),
        gameId: "g".repeat(128),
        clientCommandId: id,
        controlLeaseId: id,
        expectedGameSequence: Number.MAX_SAFE_INTEGER,
        actorId: id,
        clientObservedAt: -Number.MAX_VALUE,
        claimKind: "c".repeat(32),
        fromSquare: "f".repeat(8),
        toSquare: "t".repeat(8),
        promotionPiece: "p".repeat(8),
      },
    });
    expect(new TextEncoder().encode(largest).byteLength).toBeLessThan(
      DEFAULT_EDGE_LIMITS.maxMessageBytes,
    );
    expect(DEFAULT_EDGE_LIMITS.maxMessageBytes).toBeLessThanOrEqual(16_384);
    expect(CLIENT_JSON_LIMITS).toEqual({
      maxDepth: 2,
      maxStringLength: 128,
      maxObjectKeys: 16,
      maxArrayLength: 0,
    });
  });
});

describe("TST-PROTO server encoding", () => {
  it("TST-PROTO-020 game_snapshot.v1 has exactly its documented fields and no internals", async () => {
    const h = runtimeHarness();
    await store(h, newGame());
    const view = await viewOf(writerOf(h));
    const snapshot = encodeSnapshot(view, "black", false);
    expect(Object.keys(snapshot).sort()).toEqual(
      [
        "canClaimControl",
        "clock",
        "controlHeld",
        "format",
        "gameId",
        "pendingDrawOffer",
        "playable",
        "positionFen",
        "recoveryReason",
        "recoveryRequired",
        "rulesetId",
        "seat",
        "sequence",
        "sideToMove",
        "status",
      ].sort(),
    );
    expect(snapshot.format).toBe(SNAPSHOT_FORMAT);
    expect(snapshot.seat).toBe("black");
    expect(snapshot).toMatchObject({ controlHeld: false, canClaimControl: true });
    expect(encodeSnapshot(view, "black", true)).toMatchObject({
      controlHeld: true,
      canClaimControl: false,
    });
    expect(JSON.stringify(snapshot)).not.toMatch(/lease|session|player-/i);
    expect(Object.keys(snapshot.clock).sort()).toEqual([
      "activeSide",
      "blackMs",
      "running",
      "whiteMs",
    ]);
  });

  it("TST-PROTO-021 a command response on the wire carries no receivedAt, anchor, or lease", () => {
    const s0 = newGame();
    const decision = submit(s0, moveCommand(s0, "e2e4"), 1_234);
    const wire = encodeCommandResponse(decision.response);
    expect(wire).toMatchObject({ code: "Accepted", sequence: 1, san: "e4", replayed: false });
    expect(JSON.stringify(wire)).not.toMatch(/receivedAt|anchor|lease|1234/i);
  });
});

describe("TST-PROTO bounded structures", () => {
  it("TST-PROTO-030 the token bucket allows the burst, refills at the rate, and never exceeds the burst", () => {
    const bucket = new TokenBucket(3, 2, 0);
    expect([bucket.take(0), bucket.take(0), bucket.take(0), bucket.take(0)]).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(bucket.take(499)).toBe(false);
    expect(bucket.take(500)).toBe(true);
    expect(bucket.take(500)).toBe(false);
    expect([
      bucket.take(100_000),
      bucket.take(100_000),
      bucket.take(100_000),
      bucket.take(100_000),
    ]).toEqual([true, true, true, false]);
    expect(bucket.take(50)).toBe(false);
  });

  it("TST-PROTO-031 the bounded queue is FIFO across wraparound and refuses instead of growing", () => {
    const queue = new BoundedQueue<number>(3);
    expect([queue.offer(1), queue.offer(2), queue.offer(3), queue.offer(4)]).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect([queue.shift(), queue.shift()]).toEqual([1, 2]);
    expect([queue.offer(5), queue.offer(6), queue.offer(7)]).toEqual([true, true, false]);
    expect([queue.shift(), queue.shift(), queue.shift(), queue.shift()]).toEqual([
      3,
      5,
      6,
      undefined,
    ]);
    expect(queue.size).toBe(0);
    expect(() => new BoundedQueue<number>(0)).toThrow();
    expect(() => new BoundedQueue<number>(1.5)).toThrow();
  });
});
