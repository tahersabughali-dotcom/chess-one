import { PostgresAccountsRepository } from "@chess-one/accounts-persistence";
import { GameAccessStoreError, newControlLease } from "@chess-one/game-access";
import {
  GAME_ACCESS_MIGRATION_TABLE,
  type GameAccessDatabase,
  gameAccessMigrator,
  PostgresGameAccessStore,
} from "@chess-one/game-access-persistence";
import { type GameId, isGameId, type PlayerId, type Seat } from "@chess-one/live-game-runtime";
import { type Kysely, type RawBuilder, sql } from "kysely";
import { describe, expect, it } from "vitest";
import { accountsHarness, registered, signedIn } from "../accounts/support/harness.ts";
import {
  GAME_ACCESS_MIGRATIONS,
  type GameAccessSchema,
  withGameAccessSchema,
} from "./support/db.ts";
import { gameAccessHarness, playerOf, sessionOf, TIME_CONTROL } from "./support/harness.ts";

const APP = "chess-one-game-access-db-test";

function gameId(value: string): GameId {
  if (!isGameId(value)) throw new Error(`bad game id ${value}`);
  return value;
}

const G1 = gameId("assigned-1");
const G2 = gameId("assigned-2");

/** The SQLSTATE a statement failed with, or "none" when it succeeded. */
async function sqlstateOf(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
    return "none";
  } catch (error: unknown) {
    if (error instanceof GameAccessStoreError) return error.detail;
    return typeof error === "object" && error !== null && "code" in error ? error.code : "unknown";
  }
}

async function storeErrorOf(work: Promise<unknown>): Promise<GameAccessStoreError | null> {
  try {
    await work;
    return null;
  } catch (error: unknown) {
    if (error instanceof GameAccessStoreError) return error;
    throw error;
  }
}

async function tables(db: Kysely<GameAccessDatabase>, schema: string): Promise<string[]> {
  const { rows } = await sql<{ name: string }>`
    select table_name as name from information_schema.tables
    where table_schema = ${schema} and table_name like 'game_%' order by table_name`.execute(db);
  return rows.map((row) => row.name);
}

interface Seeded {
  readonly alice: PlayerId;
  readonly bob: PlayerId;
  readonly carol: PlayerId;
  readonly store: PostgresGameAccessStore;
  readonly db: Kysely<GameAccessDatabase>;
}

async function seeded(schema: GameAccessSchema): Promise<Seeded> {
  const h = accountsHarness({ repository: new PostgresAccountsRepository(schema.base.accounts()) });
  const alice = playerOf(await registered(h, "Alice"));
  const bob = playerOf(await registered(h, "Bob"));
  const carol = playerOf(await registered(h, "Carol"));
  const db = schema.gameAccess();
  return { alice, bob, carol, db, store: new PostgresGameAccessStore(db) };
}

function newAssignment(id: GameId, white: PlayerId, black: PlayerId) {
  return {
    gameId: id,
    players: { white, black },
    leases: { white: newControlLease(), black: newControlLease() },
  };
}

