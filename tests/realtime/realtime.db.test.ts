import { formatFen } from "@chess-one/chess-rules";
import { type ActiveGameState, type GameId, isGameId } from "@chess-one/live-game";
import { PostgresLiveGameRepository } from "@chess-one/live-game-persistence";
import type { RecoveryReason } from "@chess-one/live-game-runtime";
import { describe, expect, it, vi } from "vitest";
import {
  actorFor,
  duration,
  GAME_ID,
  INITIAL_MS,
  LEASES,
  moveCommand,
  newGame,
  OTHER_GAME_ID,
  PLAYERS,
  playMoves,
  resignCommand,
  START_MS,
} from "../live-game/support/harness.ts";
import {
  type DisposableSchema,
  withDisposableSchema,
} from "../live-game-persistence/support/disposable-schema.ts";
import { positionOf } from "../rules/support/positions.ts";
import { field, ready } from "./support/client.ts";
import { commandMessage, type EdgeHarness, edgeHarness, TOKENS } from "./support/edge.ts";
import {
  DOMAIN_A,
  domain,
  IDLE_MS,
  type RuntimeHarness,
  runtimeHarness,
} from "./support/runtime.ts";

/**
 * Realtime end to end over the real stack: ws client, Fastify + ws edge,
 * writer registry, live-game core, and PostgreSQL in a disposable schema.
 * Without a test database these FAIL with the BLOCKED message; they never skip.
 */
const APPLICATION = "chess-one-realtime-test";
const DOMAIN_RESTARTED = domain("rt-boot-restarted");

function gameId(value: string): GameId {
  if (!isGameId(value)) throw new Error(`invalid game id ${value}`);
  return value;
}

const THIRD_GAME_ID = gameId("game-3");

interface Stack {
  readonly runtime: RuntimeHarness;
  readonly edge: EdgeHarness;
}

async function stackOver(schema: DisposableSchema, domainId = DOMAIN_A): Promise<Stack> {
  const runtime = runtimeHarness({}, new PostgresLiveGameRepository(schema.pool()), domainId);
  const edge = await edgeHarness({ runtime });
  return { runtime, edge };
}

async function started(stack: Stack): Promise<ActiveGameState> {
  const game = await stack.runtime.registry.startGame({
    gameId: GAME_ID,
    players: PLAYERS,
    controlLeases: LEASES,
    timeControl: { kind: "sudden_death", initialMs: duration(INITIAL_MS) },
  });
  if (!game.ok) throw new Error(`game not started: ${JSON.stringify(game.error)}`);
  return game.value.state;
}

function expectClean(stack: Stack): void {
  expect(stack.edge.defects.errors).toEqual([]);
  expect(stack.runtime.defects.errors).toEqual([]);
}

/** A 1-second game read long after its start: paused, at full balances, with no deadline timer. */
async function expectPausedUncharged(
  h: RuntimeHarness,
  id: GameId,
  reason: RecoveryReason,
): Promise<void> {
  const writer = h.registry.acquire(id);
  if (writer === null) throw new Error("no writer");
  const answer = Promise.withResolvers<unknown>();
  writer.requestSync(answer.resolve);
  expect(await answer.promise).toMatchObject({
    kind: "snapshot",
    view: {
      condition: "infrastructure_paused",
      recoveryReason: reason,
      clock: { remainingMs: { white: 1_000, black: 1_000 }, running: false },
    },
  });
  expect(h.scheduler.pending().filter((wake) => wake.delayMs !== IDLE_MS)).toEqual([]);
  expect(h.facts.count("deadline_flagged")).toBe(0);
}

