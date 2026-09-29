import { PostgresAccountsRepository } from "@chess-one/accounts-persistence";
import { PostgresGameAccessStore } from "@chess-one/game-access-persistence";
import { isUserId, type UserId } from "@chess-one/identity";
import { PostgresLiveGameRepository } from "@chess-one/live-game-persistence";
import { isControlLeaseId } from "@chess-one/live-game-runtime";
import { sql } from "kysely";
import { describe, expect, it } from "vitest";
import { GAME_ID, moveCommand } from "../live-game/support/harness.ts";
import { field, openClient, type TestClient } from "../realtime/support/client.ts";
import { domain, storedState } from "../realtime/support/runtime.ts";
import { type GameAccessSchema, withGameAccessSchema } from "./support/db.ts";
import {
  type AccessStack,
  accessStack,
  assign,
  claimGranted,
  claimMessage,
  expectNoDefects,
  logIn,
  logOut,
  moveMessage,
  signUp,
  socketOf,
} from "./support/stack.ts";

const APP = "chess-one-game-access-e2e-test";
const DOMAIN_RESTARTED = domain("rt-boot-restarted");

/** One process of the full stack over the schema's PostgreSQL tables. */
function stackOver(schema: GameAccessSchema, clockDomain = domain("rt-boot-a")) {
  return accessStack({
    accountsRepository: new PostgresAccountsRepository(schema.base.accounts()),
    store: new PostgresGameAccessStore(schema.gameAccess()),
    liveGame: new PostgresLiveGameRepository(schema.base.liveGame()),
    clockDomain,
  });
}

interface SeatRow {
  readonly seat: string;
  readonly session: string | null;
  readonly lease: string;
  readonly version: string;
}

interface SeatRows {
  readonly white: SeatRow | undefined;
  readonly black: SeatRow | undefined;
}

async function seatRows(schema: GameAccessSchema): Promise<SeatRows> {
  const { rows } = await sql<SeatRow>`
    select seat, controlling_session_id::text as session, control_lease_id as lease,
           control_version::text as version
    from game_seat_control where game_id = ${GAME_ID} order by seat`.execute(schema.gameAccess(1));
  return {
    white: rows.find((row) => row.seat === "white"),
    black: rows.find((row) => row.seat === "black"),
  };
}

async function sessionIdOf(schema: GameAccessSchema, userId: string): Promise<string[]> {
  const { rows } = await sql<{ id: string }>`
    select session_id::text as id from user_sessions
    where user_id = ${userId}::uuid and revoked_at is null order by created_at`.execute(
    schema.base.accounts(1),
  );
  return rows.map((row) => row.id);
}

interface DurableRows {
  readonly bindings: string;
  readonly events: string;
  readonly game: string;
}

/** The game row, its command bindings, and its outbox events, as stored. */
async function durableRows(schema: GameAccessSchema): Promise<DurableRows> {
  const { rows } = await sql<DurableRows>`
    select
      (select count(*)::text from live_game_command_bindings where game_id = ${GAME_ID}) as bindings,
      (select count(*)::text from outbox_events where aggregate_id = ${GAME_ID}) as events,
      (select row_to_json(g)::text from live_games g where game_id = ${GAME_ID}) as game`.execute(
    schema.base.liveGame(),
  );
  const [row] = rows;
  if (row === undefined) throw new Error("no rows");
  return row;
}

async function response(client: TestClient): Promise<unknown> {
  return field(await client.next("command_response"), "response");
}

async function failureCode(client: TestClient): Promise<unknown> {
  return field(await client.next("request_failed"), "code");
}

function userOf(value: string): UserId {
  if (!isUserId(value)) throw new Error("not a user id");
  return value;
}

async function closeAll(...clients: TestClient[]): Promise<void> {
  await Promise.all(clients.map((client) => client.close()));
}

async function withSchema(run: (schema: GameAccessSchema) => Promise<void>): Promise<void> {
  await withGameAccessSchema(APP, {}, run);
}

async function finish(stack: AccessStack): Promise<void> {
  await stack.close();
  expectNoDefects(stack);
}

