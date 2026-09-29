import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { Color } from "@chess-one/game-values";
import {
  type ClockDomainId,
  type CommandExecution,
  encodeGameFinished,
  executeCommand,
  executeDeadline,
  isClockDomainId,
  type LiveGameWriter,
  loadForWriter,
  planCommit,
  processCommand,
  startGame,
} from "@chess-one/live-game";
import {
  createLiveGameDatabase,
  type LiveGameDatabase,
  liveGameMigrator,
  MIGRATION_LOCK_TABLE,
  MIGRATION_TABLE,
  migrateToLatest,
  PostgresLiveGameRepository,
} from "@chess-one/live-game-persistence";
import { type Kysely, sql } from "kysely";
import { NO_MIGRATIONS } from "kysely/migration";
import { describe, expect, it } from "vitest";
import {
  actorFor,
  at,
  duration,
  GAME_ID,
  INITIAL_MS,
  LEASES,
  moveCommand,
  ms,
  newGame,
  offerCommand,
  PLAYERS,
  resignCommand,
  START_MS,
  snapshot,
} from "../live-game/support/harness.ts";
import { viaJson } from "./support/json.ts";

/**
 * PostgreSQL integration tests: the only tests that show transaction,
 * constraint, and concurrency behaviour. They run against a disposable local
 * test database, each in its own schema, dropped afterwards. Without one they
 * FAIL with a BLOCKED message; they never skip.
 */
const BLOCKED =
  "BLOCKED by environment: set CHESS_ONE_TEST_DATABASE_URL to a disposable local PostgreSQL 18 test database " +
  "(host localhost, 127.0.0.1, or ::1; database name ending in _test).";

const MIGRATIONS = fileURLToPath(
  new URL("../../server/live-game-persistence/migrations", import.meta.url),
);

const APPLICATION = "chess-one-integration-test";
const CONTENDER = "chess-one-integration-contender";
const TEST_DATABASE_NAME = /^[a-z0-9_]+_test$/;
const TEST_SCHEMA_NAME = /^chess_one_it_[0-9a-f]{16}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const GAME_TABLES = ["live_game_command_bindings", "live_games", "outbox_events"];

function testDatabaseUrl(): string {
  const { CHESS_ONE_TEST_DATABASE_URL: url } = process.env;
  if (url === undefined || url === "") throw new Error(BLOCKED);
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) {
    throw new Error("Refusing a non-local database host for integration tests");
  }
  if (!TEST_DATABASE_NAME.test(parsed.pathname.slice(1))) {
    throw new Error("Refusing a database whose name does not end in _test");
  }
  return url;
}

function domain(name: string): ClockDomainId {
  if (!isClockDomainId(name)) throw new Error(`invalid clock domain ${name}`);
  return name;
}

const BOOT_A = domain("it-boot-a");
const BOOT_B = domain("it-boot-b");

interface Harness {
  readonly url: string;
  readonly schema: string;
  readonly admin: Kysely<LiveGameDatabase>;
  db: Kysely<LiveGameDatabase>;
}

function connect(
  url: string,
  schema: string | null,
  applicationName = APPLICATION,
): Kysely<LiveGameDatabase> {
  return createLiveGameDatabase({
    connectionString: url,
    maxConnections: 4,
    applicationName,
    schema,
  });
}

/**
 * Hard guard before every destructive setup or cleanup statement: the server
 * must report that the connected database is named `*_test`, whatever the URL
 * said, and the schema must be one this suite generated. Otherwise it fails
 * closed. The suite never drops a database.
 */
async function assertDisposable(admin: Kysely<LiveGameDatabase>, schema: string): Promise<void> {
  const connected = await sql<{ name: string }>`select current_database() as name`.execute(admin);
  if (!TEST_DATABASE_NAME.test(connected.rows[0]?.name ?? "")) {
    throw new Error("Refusing destructive setup or cleanup outside a database named *_test");
  }
  if (!TEST_SCHEMA_NAME.test(schema)) {
    throw new Error("Refusing destructive setup or cleanup of a schema this suite did not create");
  }
}