describe("TST-RT-DB realtime over PostgreSQL", () => {
  it("TST-RT-DB-001 end to end: create, connect, sync, move, commit, respond, update, reconnect, sync, replay once", async () => {
    await withDisposableSchema(APPLICATION, async (schema) => {
      const stack = await stackOver(schema);
      try {
        // 1. A persisted game, created by the registry in its clock domain.
        const s0 = await started(stack);
        expect(await schema.counts(GAME_ID)).toEqual({
          sequence: 0,
          statusKind: "active",
          clockDomainId: DOMAIN_A,
          bindings: 0,
          outbox: 0,
        });
        // 2-3. Both players connect and sync.
        const white = await ready(stack.edge.url, TOKENS.white);
        const black = await ready(stack.edge.url, TOKENS.black);
        expect(field(await white.sync(GAME_ID), "snapshot", "sequence")).toBe(0);
        expect(field(await black.sync(GAME_ID), "snapshot", "sequence")).toBe(0);
        // 4. White moves.
        stack.runtime.clock.set(START_MS + 700);
        const command = moveCommand(s0, "e2e4");
        white.send(commandMessage(command, "e2e-1"));
        // 6. White gets the response, which is sent only after the commit.
        expect(field(await white.next("command_response"), "response")).toMatchObject({
          code: "Accepted",
          replayed: false,
          sequence: 1,
          san: "e4",
          clock: {
            whiteMs: INITIAL_MS - 700,
            blackMs: INITIAL_MS,
            activeSide: "black",
            running: true,
          },
        });
        // 5. The database committed the transition.
        expect(await schema.counts(GAME_ID)).toMatchObject({ sequence: 1, bindings: 1, outbox: 0 });
        // 7. Black gets the update.
        expect(field(await black.next("game_update"), "snapshot")).toMatchObject({
          sequence: 1,
          sideToMove: "black",
          seat: "black",
        });
        // 8. White disconnects; nothing changes.
        await white.close();
        await vi.waitFor(() => expect(stack.edge.edge.connectionCount).toBe(1));
        expect(await schema.counts(GAME_ID)).toMatchObject({ sequence: 1, bindings: 1 });
        // 9-11. White reconnects and syncs to exactly the stored sequence.
        stack.runtime.clock.set(START_MS + 2_700);
        const again = await ready(stack.edge.url, TOKENS.white);
        const snapshot = field(await again.sync(GAME_ID, "after-reconnect"), "snapshot");
        const stored = await schema.counts(GAME_ID);
        expect(field(snapshot, "sequence")).toBe(stored.sequence);
        expect(field(snapshot, "clock")).toEqual({
          whiteMs: INITIAL_MS - 700,
          blackMs: INITIAL_MS - 2_000,
          activeSide: "black",
          running: true,
        });
        // 12. The same command again is a replay.
        again.send(commandMessage(command, "e2e-2"));
        expect(field(await again.next("command_response"), "response")).toMatchObject({
          code: "Accepted",
          replayed: true,
          sequence: 1,
        });
        // 13. No second transition.
        expect(await schema.counts(GAME_ID)).toEqual(stored);
        expect(stack.runtime.repository.commits).toBe(1);
        expect(black.unread("game_update")).toEqual([]);
      } finally {
        await stack.edge.close();
      }
      expectClean(stack);
    });
  });

  it("TST-RT-DB-002 a PostgreSQL failure inside the commit pauses play at the last durable balances: nothing durable changes, and play stays refused after the database recovers", async () => {
    await withDisposableSchema(APPLICATION, async (schema) => {
      const stack = await stackOver(schema);
      try {
        const s0 = await started(stack);
        const white = await ready(stack.edge.url, TOKENS.white);
        const black = await ready(stack.edge.url, TOKENS.black);
        await white.sync(GAME_ID);
        await black.sync(GAME_ID);
        const reader = new PostgresLiveGameRepository(schema.pool());
        const before = await reader.loadGame(GAME_ID);
        if (!before.ok) throw new Error("game not loaded");
        const durable = await schema.counts(GAME_ID);

        // A running game; White thinks for 450 ms and plays a legal move.
        stack.runtime.clock.set(START_MS + 450);
        const command = moveCommand(s0, "e2e4");
        await schema.rejectUpdates();
        white.send(commandMessage(command, "pg-1"));
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
          requestId: "pg-1",
          clientCommandId: command.clientCommandId,
        });
        expect(await black.next("recovery_required")).toEqual(notice);

        // Position, sequence, balances, bindings, and outbox are the last durable ones.
        expect(await schema.counts(GAME_ID)).toEqual({
          sequence: 0,
          statusKind: "active",
          clockDomainId: DOMAIN_A,
          bindings: 0,
          outbox: 0,
        });
        const after = await reader.loadGame(GAME_ID);
        if (!after.ok) throw new Error("game not loaded");
        expect(formatFen(after.value.state.position)).toBe(formatFen(before.value.state.position));
        expect(after.value.state.clock).toEqual(before.value.state.clock);
        expect(after.value.state.commandBindings).toEqual([]);
        expect(stack.runtime.facts.named("persistence_failure")).toEqual([
          { name: "persistence_failure", gameId: GAME_ID, operation: "commit" },
        ]);
        expect(stack.runtime.facts.count("command_accepted")).toBe(0);
        expect(white.unread("command_response")).toEqual([]);
        expect(black.unread("game_update")).toEqual([]);
        expect(
          stack.runtime.scheduler.pending().filter((wake) => wake.delayMs !== IDLE_MS),
        ).toEqual([]);

        // The database answers again; ten minutes pass. Nothing resumes and nothing is charged.
        await schema.allowUpdates();
        stack.runtime.clock.set(START_MS + 600_000);
        white.send(commandMessage(command, "pg-2"));
        expect(await white.next("recovery_required")).toEqual({
          ...notice,
          requestId: "pg-2",
          clientCommandId: command.clientCommandId,
        });
        const resign = resignCommand(s0, "black");
        black.send(commandMessage(resign, "pg-3"));
        expect(await black.next("recovery_required")).toEqual({
          ...notice,
          requestId: "pg-3",
          clientCommandId: resign.clientCommandId,
        });
        expect(field(await black.sync(GAME_ID, "pg-4"), "snapshot")).toMatchObject({
          sequence: 0,
          status: { kind: "active" },
          playable: false,
          recoveryRequired: true,
          recoveryReason: "PERSISTENCE_UNAVAILABLE",
          clock: { whiteMs: INITIAL_MS, blackMs: INITIAL_MS, running: false },
        });
        expect(await schema.counts(GAME_ID)).toEqual(durable);
        expect(stack.runtime.repository.commits).toBe(0);
        expect(stack.runtime.facts.count("deadline_flagged")).toBe(0);
        const wire = JSON.stringify([...white.received, ...black.received]);
        expect(wire).not.toMatch(/"Accepted"|game_update/);
        expect(wire).not.toMatch(/P0001|injected|sqlstate|postgres|trigger|stack|relation/i);
      } finally {
        await stack.edge.close();
      }
      expectClean(stack);
    });
  });

  it("TST-RT-DB-003 restart: a new clock domain pauses the game, sends recovery_required, refuses play, and still replays old bindings", async () => {
    await withDisposableSchema(APPLICATION, async (schema) => {
      const before = await stackOver(schema);
      const command = moveCommand(newGame(), "e2e4");
      try {
        await started(before);
        const white = await ready(before.edge.url, TOKENS.white);
        await white.sync(GAME_ID);
        white.send(commandMessage(command, "boot-a"));
        expect(field(await white.next("command_response"), "response", "code")).toBe("Accepted");
      } finally {
        await before.edge.close();
      }
      expectClean(before);
      expect(before.runtime.registry.size).toBe(0);
      const stored = await schema.counts(GAME_ID);
      expect(stored).toMatchObject({ sequence: 1, bindings: 1, clockDomainId: DOMAIN_A });

      const after = await stackOver(schema, DOMAIN_RESTARTED);
      try {
        const white = await ready(after.edge.url, TOKENS.white);
        const black = await ready(after.edge.url, TOKENS.black);
        white.send({ type: "sync_game", requestId: "resume-1", gameId: GAME_ID });
        expect(field(await white.next("game_snapshot"), "snapshot")).toMatchObject({
          sequence: 1,
          playable: false,
          recoveryRequired: true,
          clock: { running: false },
        });
        expect(await white.next("recovery_required")).toEqual({
          type: "recovery_required",
          requestId: "resume-1",
          gameId: GAME_ID,
          reason: "RECOVERY_PAUSED_CLOCK_DOMAIN_CHANGED",
          clientCommandId: null,
        });
        black.send(
          commandMessage(moveCommand(playMoves(newGame(), ["e2e4"]).state, "e7e5"), "b-1"),
        );
        expect(await black.next("recovery_required")).toMatchObject({ requestId: "b-1" });

        white.send(commandMessage(command, "old-binding"));
        expect(field(await white.next("command_response"), "response")).toMatchObject({
          code: "Accepted",
          replayed: true,
          sequence: 1,
        });
        expect(await schema.counts(GAME_ID)).toEqual(stored);
        expect(after.runtime.repository.commits).toBe(0);
        expect(
          after.runtime.scheduler.pending().filter((wake) => wake.delayMs !== IDLE_MS),
        ).toEqual([]);
        expect(after.runtime.facts.count("recovery_pause_encountered")).toBeGreaterThanOrEqual(1);
      } finally {
        await after.edge.close();
      }
      expectClean(after);
    });
  });

  it("TST-RT-DB-004 activation over PostgreSQL: with no client at all, deadlines are flagged and persisted by the rules (UNKNOWN unresolved, proven capability a result)", async () => {
    await withDisposableSchema(APPLICATION, async (schema) => {
      const runtime = runtimeHarness({}, new PostgresLiveGameRepository(schema.pool()));
      try {
        const short = newGame({ initialMs: 1_000 }).clock.timeControl;
        const unknown = await runtime.registry.startGame({
          gameId: GAME_ID,
          players: PLAYERS,
          controlLeases: LEASES,
          timeControl: short,
        });
        const proven = await runtime.registry.startGame({
          gameId: OTHER_GAME_ID,
          players: PLAYERS,
          controlLeases: LEASES,
          timeControl: short,
          startPosition: positionOf("4k3/8/8/8/8/8/8/3QK3 b - - 0 1"),
        });
        expect([unknown.ok && unknown.value.activation.kind]).toEqual(["watching"]);
        expect([proven.ok && proven.value.activation.kind]).toEqual(["watching"]);
        const wakes = runtime.scheduler.pending();
        expect(wakes.map((wake) => wake.delayMs)).toEqual([1_001, 1_001]);
        expect(runtime.registry.peek(GAME_ID)?.subscriberCount).toBe(0);

        runtime.clock.set(START_MS + 1_001);
        for (const wake of wakes) runtime.scheduler.fire(wake);
        await vi.waitFor(() => expect(runtime.facts.count("deadline_flagged")).toBe(2));
        expect(await schema.counts(GAME_ID)).toEqual({
          sequence: 1,
          statusKind: "unresolved",
          clockDomainId: DOMAIN_A,
          bindings: 0,
          outbox: 0,
        });
        expect(await schema.counts(OTHER_GAME_ID)).toEqual({
          sequence: 1,
          statusKind: "finished",
          clockDomainId: DOMAIN_A,
          bindings: 0,
          outbox: 1,
        });
        expect(runtime.scheduler.pending().filter((wake) => wake.delayMs !== IDLE_MS)).toEqual([]);
      } finally {
        await runtime.registry.dispose();
      }
      expect(runtime.defects.errors).toEqual([]);
    });
  });

  it("TST-RT-DB-005 two writers over one PostgreSQL database: the real sequence conflict pauses the game as CONCURRENCY_OWNERSHIP_UNCERTAIN; writer A stops, nothing restarts it, and the database stays the truth", async () => {
    await withDisposableSchema(APPLICATION, async (schema) => {
      const stack = await stackOver(schema);
      const other = runtimeHarness({}, new PostgresLiveGameRepository(schema.pool()));
      try {
        const s0 = await started(stack);
        const white = await ready(stack.edge.url, TOKENS.white);
        const black = await ready(stack.edge.url, TOKENS.black);
        await white.sync(GAME_ID);
        await black.sync(GAME_ID);

        // Another process commits between writer A's load and its commit.
        const foreign = moveCommand(s0, "d2d4");
        stack.runtime.repository.beforeCommit = async () => {
          const writer = other.registry.acquire(GAME_ID);
          if (writer === null) throw new Error("no writer in the other process");
          other.clock.set(START_MS + 300);
          const answer = Promise.withResolvers<unknown>();
          writer.submitCommand(actorFor(s0, "white"), foreign, answer.resolve);
          expect(await answer.promise).toMatchObject({ response: { code: "Accepted" } });
        };
        stack.runtime.clock.set(START_MS + 450);
        const own = moveCommand(s0, "e2e4");
        white.send(commandMessage(own, "own-1"));
        const notice = {
          type: "recovery_required",
          requestId: null,
          gameId: GAME_ID,
          reason: "CONCURRENCY_OWNERSHIP_UNCERTAIN",
          clientCommandId: null,
        };
        const stopped = { type: "sync_required", gameId: GAME_ID, reason: "WRITER_STOPPED" };
        expect(await white.next("recovery_required")).toEqual(notice);
        expect(await white.next("recovery_required")).toEqual({
          ...notice,
          requestId: "own-1",
          clientCommandId: own.clientCommandId,
        });
        expect(await white.next("sync_required")).toEqual(stopped);
        expect(await black.next("recovery_required")).toEqual(notice);
        expect(await black.next("sync_required")).toEqual(stopped);
        expect(stack.runtime.facts.named("concurrency_conflict")).toEqual([
          { name: "concurrency_conflict", gameId: GAME_ID, detectedBy: "commit" },
        ]);

        // PostgreSQL holds the other writer's move and nothing of writer A's.
        const durable = await schema.counts(GAME_ID);
        expect(durable).toEqual({
          sequence: 1,
          statusKind: "active",
          clockDomainId: DOMAIN_A,
          bindings: 1,
          outbox: 0,
        });
        const reader = new PostgresLiveGameRepository(schema.pool());
        const stored = await reader.loadGame(GAME_ID);
        if (!stored.ok) throw new Error("game not loaded");
        expect(stored.value.state.commandBindings.map((b) => b.clientCommandId)).toEqual([
          foreign.clientCommandId,
        ]);
        expect(stack.runtime.repository.commits).toBe(0);
        expect(stack.runtime.registry.size).toBe(0);
        expect(stack.runtime.facts.count("writer_created")).toBe(1);
        expect(stack.runtime.scheduler.pending()).toEqual([]);

        // Ten minutes later a client's own sync reads PostgreSQL: stopped, uncharged, refused.
        stack.runtime.clock.set(START_MS + 600_000);
        expect(field(await black.sync(GAME_ID, "resync"), "snapshot")).toMatchObject({
          sequence: 1,
          playable: false,
          recoveryRequired: true,
          recoveryReason: "CONCURRENCY_OWNERSHIP_UNCERTAIN",
          clock: { whiteMs: INITIAL_MS - 300, blackMs: INITIAL_MS, running: false },
        });
        expect(await black.next("recovery_required")).toEqual({ ...notice, requestId: "resync" });
        white.send(commandMessage(own, "own-2"));
        expect(await white.next("recovery_required")).toEqual({
          ...notice,
          requestId: "own-2",
          clientCommandId: own.clientCommandId,
        });
        expect(await schema.counts(GAME_ID)).toEqual(durable);
        expect(stack.runtime.facts.count("deadline_flagged")).toBe(0);
        expect(
          stack.runtime.scheduler.pending().filter((wake) => wake.delayMs !== IDLE_MS),
        ).toEqual([]);
        const wire = JSON.stringify([...white.received, ...black.received]);
        expect(wire).not.toMatch(/game_update|command_response/);
        expect(wire).not.toMatch(/sqlstate|postgres|trigger|stack|relation/i);
      } finally {
        await stack.edge.close();
        await other.registry.dispose();
      }
      expectClean(stack);
      expect(other.defects.errors).toEqual([]);
    });
  });

  it("TST-RT-DB-006 a create reported failed is reconciled against PostgreSQL: a landed insert is found and held paused, a lost one leaves nothing, an unreadable database leaves only the reconciliation pause", async () => {
    await withDisposableSchema(APPLICATION, async (schema) => {
      const reader = new PostgresLiveGameRepository(schema.pool());
      const harness = () => runtimeHarness({}, new PostgresLiveGameRepository(schema.pool()));
      const landed = harness();
      const lost = harness();
      const unknown = harness();
      const short = newGame({ initialMs: 1_000 }).clock.timeControl;
      const start = (h: RuntimeHarness, id: GameId) =>
        h.registry.startGame({
          gameId: id,
          players: PLAYERS,
          controlLeases: LEASES,
          timeControl: short,
        });
      try {
        // 1. The row is inserted, but the acknowledgement fails.
        landed.repository.createFault = "apply_then_fail";
        expect(await start(landed, GAME_ID)).toEqual({
          ok: false,
          error: {
            kind: "create_unconfirmed",
            reconciliation: "stored",
            activation: { kind: "recovery_required", reason: "PERSISTENCE_UNAVAILABLE" },
          },
        });
        const durable = await schema.counts(GAME_ID);
        expect(durable).toEqual({
          sequence: 0,
          statusKind: "active",
          clockDomainId: DOMAIN_A,
          bindings: 0,
          outbox: 0,
        });
        expect(landed.registry.size).toBe(1);
        expect(landed.scheduler.pending().filter((wake) => wake.delayMs !== IDLE_MS)).toEqual([]);

        // 2. Nothing is inserted.
        lost.repository.createFault = "fail";
        expect(await start(lost, OTHER_GAME_ID)).toEqual({
          ok: false,
          error: { kind: "create_unconfirmed", reconciliation: "not_stored" },
        });
        expect(await reader.loadGame(OTHER_GAME_ID)).toEqual({
          ok: false,
          error: { kind: "game_not_found" },
        });
        expect(lost.registry.size).toBe(0);
        expect(lost.scheduler.pending()).toEqual([]);
        expect(lost.registry.infrastructurePause(OTHER_GAME_ID)).toBeUndefined();

        // 3. The row is inserted, and the reconciliation read cannot reach the database.
        unknown.repository.createFault = "apply_then_fail";
        unknown.repository.loadFault = true;
        expect(await start(unknown, THIRD_GAME_ID)).toEqual({
          ok: false,
          error: { kind: "create_unconfirmed", reconciliation: "unknown" },
        });
        expect(unknown.registry.size).toBe(0);
        expect(unknown.scheduler.pending()).toEqual([]);
        expect(unknown.registry.infrastructurePause(THIRD_GAME_ID)).toBe(
          "CREATE_RECONCILIATION_REQUIRED",
        );
        expect(await start(unknown, THIRD_GAME_ID)).toEqual({
          ok: false,
          error: { kind: "writer_refused", reason: "game_paused" },
        });
        const pending = await schema.counts(THIRD_GAME_ID);
        unknown.repository.loadFault = false;
        unknown.clock.set(START_MS + 600_000);
        landed.clock.set(START_MS + 600_000);
        await expectPausedUncharged(landed, GAME_ID, "PERSISTENCE_UNAVAILABLE");
        await expectPausedUncharged(unknown, THIRD_GAME_ID, "CREATE_RECONCILIATION_REQUIRED");
        expect(await schema.counts(GAME_ID)).toEqual(durable);
        expect(await schema.counts(THIRD_GAME_ID)).toEqual(pending);
      } finally {
        await Promise.all([landed, lost, unknown].map((h) => h.registry.dispose()));
      }
      for (const h of [landed, lost, unknown]) expect(h.defects.errors).toEqual([]);
    });
  });
});