describe("TST-GACC-E2E accounts, game access, control, and play over PostgreSQL", () => {
  it("TST-GACC-E2E-001 the 20 steps: assigned game, claims, takeover by a second session, restart", async () => {
    await withSchema(async (schema) => {
      const first = await stackOver(schema);
      // 1–2. Two accounts over real HTTP, each logged in (cookie only).
      const whiteId = await signUp(first, "Whitey");
      const blackId = await signUp(first, "Blacky");
      const cookieA = await logIn(first, "whitey");
      const blackCookie = await logIn(first, "blacky");
      // 3. The trusted internal use case assigns and starts the game.
      await assign(first, whiteId, blackId);
      const assignment = await sql<{ state: string }>`
        select state from game_assignments where game_id = ${GAME_ID}`.execute(
        schema.gameAccess(1),
      );
      expect(assignment.rows).toEqual([{ state: "confirmed" }]);
      // 4. Both players connect; the seat comes from the assignment.
      const a = await socketOf(first, cookieA);
      expect(field(a.received[0], "games")).toEqual([{ gameId: GAME_ID, seat: "white" }]);
      const black = await socketOf(first, blackCookie);
      // 5. Both sync without control.
      expect(field(await a.sync(GAME_ID), "snapshot", "controlHeld")).toBe(false);
      expect(field(await black.sync(GAME_ID), "snapshot", "controlHeld")).toBe(false);
      // 6. Both claim.
      await claimGranted(a, "claim-a");
      await claimGranted(black, "claim-black");
      // 7. Both move; the moves are committed to PostgreSQL.
      a.send(moveMessage("mv-1", "w-1", 0, "e2e4"));
      expect(field(await response(a), "code")).toBe("Accepted");
      black.send(moveMessage("mv-2", "b-1", 1, "e7e5"));
      expect(field(await response(black), "code")).toBe("Accepted");
      // 8. A third user is refused everything, with no game data.
      await signUp(first, "Mallory");
      const mallory = await socketOf(first, await logIn(first, "mallory"));
      mallory.send({ type: "sync_game", requestId: "m-s", gameId: GAME_ID });
      expect(await failureCode(mallory)).toBe("GAME_ACCESS_DENIED");
      mallory.send(claimMessage("m-c"));
      expect(field(await mallory.next("control_denied"), "code")).toBe("GAME_ACCESS_DENIED");
      mallory.send(moveMessage("m-m", "m-1", 2, "g1f3"));
      expect(await failureCode(mallory)).toBe("GAME_ACCESS_DENIED");
      expect(JSON.stringify(mallory.received)).not.toMatch(/positionFen|seat/);
      // 9. White logs in again: session B syncs and sees the seat without control.
      const cookieB = await logIn(first, "whitey");
      const b = await socketOf(first, cookieB);
      const synced = field(await b.sync(GAME_ID), "snapshot");
      expect([field(synced, "controlHeld"), field(synced, "sequence")]).toEqual([false, 2]);
      // 10. B cannot command.
      b.send(moveMessage("mv-b0", "early", 2, "g1f3"));
      expect(await failureCode(b)).toBe("CONTROL_NOT_HELD");
      // 11. B claims.
      await claimGranted(b, "claim-b");
      // 12. A is told.
      expect(field(await a.next("control_revoked"), "code")).toBe("CONTROL_TRANSFERRED");
      // 13. A's new command is never admitted: only a read-only replay lookup.
      const commits = first.ga.runtime.repository.commits;
      a.send(moveMessage("mv-a2", "w-2", 2, "g1f3"));
      expect(await failureCode(a)).toBe("CONTROL_NOT_HELD");
      expect(first.ga.runtime.facts.count("command_replayed")).toBe(0);
      expect(first.ga.runtime.repository.commits).toBe(commits);
      // 14. B's command is accepted.
      b.send(moveMessage("mv-b1", "w-2", 2, "g1f3"));
      const accepted = await response(b);
      expect(field(accepted, "code")).toBe("Accepted");
      // 15. PostgreSQL: B's session holds white, the lease rotated twice, three moves.
      const sessionB = (await sessionIdOf(schema, whiteId)).at(-1);
      const rows = await seatRows(schema);
      expect([rows.white?.session, rows.white?.version]).toEqual([sessionB, "2"]);
      const beforeRestart = await storedState(first.ga.runtime);
      expect(beforeRestart.controlLeases.white).toBe(rows.white?.lease);
      expect(beforeRestart.sequence).toBe(3);
      await closeAll(a, b, black, mallory);
      await finish(first);

      // 16. Restart: a new process over the same database, in a new clock domain.
      const second = await stackOver(schema, DOMAIN_RESTARTED);
      // 17. B still controls; the game waits for recovery.
      const b2 = await socketOf(second, cookieB);
      const after = field(await b2.sync(GAME_ID), "snapshot");
      expect(field(after, "controlHeld")).toBe(true);
      expect(field(after, "sequence")).toBe(3);
      expect(field(after, "recoveryReason")).toBe("RECOVERY_PAUSED_CLOCK_DOMAIN_CHANGED");
      expect(field(after, "playable")).toBe(false);
      expect(field(await b2.next("recovery_required"), "clientCommandId")).toBeNull();
      // 18. Control grants no resume: a new command is not executed, a claim changes nothing.
      b2.send(moveMessage("mv-b2", "w-3", 4, "f1c4"));
      const paused = await b2.next("recovery_required");
      expect(field(paused, "clientCommandId")).toBe("w-3");
      await claimGranted(b2, "claim-b2");
      expect(field(await b2.sync(GAME_ID, "sync-2"), "snapshot", "recoveryRequired")).toBe(true);
      // 19. History and idempotency survived: three bindings, in order.
      const state = await storedState(second.ga.runtime);
      expect(state.sequence).toBe(3);
      expect(state.history).toEqual(beforeRestart.history);
      expect(state.position).toEqual(beforeRestart.position);
      expect(state.controlLeases).toEqual(beforeRestart.controlLeases);
      expect(state.commandBindings.map((binding) => binding.clientCommandId)).toEqual([
        "w-1",
        "b-1",
        "w-2",
      ]);
      expect((await seatRows(schema)).white?.version).toBe("2");
      // 20. A, reconnecting, sees its seat but not control, and is refused.
      const a2 = await socketOf(second, cookieA);
      expect(field(await a2.sync(GAME_ID), "snapshot", "controlHeld")).toBe(false);
      a2.send(moveMessage("mv-a3", "w-9", 3, "f1c4"));
      expect(await failureCode(a2)).toBe("CONTROL_NOT_HELD");
      await closeAll(b2, a2);
      await finish(second);
    });
  });

  it("TST-GACC-E2E-002 logout releases control in PostgreSQL to nobody, and the lease the writer admits rotates", async () => {
    await withSchema(async (schema) => {
      const stack = await stackOver(schema);
      const whiteId = await signUp(stack, "Whitey");
      const blackId = await signUp(stack, "Blacky");
      await assign(stack, whiteId, blackId);
      const cookie = await logIn(stack, "whitey");
      const a = await socketOf(stack, cookie);
      await a.sync(GAME_ID);
      await claimGranted(a, "claim-a");
      const before = await seatRows(schema);
      await logOut(stack, cookie);
      expect(await a.closed).toEqual({ code: 1008, reason: "session_ended" });
      await stack.ga.access.settled();
      const after = await seatRows(schema);
      expect(after.white?.session).toBeNull();
      expect(after.white?.lease).not.toBe(before.white?.lease);
      expect((await storedState(stack.ga.runtime)).controlLeases.white).toBe(after.white?.lease);
      expect(after.black).toEqual(before.black);
      await finish(stack);
    });
  });

  it("TST-GACC-E2E-003 disabling an account in PostgreSQL releases its seats and resigns nothing, across a restart", async () => {
    await withSchema(async (schema) => {
      const stack = await stackOver(schema);
      const whiteId = await signUp(stack, "Whitey");
      const blackId = await signUp(stack, "Blacky");
      await assign(stack, whiteId, blackId);
      const whiteCookie = await logIn(stack, "whitey");
      const blackCookie = await logIn(stack, "blacky");
      const white = await socketOf(stack, whiteCookie);
      const black = await socketOf(stack, blackCookie);
      await white.sync(GAME_ID);
      await black.sync(GAME_ID);
      await claimGranted(white, "c-w");
      await claimGranted(black, "c-b");
      expect(await stack.ga.accounts.accounts.setAccountStatus(userOf(whiteId), "disabled")).toBe(
        true,
      );
      expect(await white.closed).toEqual({ code: 1008, reason: "session_ended" });
      await stack.ga.access.settled();
      expect((await seatRows(schema)).white?.session).toBeNull();
      expect((await seatRows(schema)).black?.session).not.toBeNull();
      expect((await storedState(stack.ga.runtime)).status.kind).toBe("active");
      await black.close();
      await finish(stack);

      const restarted = await stackOver(schema, DOMAIN_RESTARTED);
      expect(
        await openClient(restarted.ws, { token: null, headers: { cookie: whiteCookie } }),
      ).toMatchObject({ kind: "refused", status: 401 });
      const black2 = await socketOf(restarted, blackCookie);
      expect(field(await black2.sync(GAME_ID), "snapshot", "controlHeld")).toBe(true);
      await black2.close();
      await finish(restarted);
    });
  });

  it("TST-GACC-E2E-004 replay after rotation over PostgreSQL: exact X answered from storage, new Y refused, then B's Y accepted", async () => {
    await withSchema(async (schema) => {
      const stack = await stackOver(schema);
      const whiteId = await signUp(stack, "Whitey");
      const blackId = await signUp(stack, "Blacky");
      await assign(stack, whiteId, blackId);
      const a = await socketOf(stack, await logIn(stack, "whitey"));
      await a.sync(GAME_ID);
      await claimGranted(a, "claim-a");
      a.send(moveMessage("x-1", "X", 0, "e2e4"));
      const original = await response(a);
      expect(field(original, "code")).toBe("Accepted");
      const b = await socketOf(stack, await logIn(stack, "whitey"));
      await b.sync(GAME_ID);
      await claimGranted(b, "claim-b");
      await a.next("control_revoked");
      const commits = stack.ga.runtime.repository.commits;
      a.send(moveMessage("x-2", "X", 0, "e2e4"));
      const replayed = await response(a);
      expect([field(replayed, "replayed"), field(replayed, "sequence")]).toEqual([true, 1]);
      expect(field(replayed, "clock")).toEqual(field(original, "clock"));
      a.send(moveMessage("y-1", "Y", 1, "d2d4"));
      expect(await failureCode(a)).toBe("CONTROL_NOT_HELD");
      expect(stack.ga.runtime.repository.commits).toBe(commits);
      const black = await socketOf(stack, await logIn(stack, "blacky"));
      await black.sync(GAME_ID);
      await claimGranted(black, "claim-k");
      black.send(moveMessage("k-1", "K", 1, "e7e5"));
      expect(field(await response(black), "code")).toBe("Accepted");
      b.send(moveMessage("y-2", "Y", 2, "d2d4"));
      expect(field(await response(b), "code")).toBe("Accepted");
      const state = await storedState(stack.ga.runtime);
      expect(state.commandBindings.map((binding) => binding.clientCommandId)).toEqual([
        "X",
        "K",
        "Y",
      ]);
      await closeAll(a, b, black);
      await finish(stack);
    });
  });

  it("TST-GACC-E2E-007 replay after a process restart over PostgreSQL: the stored answer for the seat's player only, and nothing changes", async () => {
    await withSchema(async (schema) => {
      const first = await stackOver(schema);
      const whiteId = await signUp(first, "Whitey");
      const blackId = await signUp(first, "Blacky");
      await signUp(first, "Mallory");
      await assign(first, whiteId, blackId);
      const cookieA = await logIn(first, "whitey");
      const blackCookie = await logIn(first, "blacky");
      const a = await socketOf(first, cookieA);
      await claimGranted(a, "claim-a");
      a.send(moveMessage("x-1", "X", 0, "e2e4"));
      const original = await response(a);
      expect(field(original, "code")).toBe("Accepted");
      const cookieB = await logIn(first, "whitey");
      const b = await socketOf(first, cookieB);
      await claimGranted(b, "claim-b");
      await a.next("control_revoked");
      await closeAll(a, b);
      await finish(first);

      for (const clockDomain of [domain("rt-boot-a"), DOMAIN_RESTARTED]) {
        const restarted = await stackOver(schema, clockDomain);
        const a2 = await socketOf(restarted, cookieA);
        expect(field(await a2.sync(GAME_ID), "snapshot", "controlHeld")).toBe(false);
        const rowsBefore = await seatRows(schema);
        const durableBefore = await durableRows(schema);
        expect(durableBefore.bindings).toBe("1");
        const before = await storedState(restarted.ga.runtime);
        a2.send(moveMessage("x-2", "X", 0, "e2e4"));
        const replayed = await response(a2);
        if (typeof original !== "object" || original === null) throw new Error("no response");
        expect(replayed).toEqual({ ...original, replayed: true });
        a2.send(moveMessage("x-3", "X", 0, "d2d4"));
        expect(await failureCode(a2)).toBe("INVALID_COMMAND_IDENTITY");
        a2.send(moveMessage("y-1", "Y", 1, "d2d4"));
        expect(await failureCode(a2)).toBe("CONTROL_NOT_HELD");
        const c = await socketOf(restarted, await logIn(restarted, "whitey"));
        c.send(moveMessage("x-c", "X", 0, "e2e4"));
        expect(field(await response(c), "replayed")).toBe(true);
        const black = await socketOf(restarted, blackCookie);
        black.send(moveMessage("x-k", "X", 0, "e2e4"));
        expect(await failureCode(black)).toBe("CONTROL_NOT_HELD");
        const mallory = await socketOf(restarted, await logIn(restarted, "mallory"));
        mallory.send(moveMessage("x-m", "X", 0, "e2e4"));
        expect(await failureCode(mallory)).toBe("GAME_ACCESS_DENIED");
        for (const client of [black, mallory]) {
          expect(JSON.stringify(client.received)).not.toMatch(/"replayed"|"command_response"/);
        }
        const b2 = await socketOf(restarted, cookieB);
        expect(field(await b2.sync(GAME_ID), "snapshot", "controlHeld")).toBe(true);
        b2.send(moveMessage("x-b", "X", 0, "e2e4"));
        expect(await response(b2)).toEqual({ ...original, replayed: true });
        b2.send(moveMessage("x-b-altered", "X", 0, "d2d4"));
        expect(await failureCode(b2)).toBe("INVALID_COMMAND_IDENTITY");
        expect(JSON.stringify(b2.received)).not.toMatch(/InvalidCommandIdentity/);
        expect(JSON.stringify(b2.received)).not.toMatch(/lease|fingerprint/i);
        await b2.close();
        expect(restarted.ga.runtime.repository.commits).toBe(0);
        const after = await storedState(restarted.ga.runtime);
        expect(after.sequence).toBe(1);
        expect(after.commandBindings).toEqual(before.commandBindings);
        expect(after.clock).toEqual(before.clock);
        expect(await seatRows(schema)).toEqual(rowsBefore);
        expect(await durableRows(schema)).toEqual(durableBefore);
        await closeAll(a2, c, black, mallory);
        await finish(restarted);
      }
    });
  });

  it("TST-GACC-E2E-005 revocation racing a command: nothing is played under a released seat", async () => {
    await withSchema(async (schema) => {
      const stack = await stackOver(schema);
      const whiteId = await signUp(stack, "Whitey");
      const blackId = await signUp(stack, "Blacky");
      await assign(stack, whiteId, blackId);
      const cookie = await logIn(stack, "whitey");
      const a = await socketOf(stack, cookie);
      await a.sync(GAME_ID);
      await claimGranted(a, "claim-a");
      const held = (await seatRows(schema)).white?.lease ?? "";
      a.send(moveMessage("mv-1", "w-1", 0, "e2e4"));
      const logout = logOut(stack, cookie);
      a.send(moveMessage("mv-2", "w-2", 1, "d2d4"));
      await logout;
      await a.closed;
      await stack.ga.access.settled();
      const rows = await seatRows(schema);
      expect(rows.white?.session).toBeNull();
      expect(rows.white?.lease).not.toBe(held);
      const state = await storedState(stack.ga.runtime);
      expect(state.controlLeases.white).toBe(rows.white?.lease);
      expect(state.sequence).toBeLessThanOrEqual(1);
      const bound = state.commandBindings.map((binding) => binding.clientCommandId);
      expect(["w-1", "w-2"]).toEqual(expect.arrayContaining(bound));
      const answers = a.received.filter((message) => field(message, "type") === "command_response");
      expect(answers.length).toBeLessThanOrEqual(bound.length);
      const writer = stack.ga.runtime.registry.acquire(GAME_ID);
      if (writer === null || !isControlLeaseId(held)) throw new Error("no writer or lease");
      const stale = writer.submitCommand(
        { gameId: GAME_ID, playerId: state.players.white, seat: "white", controlLeaseId: held },
        { ...moveCommand(state, "d2d4"), controlLeaseId: held },
        () => undefined,
      );
      expect(stale).toEqual({ accepted: false, reason: "control_not_held" });
      await finish(stack);
    });
  });

  it("TST-GACC-E2E-006 disable racing a command: the seat ends released and the writer agrees", async () => {
    await withSchema(async (schema) => {
      const stack = await stackOver(schema);
      const whiteId = await signUp(stack, "Whitey");
      const blackId = await signUp(stack, "Blacky");
      await assign(stack, whiteId, blackId);
      const a = await socketOf(stack, await logIn(stack, "whitey"));
      await a.sync(GAME_ID);
      await claimGranted(a, "claim-a");
      a.send(moveMessage("mv-1", "w-1", 0, "e2e4"));
      await stack.ga.accounts.accounts.setAccountStatus(userOf(whiteId), "locked");
      await a.closed;
      await stack.ga.access.settled();
      const rows = await seatRows(schema);
      expect(rows.white?.session).toBeNull();
      const state = await storedState(stack.ga.runtime);
      expect(state.controlLeases.white).toBe(rows.white?.lease);
      expect(state.status.kind).toBe("active");
      await finish(stack);
    });
  });
});