async function withSchema(
  run: (harness: Harness) => Promise<void>,
  options: { readonly migrate: boolean } = { migrate: true },
): Promise<void> {
  const url = testDatabaseUrl();
  const schema = `chess_one_it_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const admin = connect(url, null);
  try {
    await assertDisposable(admin, schema);
    await sql`create schema ${sql.id(schema)}`.execute(admin);
    const harness: Harness = { url, schema, admin, db: connect(url, schema) };
    try {
      if (options.migrate) {
        const migrated = await migrateToLatest(harness.db, MIGRATIONS);
        if (migrated.error !== undefined) throw new Error("migrations failed");
      }
      await run(harness);
    } finally {
      await harness.db.destroy();
      await assertDisposable(admin, schema);
      await sql`drop schema ${sql.id(schema)} cascade`.execute(admin);
    }
  } finally {
    await admin.destroy();
  }
}

/** A new pool and repository, as after a process restart, in clock domain `clockDomainId`. */
async function restart(harness: Harness, clockDomainId: ClockDomainId): Promise<LiveGameWriter> {
  await harness.db.destroy();
  harness.db = connect(harness.url, harness.schema);
  return { repository: new PostgresLiveGameRepository(harness.db), clockDomainId };
}

async function startedWriter(harness: Harness, initialMs = INITIAL_MS): Promise<LiveGameWriter> {
  const writer = { repository: new PostgresLiveGameRepository(harness.db), clockDomainId: BOOT_A };
  const created = await startGame(writer, {
    gameId: GAME_ID,
    players: PLAYERS,
    controlLeases: LEASES,
    timeControl: { kind: "sudden_death", initialMs: duration(initialMs) },
    startedAtMonotonicMs: ms(START_MS),
  });
  if (!created.ok) throw new Error(`game not started: ${JSON.stringify(created.error)}`);
  return writer;
}

/** Every stored row of the game, read through a new connection pool. */
async function storedRows(harness: Harness) {
  const fresh = connect(harness.url, harness.schema);
  try {
    const game = await fresh
      .selectFrom("live_games")
      .select([
        "sequence",
        "status_kind",
        "clock_domain_id",
        "state",
        sql<string>`updated_at::text`.as("updated_at"),
      ])
      .where("game_id", "=", GAME_ID)
      .executeTakeFirst();
    const bindings = await fresh
      .selectFrom("live_game_command_bindings")
      .select(["seat", "client_command_id", "binding_ordinal", "bound_at_sequence", "response"])
      .where("game_id", "=", GAME_ID)
      .orderBy("binding_ordinal")
      .execute();
    const outbox = await fresh
      .selectFrom("outbox_events")
      .select(["event_id", "event_type", "aggregate_sequence", "payload"])
      .where("aggregate_id", "=", GAME_ID)
      .orderBy("aggregate_sequence")
      .execute();
    return { game: game ?? null, bindings, outbox };
  } finally {
    await fresh.destroy();
  }
}

async function waitForLockWaiters(observer: Kysely<LiveGameDatabase>, expected: number) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const waiting = await sql<{ n: string }>`
      select count(*) as n from pg_stat_activity
      where application_name = ${CONTENDER} and wait_event_type = 'Lock'`.execute(observer);
    if (Number(waiting.rows[0]?.n) >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`expected ${expected} transactions waiting on a lock`);
}

/**
 * Runs `contenders` as genuinely concurrent transactions. Another connection
 * holds an EXCLUSIVE lock on `live_games` until PostgreSQL reports every
 * contender waiting on it, so all of them are in flight when it is released.
 */
async function race<T>(harness: Harness, contenders: readonly (() => Promise<T>)[]): Promise<T[]> {
  const holderDb = connect(harness.url, harness.schema);
  const lockHeld = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  try {
    const holder = holderDb.transaction().execute(async (trx) => {
      await sql`lock table live_games in exclusive mode`.execute(trx);
      lockHeld.resolve();
      await release.promise;
    });
    await Promise.race([lockHeld.promise, holder]);
    const running = contenders.map((contender) => contender());
    await waitForLockWaiters(harness.admin, contenders.length);
    release.resolve();
    await holder;
    return await Promise.all(running);
  } finally {
    release.resolve();
    await holderDb.destroy();
  }
}

/** Two independent connection pools, as two writer processes would hold. */
async function withContenders(
  harness: Harness,
  run: (repositories: readonly PostgresLiveGameRepository[]) => Promise<void>,
): Promise<void> {
  const pools = [
    connect(harness.url, harness.schema, CONTENDER),
    connect(harness.url, harness.schema, CONTENDER),
  ];
  try {
    await run(pools.map((pool) => new PostgresLiveGameRepository(pool)));
  } finally {
    await Promise.all(pools.map((pool) => pool.destroy()));
  }
}

/** Plays 1. f3 e5 2. g4 through `writer`; returns the state and the mating command. */
async function beforeMate(writer: LiveGameWriter) {
  let state = newGame();
  let time = START_MS;
  for (const uci of ["f2f3", "e7e5", "g2g4"]) {
    time += 10;
    const executed = await executeCommand(
      writer,
      actorFor(state, state.position.sideToMove),
      moveCommand(state, uci),
      at(time),
    );
    if (!executed.ok) throw new Error(`${uci} not stored: ${executed.error.kind}`);
    state = executed.value.decision.nextState;
  }
  return { state, time: time + 10, mate: moveCommand(state, "d8h4") };
}

const EXPECTED_CONSTRAINTS = [
  "live_game_command_bindings.live_game_command_bindings_command_id_format:c",
  "live_game_command_bindings.live_game_command_bindings_fingerprint_present:c",
  "live_game_command_bindings.live_game_command_bindings_game_fkey:f",
  "live_game_command_bindings.live_game_command_bindings_ordinal_key:u",
  "live_game_command_bindings.live_game_command_bindings_ordinal_nonnegative:c",
  "live_game_command_bindings.live_game_command_bindings_pkey:p",
  "live_game_command_bindings.live_game_command_bindings_record_format:c",
  "live_game_command_bindings.live_game_command_bindings_response_object:c",
  "live_game_command_bindings.live_game_command_bindings_seat:c",
  "live_game_command_bindings.live_game_command_bindings_sequence_nonnegative:c",
  "live_games.live_games_clock_domain_format:c",
  "live_games.live_games_distinct_players:c",
  "live_games.live_games_game_id_format:c",
  "live_games.live_games_offer_only_when_active:c",
  "live_games.live_games_pkey:p",
  "live_games.live_games_pre_game_shape:c",
  "live_games.live_games_sequence_nonnegative:c",
  "live_games.live_games_state_format:c",
  "live_games.live_games_state_matches_columns:c",
  "live_games.live_games_state_object:c",
  "live_games.live_games_status_kind:c",
  "outbox_events.outbox_events_aggregate_type:c",
  "outbox_events.outbox_events_event_type:c",
  "outbox_events.outbox_events_event_version_positive:c",
  "outbox_events.outbox_events_live_game_fkey:f",
  "outbox_events.outbox_events_once_per_aggregate_sequence:u",
  "outbox_events.outbox_events_payload_object:c",
  "outbox_events.outbox_events_pkey:p",
  "outbox_events.outbox_events_publication_status:c",
  "outbox_events.outbox_events_published_at_matches_status:c",
  "outbox_events.outbox_events_sequence_nonnegative:c",
];

const EXPECTED_INDEXES = [
  "live_game_command_bindings.live_game_command_bindings_ordinal_key",
  "live_game_command_bindings.live_game_command_bindings_pkey",
  "live_games.live_games_awaiting_deadline_idx",
  "live_games.live_games_pkey",
  "outbox_events.outbox_events_once_per_aggregate_sequence",
  "outbox_events.outbox_events_pending_idx",
  "outbox_events.outbox_events_pkey",
];

const MIGRATION_NAMES = [
  "001_live_games",
  "002_live_game_command_bindings",
  "003_outbox_events",
  "004_live_game_lifecycle",
];

function bindingRow(clientCommandId: string, ordinal: number) {
  return {
    game_id: GAME_ID,
    seat: "white",
    client_command_id: clientCommandId,
    binding_ordinal: ordinal,
    record_format: "live_game_state.v1",
    fingerprint: "fingerprint",
    bound_at_sequence: 0,
    response: "{}",
  };
}

function outboxRow(aggregateSequence: number) {
  return {
    event_type: "game.finished",
    event_version: 1,
    aggregate_type: "live_game",
    aggregate_id: GAME_ID,
    aggregate_sequence: aggregateSequence,
    payload: "{}",
  };
}

describe("TST-PERSIST-DB PostgreSQL integration (needs a local test database)", () => {
  it("TST-PERSIST-DB-001 migrations: empty schema to latest on PostgreSQL 18 with every constraint and index, revert, re-apply, bookkeeping, usable schema", async () => {
    await withSchema(
      async (harness) => {
        const version = await sql<{
          server_version_num: string;
        }>`show server_version_num`.execute(harness.db);
        const number = Number(version.rows[0]?.server_version_num);
        expect(number).toBeGreaterThanOrEqual(180_000);
        expect(number).toBeLessThan(190_000);
        const tables = async () =>
          (
            await sql<{ table_name: string }>`
              select table_name from information_schema.tables
              where table_schema = ${harness.schema} order by table_name`.execute(harness.db)
          ).rows.map((row) => row.table_name);
        const constraints = async () =>
          (
            await sql<{ table_name: string; name: string; type: string }>`
              select c.relname as table_name, con.conname as name, con.contype::text as type
              from pg_constraint con
              join pg_class c on c.oid = con.conrelid
              join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = ${harness.schema} and con.contype in ('p', 'u', 'f', 'c')
                and c.relname in ('live_games', 'live_game_command_bindings', 'outbox_events')`.execute(
              harness.db,
            )
          ).rows
            .map((row) => `${row.table_name}.${row.name}:${row.type}`)
            .sort();
        const indexes = async () =>
          (
            await sql<{ tablename: string; indexname: string; indexdef: string }>`
              select tablename, indexname, indexdef from pg_indexes
              where schemaname = ${harness.schema}
                and tablename in ('live_games', 'live_game_command_bindings', 'outbox_events')`.execute(
              harness.db,
            )
          ).rows;
        const applied = async () =>
          (
            await sql<{
              name: string;
            }>`select name from ${sql.id(MIGRATION_TABLE)} order by name`.execute(harness.db)
          ).rows.map((row) => row.name);

        expect(await tables()).toEqual([]);
        const up = await migrateToLatest(harness.db, MIGRATIONS);
        expect(up.error).toBeUndefined();
        expect(up.results?.map((result) => `${result.migrationName}:${result.status}`)).toEqual(
          MIGRATION_NAMES.map((name) => `${name}:Success`),
        );
        expect(await tables()).toEqual(
          [...GAME_TABLES, MIGRATION_LOCK_TABLE, MIGRATION_TABLE].sort(),
        );
        expect(await constraints()).toEqual(EXPECTED_CONSTRAINTS);
        const created = await indexes();
        expect(created.map((row) => `${row.tablename}.${row.indexname}`).sort()).toEqual(
          EXPECTED_INDEXES,
        );
        expect(
          created.find((row) => row.indexname === "outbox_events_pending_idx")?.indexdef,
        ).toMatch(/\(created_at, event_id\) WHERE \(publication_status = 'pending'::text\)$/);
        const eventIdDefault = await sql<{ column_default: string }>`
          select column_default from information_schema.columns
          where table_schema = ${harness.schema} and table_name = 'outbox_events'
            and column_name = 'event_id'`.execute(harness.db);
        expect(eventIdDefault.rows[0]?.column_default).toBe("gen_random_uuid()");
        expect(await applied()).toEqual(MIGRATION_NAMES);

        const down = await liveGameMigrator(harness.db, MIGRATIONS).migrateTo(NO_MIGRATIONS);
        expect(down.error).toBeUndefined();
        expect(
          down.results?.map((result) => `${result.migrationName}:${result.direction}`),
        ).toEqual([...MIGRATION_NAMES].reverse().map((name) => `${name}:Down`));
        expect(await tables()).toEqual([MIGRATION_LOCK_TABLE, MIGRATION_TABLE].sort());
        expect(await constraints()).toEqual([]);
        expect(await applied()).toEqual([]);

        const again = await migrateToLatest(harness.db, MIGRATIONS);
        expect(again.error).toBeUndefined();
        expect(again.results?.map((result) => result.status)).toEqual(
          MIGRATION_NAMES.map(() => "Success"),
        );
        expect(await constraints()).toEqual(EXPECTED_CONSTRAINTS);
        expect(await applied()).toEqual(MIGRATION_NAMES);
        const idle = await migrateToLatest(harness.db, MIGRATIONS);
        expect(idle.error).toBeUndefined();
        expect(idle.results).toEqual([]);

        const writer = await startedWriter(harness);
        const loaded = await writer.repository.loadGame(GAME_ID);
        expect(loaded.ok && snapshot(loaded.value.state)).toEqual(snapshot(newGame()));
      },
      { migrate: false },
    );
  });

  it("TST-PERSIST-DB-002 a stored game loads back unchanged, and constraints refuse impossible rows", async () => {
    await withSchema(async (harness) => {
      const writer = await startedWriter(harness);
      const loaded = await writer.repository.loadGame(GAME_ID);
      expect(loaded.ok && snapshot(loaded.value.state)).toEqual(snapshot(newGame()));
      const refused = async (write: Promise<unknown>, code: string, constraint: string) =>
        expect(write).rejects.toMatchObject({ code, constraint });
      await refused(
        harness.db
          .updateTable("live_games")
          .set({ state_format: "live_game_state.v0" })
          .where("game_id", "=", GAME_ID)
          .execute(),
        "23514",
        "live_games_state_format",
      );
      await refused(
        harness.db
          .updateTable("live_games")
          .set({ sequence: 5 })
          .where("game_id", "=", GAME_ID)
          .execute(),
        "23514",
        "live_games_state_matches_columns",
      );
      await refused(
        harness.db
          .insertInto("live_game_command_bindings")
          .values({ ...bindingRow("white-orphan", 0), game_id: "game-missing" })
          .execute(),
        "23503",
        "live_game_command_bindings_game_fkey",
      );
      await harness.db.insertInto("outbox_events").values(outboxRow(1)).execute();
      await refused(
        harness.db
          .updateTable("outbox_events")
          .set({ published_at: "2026-01-01T00:00:00Z" })
          .where("aggregate_id", "=", GAME_ID)
          .execute(),
        "23514",
        "outbox_events_published_at_matches_status",
      );
      const second = await writer.repository.createGame(newGame(), BOOT_A);
      expect(second).toEqual({ ok: false, error: { kind: "game_already_exists" } });
    });
  });

  it("TST-PERSIST-DB-003 restart replay: after a new connection pool, the stored response replays with the same sequence, no second binding, and no outbox row", async () => {
    await withSchema(async (harness) => {
      const writer = await startedWriter(harness);
      const game = newGame();
      const command = moveCommand(game, "e2e4");
      const original = await executeCommand(
        writer,
        actorFor(game, "white"),
        command,
        at(START_MS + 10),
      );
      if (!original.ok) throw new Error("move not stored");
      const stored = await storedRows(harness);
      expect(stored.game?.sequence).toBe("1");
      expect(stored.bindings).toHaveLength(1);
      expect(stored.outbox).toEqual([]);

      for (const clockDomainId of [BOOT_B, BOOT_A]) {
        const after = await restart(harness, clockDomainId);
        const replay = await executeCommand(after, actorFor(game, "white"), command, at(7));
        expect(replay.ok && viaJson(replay.value.decision.response), clockDomainId).toEqual(
          viaJson({ ...original.value.decision.response, replayedResponse: true }),
        );
        expect(replay.ok && replay.value.eventIds, clockDomainId).toEqual([]);
        expect(await storedRows(harness), clockDomainId).toEqual(stored);
      }
    });
  });

  it("TST-PERSIST-DB-004 checkmate restart: exactly one game.finished outbox row with its durable event id, never duplicated by replay or a retried commit", async () => {
    await withSchema(async (harness) => {
      const writer = await startedWriter(harness);
      const { state, time, mate } = await beforeMate(writer);
      const preMate = await writer.repository.loadGame(GAME_ID);
      if (!preMate.ok) throw new Error("not loaded");
      const retriedDecision = processCommand(
        preMate.value.state,
        actorFor(state, "black"),
        mate,
        at(time),
      );
      const retried = planCommit(
        preMate.value.state,
        retriedDecision.nextState,
        retriedDecision.events,
      );
      if (retried?.kind !== "transition") throw new Error("the finishing decision is a transition");
      expect(retried.events).toHaveLength(1);
      const finished = await executeCommand(writer, actorFor(state, "black"), mate, at(time));
      if (!finished.ok) throw new Error("mate not stored");
      const [event] = finished.value.decision.events;
      if (event === undefined) throw new Error("finishing event");
      const [eventId] = finished.value.eventIds;
      expect(finished.value.eventIds).toHaveLength(1);
      expect(eventId).toMatch(UUID_V4);
      const rows = await harness.db.selectFrom("outbox_events").selectAll().execute();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        event_id: eventId,
        event_type: "game.finished",
        event_version: 1,
        aggregate_type: "live_game",
        aggregate_id: GAME_ID,
        aggregate_sequence: String(event.gameSequence),
        publication_status: "pending",
        published_at: null,
      });
      expect(rows[0]?.payload).toEqual(viaJson(encodeGameFinished(event)));
      const stored = await storedRows(harness);

      expect(await writer.repository.commitDecision(retried, BOOT_A)).toEqual({
        ok: false,
        error: { kind: "concurrency_conflict", expectedSequence: state.sequence },
      });

      const finalState = finished.value.decision.nextState;
      for (const clockDomainId of [BOOT_B, BOOT_A]) {
        const after = await restart(harness, clockDomainId);
        const replay = await executeCommand(after, actorFor(state, "black"), mate, at(3));
        expect(replay.ok && viaJson(replay.value.decision.response), clockDomainId).toEqual(
          viaJson({ ...finished.value.decision.response, replayedResponse: true }),
        );
        expect(replay.ok && replay.value.eventIds, clockDomainId).toEqual([]);
        const late = await executeCommand(
          after,
          actorFor(finalState, "white"),
          moveCommand(finalState, "a2a3"),
          at(4),
        );
        expect(late.ok && late.value.decision.response.code).toBe("GameAlreadyFinished");
        const deadline = await executeDeadline(after, GAME_ID, ms(10_000_000));
        expect(deadline.ok && deadline.value.decision.flagged).toBe(false);
      }
      expect(await storedRows(harness)).toEqual(stored);
      expect(stored.outbox.map((row) => row.event_id)).toEqual([eventId]);
    });
  });

  it("TST-PERSIST-DB-005 a failure at the state update, binding insert, or outbox insert rolls back everything, as a new connection reads it", async () => {
    await withSchema(async (harness) => {
      const writer = await startedWriter(harness);
      const { state, time, mate } = await beforeMate(writer);
      const before = await storedRows(harness);
      await sql
        .raw(
          "create function chess_one_it_fail() returns trigger language plpgsql as " +
            "$$ begin raise exception 'injected failure' using errcode = 'P0001'; end $$",
        )
        .execute(harness.db);
      for (const [table, event] of [
        ["live_games", "update"],
        ["live_game_command_bindings", "insert"],
        ["outbox_events", "insert"],
      ] as const) {
        await sql
          .raw(
            `create trigger chess_one_it_fail before ${event} on ${table} for each row execute function chess_one_it_fail()`,
          )
          .execute(harness.db);
        const failed = await executeCommand(writer, actorFor(state, "black"), mate, at(time));
        expect(failed, table).toEqual({
          ok: false,
          error: { kind: "persistence_failure", operation: "commit", code: "P0001" },
        });
        expect(await storedRows(harness), table).toEqual(before);
        await sql.raw(`drop trigger chess_one_it_fail on ${table}`).execute(harness.db);
      }
      const committed = await executeCommand(writer, actorFor(state, "black"), mate, at(time));
      expect(committed.ok && committed.value.decision.response).toMatchObject({
        code: "Accepted",
        replayedResponse: false,
      });
      const after = await storedRows(harness);
      expect(after.game?.sequence).toBe(String(state.sequence + 1));
      expect(after.bindings).toHaveLength(before.bindings.length + 1);
      expect(after.outbox).toHaveLength(1);
    });
  });

  it("TST-PERSIST-DB-006 optimistic concurrency: two connections load the same sequence and commit concurrently; exactly one wins, no update is lost", async () => {
    await withSchema(async (harness) => {
      await startedWriter(harness);
      await withContenders(harness, async (repositories) => {
        const contenders = await Promise.all(
          repositories.map(async (repository, index) => {
            const loaded = await repository.loadGame(GAME_ID);
            if (!loaded.ok) throw new Error("not loaded");
            const game = loaded.value.state;
            expect(game.sequence).toBe(0);
            const move = moveCommand(game, index === 0 ? "e2e4" : "d2d4");
            const decision = processCommand(game, actorFor(game, "white"), move, at(START_MS + 10));
            const plan = planCommit(game, decision.nextState, decision.events);
            if (plan === null) throw new Error("the move writes");
            return { repository, plan, nextState: decision.nextState };
          }),
        );
        const results = await race(
          harness,
          contenders.map(
            ({ repository, plan }) =>
              () =>
                repository.commitDecision(plan, BOOT_A),
          ),
        );
        expect(results.filter((result) => result.ok)).toHaveLength(1);
        expect(results.filter((result) => !result.ok)).toEqual([
          { ok: false, error: { kind: "concurrency_conflict", expectedSequence: 0 } },
        ]);
        const winner = results[0]?.ok ? contenders[0] : contenders[1];
        if (winner === undefined) throw new Error("two contenders");
        const reader = await restart(harness, BOOT_A);
        const loaded = await reader.repository.loadGame(GAME_ID);
        expect(loaded.ok && snapshot(loaded.value.state)).toEqual(snapshot(winner.nextState));
        const rows = await storedRows(harness);
        expect(rows.game?.sequence).toBe("1");
        expect(rows.bindings.map((row) => row.client_command_id)).toEqual([
          winner.plan.kind === "control" ? null : winner.plan.binding?.clientCommandId,
        ]);
      });
    });
  });

  it("TST-PERSIST-DB-007 the outbox refuses a second event for the same aggregate sequence and type; gen_random_uuid gives unique non-null ids", async () => {
    await withSchema(async (harness) => {
      await startedWriter(harness);
      await harness.db.insertInto("outbox_events").values(outboxRow(1)).execute();
      await expect(
        harness.db.insertInto("outbox_events").values(outboxRow(1)).execute(),
      ).rejects.toMatchObject({
        code: "23505",
        constraint: "outbox_events_once_per_aggregate_sequence",
      });
      await sql`
        insert into outbox_events
          (event_type, event_version, aggregate_type, aggregate_id, aggregate_sequence, payload)
        select 'game.finished', 1, 'live_game', ${GAME_ID}, s, '{}'::jsonb
        from generate_series(2, 1000) as s`.execute(harness.db);
      const ids = await sql<{ total: string; present: string; distinct_ids: string }>`
        select count(*) as total, count(event_id) as present, count(distinct event_id) as distinct_ids
        from outbox_events`.execute(harness.db);
      expect(ids.rows[0]).toEqual({ total: "1000", present: "1000", distinct_ids: "1000" });
      const rows = (await storedRows(harness)).outbox;
      expect(rows.every((row) => UUID_V4.test(row.event_id))).toBe(true);
    });
  });

  it("TST-PERSIST-DB-008 a corrupted stored state fails closed on load", async () => {
    await withSchema(async (harness) => {
      const writer = await startedWriter(harness);
      await sql`
        update live_games
        set state = jsonb_set(state, '{clock,remainingMs,white}', '-1'::jsonb)
        where game_id = ${GAME_ID}`.execute(harness.db);
      expect(await writer.repository.loadGame(GAME_ID)).toMatchObject({
        ok: false,
        error: { kind: "corrupt_state", path: "state.clock.remainingMs.white" },
      });
    });
  });

  it("TST-PERSIST-DB-009 per-game reads and the pending-outbox scan use indexes", async () => {
    await withSchema(async (harness) => {
      await startedWriter(harness);
      const plan = async (query: string) => {
        const explained = await harness.db.transaction().execute(async (trx) => {
          await sql`set local enable_seqscan = off`.execute(trx);
          return sql.raw<{ "QUERY PLAN": string }>(`explain ${query}`).execute(trx);
        });
        return explained.rows.map((row) => row["QUERY PLAN"]).join("\n");
      };
      expect(await plan(`select * from live_games where game_id = 'game-1'`)).toContain(
        "live_games_pkey",
      );
      expect(
        await plan(
          `select * from live_game_command_bindings where game_id = 'game-1' order by binding_ordinal`,
        ),
      ).toMatch(/live_game_command_bindings_(ordinal_key|pkey)/);
      expect(
        await plan(
          `select * from outbox_events where publication_status = 'pending' order by created_at, event_id limit 10`,
        ),
      ).toContain("outbox_events_pending_idx");
    });
  });

  it("TST-PERSIST-DB-010 binding uniqueness: concurrent bind-only commits of one command, or of two commands at one ordinal, store exactly one binding", async () => {
    await withSchema(async (harness) => {
      await startedWriter(harness);
      const scenarios = [
        { name: "same command", ids: ["white-bad", "white-bad"], ordinal: 0 },
        { name: "same ordinal", ids: ["white-bad-1", "white-bad-2"], ordinal: 1 },
      ];
      for (const scenario of scenarios) {
        await withContenders(harness, async (repositories) => {
          const plans = await Promise.all(
            repositories.map(async (repository, index) => {
              const loaded = await repository.loadGame(GAME_ID);
              if (!loaded.ok) throw new Error("not loaded");
              const game = loaded.value.state;
              const bad = moveCommand(game, "e2e4", {
                promotionPiece: "q",
                clientCommandId: scenario.ids[index] ?? "",
              });
              const decision = processCommand(
                game,
                actorFor(game, "white"),
                bad,
                at(START_MS + 10),
              );
              expect(decision.response.code).toBe("InvalidState");
              const plan = planCommit(game, decision.nextState, decision.events);
              if (plan?.kind !== "bind_only") throw new Error("a bound rejection binds only");
              return { repository, plan };
            }),
          );
          const results = await race(
            harness,
            plans.map(
              ({ repository, plan }) =>
                () =>
                  repository.commitDecision(plan, BOOT_A),
            ),
          );
          expect(
            results.filter((result) => result.ok),
            scenario.name,
          ).toHaveLength(1);
          expect(
            results.filter((result) => !result.ok),
            scenario.name,
          ).toEqual([{ ok: false, error: { kind: "concurrency_conflict", expectedSequence: 0 } }]);
        });
        const rows = await storedRows(harness);
        expect(rows.game?.sequence, scenario.name).toBe("0");
        expect(rows.bindings, scenario.name).toHaveLength(scenario.ordinal + 1);
        expect(scenario.ids, scenario.name).toContain(
          rows.bindings[scenario.ordinal]?.client_command_id,
        );
        expect(rows.bindings[scenario.ordinal]?.binding_ordinal, scenario.name).toBe(
          scenario.ordinal,
        );
      }
      await expect(
        harness.db
          .insertInto("live_game_command_bindings")
          .values(bindingRow("white-bad", 9))
          .execute(),
      ).rejects.toMatchObject({ code: "23505", constraint: "live_game_command_bindings_pkey" });
      await expect(
        harness.db
          .insertInto("live_game_command_bindings")
          .values(bindingRow("white-fresh", 1))
          .execute(),
      ).rejects.toMatchObject({
        code: "23505",
        constraint: "live_game_command_bindings_ordinal_key",
      });
    });
  });

  it("TST-PERSIST-DB-011 a running game stored under one clock domain is recovery-paused under another: no balance charged, no timeout, no result, no write; stored replay stays safe", async () => {
    await withSchema(async (harness) => {
      const writer = await startedWriter(harness);
      let state = newGame();
      const commands: {
        readonly command: ReturnType<typeof moveCommand>;
        readonly seat: Color;
        readonly executed: CommandExecution;
      }[] = [];
      for (const [uci, time] of [
        ["e2e4", START_MS + 10],
        ["e7e5", START_MS + 25],
      ] as const) {
        const command = moveCommand(state, uci);
        const executed = await executeCommand(
          writer,
          actorFor(state, state.position.sideToMove),
          command,
          at(time),
        );
        if (!executed.ok) throw new Error(`${uci} not stored`);
        commands.push({ command, seat: state.position.sideToMove, executed: executed.value });
        state = executed.value.decision.nextState;
      }
      const committed = await storedRows(harness);
      expect(committed.game?.clock_domain_id).toBe(BOOT_A);

      const after = await restart(harness, BOOT_B);
      const paused = {
        kind: "recovery_paused",
        reason: "RECOVERY_PAUSED_CLOCK_DOMAIN_CHANGED",
        remainingMs: { white: INITIAL_MS - 10, black: INITIAL_MS - 15 },
        activeSide: "white",
        storedClockDomainId: BOOT_A,
      };
      const loaded = await loadForWriter(after, GAME_ID);
      expect(loaded.ok && loaded.value.condition).toEqual(paused);
      expect(loaded.ok && loaded.value.state.status).toEqual({ kind: "active" });
      expect(loaded.ok && snapshot(loaded.value.state)).toEqual(snapshot(state));

      const refused = { ok: false, error: paused };
      for (const receivedAt of [1, START_MS + 26, 10_000_000_000]) {
        const move = moveCommand(state, "g1f3");
        expect(await executeCommand(after, actorFor(state, "white"), move, at(receivedAt))).toEqual(
          refused,
        );
      }
      expect(
        await executeCommand(after, actorFor(state, "black"), resignCommand(state, "black"), at(2)),
      ).toEqual(refused);
      expect(
        await executeCommand(after, actorFor(state, "white"), offerCommand(state, "white"), at(3)),
      ).toEqual(refused);
      expect(await executeDeadline(after, GAME_ID, ms(10_000_000_000))).toEqual(refused);
      for (const { command, seat, executed } of commands) {
        const replay = await executeCommand(after, actorFor(state, seat), command, at(4));
        expect(replay.ok && viaJson(replay.value.decision.response)).toEqual(
          viaJson({ ...executed.decision.response, replayedResponse: true }),
        );
      }
      expect(await storedRows(harness)).toEqual(committed);

      const sameDomain = await restart(harness, BOOT_A);
      const resumedLoad = await loadForWriter(sameDomain, GAME_ID);
      expect(resumedLoad.ok && resumedLoad.value.condition).toEqual({ kind: "running" });
      const continued = await executeCommand(
        sameDomain,
        actorFor(state, "white"),
        moveCommand(state, "g1f3"),
        at(START_MS + 40),
      );
      expect(continued.ok && continued.value.decision.response.code).toBe("Accepted");
      expect(continued.ok && continued.value.decision.nextState.clock.remainingMs).toEqual({
        white: INITIAL_MS - 25,
        black: INITIAL_MS - 15,
      });
    });
  });

  it("TST-PERSIST-DB-012 finished and rules-unresolved games load normally under another clock domain and are never recovery-paused", async () => {
    await withSchema(async (harness) => {
      const writer = await startedWriter(harness);
      const { state, time, mate } = await beforeMate(writer);
      const finished = await executeCommand(writer, actorFor(state, "black"), mate, at(time));
      if (!finished.ok) throw new Error("mate not stored");
      const stored = await storedRows(harness);
      const after = await restart(harness, BOOT_B);
      const loaded = await loadForWriter(after, GAME_ID);
      expect(loaded.ok && loaded.value.condition).toEqual({ kind: "finished" });
      expect(loaded.ok && loaded.value.state.status).toMatchObject({
        kind: "finished",
        result: { resultCode: "black_win", terminationReason: "checkmate" },
      });
      const finalState = finished.value.decision.nextState;
      const late = await executeCommand(
        after,
        actorFor(finalState, "white"),
        resignCommand(finalState, "white"),
        at(5),
      );
      expect(late.ok && late.value.decision.response.code).toBe("GameAlreadyFinished");
      expect(await storedRows(harness)).toEqual(stored);
    });

    await withSchema(async (harness) => {
      const writer = await startedWriter(harness, 1_000);
      const flagged = await executeDeadline(writer, GAME_ID, ms(START_MS + 1_001));
      expect(flagged.ok && flagged.value.decision.nextState.status).toMatchObject({
        kind: "unresolved",
        reason: "MATING_POSSIBILITY_UNRESOLVED",
      });
      const stored = await storedRows(harness);
      expect(stored.outbox).toEqual([]);
      const after = await restart(harness, BOOT_B);
      const loaded = await loadForWriter(after, GAME_ID);
      if (!loaded.ok) throw new Error("not loaded");
      expect(loaded.value.condition).toEqual({ kind: "rules_unresolved" });
      const unresolved = loaded.value.state;
      const late = await executeCommand(
        after,
        actorFor(unresolved, "black"),
        resignCommand(unresolved, "black"),
        at(5),
      );
      expect(late.ok && late.value.decision.response.code).toBe("MatingPossibilityUnresolved");
      const deadline = await executeDeadline(after, GAME_ID, ms(10_000_000));
      expect(deadline.ok && deadline.value.decision.flagged).toBe(false);
      expect(await storedRows(harness)).toEqual(stored);
    });
  });
});