describe("TST-GACC-DB game-access tables on PostgreSQL", () => {
  it("TST-GACC-DB-001 migrations go up, down, and up again, with their own bookkeeping table", async () => {
    await withGameAccessSchema(APP, { migrateGameAccess: false }, async (schema) => {
      const db = schema.gameAccess(1);
      const migrator = gameAccessMigrator(db, GAME_ACCESS_MIGRATIONS, schema.name);
      const up = await migrator.migrateToLatest();
      expect(up.error).toBeUndefined();
      expect(up.results?.map((result) => [result.migrationName, result.status])).toEqual([
        ["001_game_assignments", "Success"],
        ["002_game_seat_control", "Success"],
      ]);
      expect(await tables(db, schema.name)).toEqual([
        "game_access_schema_migration_lock",
        GAME_ACCESS_MIGRATION_TABLE,
        "game_assignments",
        "game_seat_control",
      ]);
      expect((await migrator.migrateDown()).error).toBeUndefined();
      expect(await tables(db, schema.name)).not.toContain("game_seat_control");
      expect(await tables(db, schema.name)).toContain("game_assignments");
      expect((await migrator.migrateDown()).error).toBeUndefined();
      expect(await tables(db, schema.name)).not.toContain("game_assignments");
      const again = await migrator.migrateToLatest();
      expect(again.error).toBeUndefined();
      expect(again.results).toHaveLength(2);
      expect((await migrator.migrateToLatest()).results).toEqual([]);
    });
  });

  it("TST-GACC-DB-002 constraints: distinct players, known users, formats, one row per seat, unique leases", async () => {
    await withGameAccessSchema(APP, {}, async (schema) => {
      const { alice, bob, store, db } = await seeded(schema);
      expect(await store.reserveAssignment(newAssignment(G1, alice, bob))).toBe("reserved");
      expect(await store.reserveAssignment(newAssignment(G1, bob, alice))).toBe("already_assigned");
      expect(await sqlstateOf(store.reserveAssignment(newAssignment(G2, alice, alice)))).toBe(
        "23514",
      );
      const unknown = "00000000-0000-4000-8000-000000000000";
      expect(
        await sqlstateOf(
          sql`insert into game_assignments (game_id, white_user_id, black_user_id, state)
          values ('g-x', ${alice}, ${unknown}, 'pending')`.execute(db),
        ),
      ).toBe("23503");
      expect(
        await sqlstateOf(
          sql`insert into game_assignments (game_id, white_user_id, black_user_id, state)
          values ('bad id!', ${alice}, ${bob}, 'pending')`.execute(db),
        ),
      ).toBe("23514");
      expect(
        await sqlstateOf(
          sql`insert into game_assignments (game_id, white_user_id, black_user_id, state)
          values ('g-y', ${alice}, ${bob}, 'weird')`.execute(db),
        ),
      ).toBe("23514");
      expect(
        await sqlstateOf(
          sql`update game_assignments set state = 'confirmed' where game_id = ${G1}`.execute(db),
        ),
      ).toBe("23514");
      const control = (seat: string, lease: string, version: number) =>
        sql`insert into game_seat_control (game_id, seat, control_lease_id, control_version)
            values (${G1}, ${seat}, ${lease}, ${version})`.execute(db);
      expect(await sqlstateOf(control("green", newControlLease(), 0))).toBe("23514");
      expect(await sqlstateOf(control("white", newControlLease(), 0))).toBe("23505");
      await sql`delete from game_seat_control where game_id = ${G1} and seat = 'white'`.execute(db);
      expect(await sqlstateOf(control("white", "short", 0))).toBe("23514");
      expect(await sqlstateOf(control("white", newControlLease(), -1))).toBe("23514");
      const black = await store.findControl(G1, "black");
      expect(await sqlstateOf(control("white", black?.controlLeaseId ?? "", 0))).toBe("23505");
      expect(await sqlstateOf(sql`delete from users where user_id = ${alice}`.execute(db))).toBe(
        "23001",
      );
    });
  });

  it("TST-GACC-DB-003 confirm, discard (cascading), CAS transfer, and the session foreign key", async () => {
    await withGameAccessSchema(APP, {}, async (schema) => {
      const { alice, bob, carol, store } = await seeded(schema);
      await store.reserveAssignment(newAssignment(G1, alice, bob));
      await store.reserveAssignment(newAssignment(G2, carol, alice));
      expect(await store.findAssignment(G1)).toEqual({
        gameId: G1,
        players: { white: alice, black: bob },
        state: "pending",
      });
      expect(await store.discardPendingAssignment(G2)).toBe(true);
      expect(await store.findControl(G2, "white")).toBeNull();
      expect(await store.confirmAssignment(G1)).toBe(true);
      expect(await store.confirmAssignment(G1)).toBe(false);
      expect(await store.discardPendingAssignment(G1)).toBe(false);
      expect((await store.findAssignment(G1))?.state).toBe("confirmed");
      expect(await store.seatsOf(alice, 10)).toEqual([{ gameId: G1, seat: "white" }]);
      expect(await store.seatsOf(carol, 10)).toEqual([]);

      const h = accountsHarness({
        repository: new PostgresAccountsRepository(schema.base.accounts()),
      });
      const session = (await signedIn(h, "Alice")).session;
      const initial = await store.findControl(G1, "white");
      if (initial === null) throw new Error("no control");
      const lease = newControlLease();
      const seat: Seat = "white";
      const change = {
        gameId: G1,
        seat,
        expectedVersion: initial.version,
        sessionId: session.sessionId,
        controlLeaseId: lease,
      };
      expect(await store.transferControl(change)).toEqual({
        gameId: G1,
        seat: "white",
        controllingSessionId: session.sessionId,
        controlLeaseId: lease,
        version: 1,
      });
      expect(await store.transferControl({ ...change, controlLeaseId: newControlLease() })).toBe(
        null,
      );
      expect(await store.controlsHeldBySession(session.sessionId)).toHaveLength(1);
      expect(await store.controlsHeldForUser(alice)).toHaveLength(1);
      expect(await store.controlsHeldForUser(bob)).toEqual([]);
      await sql`delete from user_sessions where session_id = ${session.sessionId}`.execute(
        schema.gameAccess(1),
      );
      expect((await store.findControl(G1, "white"))?.controllingSessionId).toBeNull();
    });
  });

  it("TST-GACC-DB-004 every lookup has an index, and the planner can use it", async () => {
    await withGameAccessSchema(APP, {}, async (schema) => {
      const { alice, bob, db } = await seeded(schema);
      const { rows } = await sql<{ name: string }>`
        select indexname as name from pg_indexes where schemaname = ${schema.name}
        and tablename in ('game_assignments', 'game_seat_control') order by indexname`.execute(db);
      expect(rows.map((row) => row.name)).toEqual([
        "game_assignments_black_idx",
        "game_assignments_pkey",
        "game_assignments_white_idx",
        "game_seat_control_lease_key",
        "game_seat_control_pkey",
        "game_seat_control_session_idx",
      ]);
      const plans = await db.connection().execute(async (connection) => {
        await sql`set enable_seqscan = off`.execute(connection);
        const plan = async (query: RawBuilder<unknown>) =>
          JSON.stringify((await sql`explain (format json) ${query}`.execute(connection)).rows);
        return [
          await plan(
            sql`select game_id from game_assignments where white_user_id = ${alice} order by created_at desc limit 5`,
          ),
          await plan(
            sql`select game_id from game_assignments where black_user_id = ${bob} order by created_at desc limit 5`,
          ),
          await plan(
            sql`select seat from game_seat_control where controlling_session_id = '00000000-0000-4000-8000-000000000000'`,
          ),
          await plan(
            sql`select seat from game_seat_control where game_id = 'x' and seat = 'white'`,
          ),
        ];
      });
      expect(plans[0]).toContain("game_assignments_white_idx");
      expect(plans[1]).toContain("game_assignments_black_idx");
      expect(plans[2]).toContain("game_seat_control_session_idx");
      expect(plans[3]).toContain("game_seat_control_pkey");
    });
  });

  it("TST-GACC-DB-005 races: one reservation per game id, one winner per control version", async () => {
    await withGameAccessSchema(APP, {}, async (schema) => {
      const { alice, bob, store } = await seeded(schema);
      const reservations = await Promise.all(
        Array.from({ length: 8 }, () => store.reserveAssignment(newAssignment(G1, alice, bob))),
      );
      expect(reservations.filter((result) => result === "reserved")).toHaveLength(1);
      const h = accountsHarness({
        repository: new PostgresAccountsRepository(schema.base.accounts()),
      });
      const sessions = await Promise.all(
        Array.from({ length: 4 }, () => signedIn(h, "Alice").then((s) => s.session.sessionId)),
      );
      const transfers = await Promise.all(
        sessions.map((sessionId) =>
          store.transferControl({
            gameId: G1,
            seat: "white",
            expectedVersion: 0,
            sessionId,
            controlLeaseId: newControlLease(),
          }),
        ),
      );
      const winners = transfers.filter((record) => record !== null);
      expect(winners).toHaveLength(1);
      expect(await store.findControl(G1, "white")).toEqual(winners[0]);
    });
  });

  it("TST-GACC-DB-006 corrupt rows fail closed: wrong holder, same user twice, duplicate seat, bad seat, lease, or version", async () => {
    await withGameAccessSchema(APP, {}, async (schema) => {
      const { alice, bob, store, db } = await seeded(schema);
      await store.reserveAssignment(newAssignment(G1, alice, bob));
      const h = accountsHarness({
        repository: new PostgresAccountsRepository(schema.base.accounts()),
      });
      const bobSession = (await signedIn(h, "Bob")).session.sessionId;
      await sql`update game_seat_control set controlling_session_id = ${bobSession}
                where game_id = ${G1} and seat = 'white'`.execute(db);
      const wrongHolder = await storeErrorOf(store.findControl(G1, "white"));
      expect([wrongHolder?.kind, wrongHolder?.detail]).toEqual([
        "corrupt",
        "game_seat_control.controlling_session_id",
      ]);
      expect((await storeErrorOf(store.controlsHeldBySession(bobSession)))?.kind).toBe("corrupt");
      await sql`update game_seat_control set controlling_session_id = null`.execute(db);

      await sql`alter table game_seat_control drop constraint game_seat_control_lease_format`.execute(
        db,
      );
      await sql`update game_seat_control set control_lease_id = 'short' where seat = 'black'`.execute(
        db,
      );
      expect((await storeErrorOf(store.findControl(G1, "black")))?.detail).toBe(
        "game_seat_control.control_lease_id",
      );
      await sql`alter table game_seat_control drop constraint game_seat_control_version`.execute(
        db,
      );
      await sql`update game_seat_control set control_version = -1, control_lease_id = ${newControlLease()}
                where seat = 'black'`.execute(db);
      expect((await storeErrorOf(store.findControl(G1, "black")))?.detail).toBe(
        "game_seat_control.control_version",
      );
      await sql`alter table game_seat_control drop constraint game_seat_control_pkey`.execute(db);
      await sql`insert into game_seat_control (game_id, seat, control_lease_id, control_version)
                values (${G1}, 'white', ${newControlLease()}, 0)`.execute(db);
      expect((await storeErrorOf(store.findControl(G1, "white")))?.detail).toBe(
        "game_seat_control.seat",
      );
      await sql`alter table game_seat_control drop constraint game_seat_control_seat`.execute(db);
      await sql`update game_seat_control set seat = 'green', controlling_session_id = ${bobSession}
                where seat = 'black'`.execute(db);
      expect((await storeErrorOf(store.controlsHeldBySession(bobSession)))?.detail).toBe(
        "game_seat_control.seat",
      );

      await sql`alter table game_assignments drop constraint game_assignments_distinct_players`.execute(
        db,
      );
      await sql`update game_assignments set black_user_id = white_user_id`.execute(db);
      expect((await storeErrorOf(store.findAssignment(G1)))?.detail).toBe(
        "game_assignments.players",
      );

      const facts = gameAccessHarness({ store });
      expect(await facts.access.resolve(alice, G1)).toBe("unavailable");
      expect(facts.facts.named("game_access_unavailable")).toEqual([
        { name: "game_access_unavailable", operation: "resolve", cause: "store_corrupt" },
      ]);
    });
  });

  it("TST-GACC-DB-007 a seat left pointing at a revoked session is control for nobody", async () => {
    await withGameAccessSchema(APP, {}, async (schema) => {
      const repository = new PostgresAccountsRepository(schema.base.accounts());
      const store = new PostgresGameAccessStore(schema.gameAccess());
      const h = gameAccessHarness({ store, accounts: { repository } });
      const alice = await registered(h.accounts, "Alice");
      const bob = await registered(h.accounts, "Bob");
      const assigned = await h.access.createAssignedGame({
        gameId: G1,
        white: alice.account.userId,
        black: bob.account.userId,
        timeControl: TIME_CONTROL,
      });
      expect(assigned.ok).toBe(true);
      h.access.dispose();
      const revoked = sessionOf(h, alice);
      const claimed = await revoked.authority.claim(G1);
      expect(claimed.kind).toBe("granted");
      await h.accounts.accounts.logout(alice.session.token);
      const record = await store.findControl(G1, "white");
      expect(record?.controllingSessionId).toBe(alice.session.sessionId);
      expect(await revoked.authority.claim(G1)).toEqual({
        kind: "refused",
        reason: "session_ended",
      });
      const fresh = sessionOf(h, await signedIn(h.accounts, "Alice"));
      expect(await fresh.authority.access(G1)).toMatchObject({ control: { held: false } });
      const taken = await fresh.authority.claim(G1);
      expect(taken.kind).toBe("granted");
      const after = await store.findControl(G1, "white");
      expect(after?.controllingSessionId).toBe(fresh.signedIn.session.sessionId);
      expect(after?.version).toBe((record?.version ?? 0) + 1);
    });
  });
});
