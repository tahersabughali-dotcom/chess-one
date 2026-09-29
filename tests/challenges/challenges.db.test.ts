import { PostgresAccountsRepository } from "@chess-one/accounts-persistence";
import {
  type ChallengeId,
  DEFAULT_CHALLENGE_RULESET_ID,
  isChallengeId,
  isGameReference,
} from "@chess-one/challenge-domain";
import { ChallengeStoreError, newChallengeId } from "@chess-one/challenges";
import {
  CHALLENGES_MIGRATION_LOCK_TABLE,
  CHALLENGES_MIGRATION_TABLE,
  type ChallengesDatabase,
  challengesMigrator,
  PostgresChallengeStore,
} from "@chess-one/challenges-persistence";
import { isUserId, type UserId } from "@chess-one/identity";
import { type Kysely, type RawBuilder, sql } from "kysely";
import { describe, expect, it } from "vitest";
import { accountsHarness, WALL_START } from "../accounts/support/harness.ts";
import {
  CHALLENGES_MIGRATIONS,
  type ChallengesSchema,
  withChallengesSchema,
} from "./support/db.ts";
import type { FakeGameCreator } from "./support/games.ts";
import {
  type ChallengeHarness,
  challengeHarness,
  createInput,
  DAY,
  type Player,
} from "./support/harness.ts";

const APP = "chess-one-challenges-db-test";

function db(schema: ChallengesSchema, connections = 8): Kysely<ChallengesDatabase> {
  return schema.challenges(connections);
}

function stack(schema: ChallengesSchema): ChallengeHarness {
  const accounts = accountsHarness({
    repository: new PostgresAccountsRepository(schema.base.accounts()),
  });
  return challengeHarness({ accounts, store: new PostgresChallengeStore(db(schema)) });
}

/**
 * A second process: its own pool and application over the same accounts and
 * tables, and the same game creator (one game store for both).
 */
function otherProcess(schema: ChallengesSchema, h: ChallengeHarness): ChallengeHarness {
  return challengeHarness({
    accounts: h.accounts,
    store: new PostgresChallengeStore(db(schema)),
    ...(h.fakeGames === null ? {} : { games: h.fakeGames }),
  });
}

function gamesOf(h: ChallengeHarness): FakeGameCreator {
  if (h.fakeGames === null) throw new Error("fake game creator expected");
  return h.fakeGames;
}

interface StoredAcceptance {
  readonly status: string;
  readonly intended_game_id: string | null;
  readonly created_game_id: string | null;
  readonly white_user_id: string | null;
  readonly black_user_id: string | null;
  readonly accepted_ms: string | null;
  readonly deadline_ms: string | null;
  readonly resolved_ms: string | null;
}

async function acceptanceRow(
  target: Kysely<ChallengesDatabase>,
  challengeId: string,
): Promise<StoredAcceptance | undefined> {
  const found = await sql<StoredAcceptance>`
    SELECT status, intended_game_id, created_game_id,
      white_user_id::text AS white_user_id, black_user_id::text AS black_user_id,
      (extract(epoch FROM accepted_at) * 1000)::bigint::text AS accepted_ms,
      (extract(epoch FROM start_deadline_at) * 1000)::bigint::text AS deadline_ms,
      (extract(epoch FROM resolved_at) * 1000)::bigint::text AS resolved_ms
    FROM challenges WHERE challenge_id = ${challengeId}
  `.execute(target);
  return found.rows[0];
}

function id(text: string): ChallengeId {
  if (!isChallengeId(text)) throw new Error("challenge id expected");
  return text;
}

async function created(h: ChallengeHarness, from: Player, to: string): Promise<ChallengeId> {
  const outcome = await h.challenges.create(from.session, createInput(to));
  if (!outcome.ok) throw new Error(`create failed: ${outcome.error.kind}`);
  return outcome.value.challengeId;
}

function at(epochMs: number) {
  return sql`(timestamptz 'epoch' + ${String(epochMs)}::bigint * interval '1 millisecond')`;
}

interface RowOverrides {
  readonly challengeId?: string;
  readonly challenger?: string;
  readonly challenged?: string;
  readonly status?: string;
  readonly rulesetId?: string;
  readonly type?: string;
  readonly initialMs?: number;
  readonly incrementMs?: number;
  readonly seat?: string;
  readonly createdAt?: number;
  readonly expiresAt?: number;
  readonly resolvedAt?: number | null;
  readonly gameId?: string | null;
  /** Replaces the reservation an accepting or accepted row gets by default; null for none. */
  readonly reservation?: Partial<Reservation> | null;
}

interface Reservation {
  readonly acceptedAt: number;
  readonly intendedGameId: string;
  readonly white: string;
  readonly black: string;
  readonly startDeadlineAt: number;
}

const START_WINDOW_MS = 10 * 60_000;

/**
 * An accepting or accepted row is reserved by default at its resolution time
 * (or one millisecond after creation), for its game id, with the challenger
 * White; any field can be overridden to build an invalid row.
 */
function reservationOf(
  status: string,
  challenger: string,
  challenged: string,
  overrides: RowOverrides,
  createdAt: number,
): Reservation | null {
  if (overrides.reservation === null) return null;
  if (status !== "accepting" && status !== "accepted" && overrides.reservation === undefined) {
    return null;
  }
  const acceptedAt = overrides.reservation?.acceptedAt ?? overrides.resolvedAt ?? createdAt + 1;
  return {
    acceptedAt,
    intendedGameId: overrides.gameId ?? "game-reserved",
    white: challenger,
    black: challenged,
    startDeadlineAt: acceptedAt + START_WINDOW_MS,
    ...overrides.reservation,
  };
}

async function insertRow(
  target: Kysely<ChallengesDatabase>,
  challenger: string,
  challenged: string,
  overrides: RowOverrides = {},
): Promise<string> {
  const createdAt = overrides.createdAt ?? WALL_START;
  const resolvedAt = overrides.resolvedAt ?? null;
  const challengeId = overrides.challengeId ?? newChallengeId();
  const status = overrides.status ?? "pending";
  const from = overrides.challenger ?? challenger;
  const to = overrides.challenged ?? challenged;
  const reserved = reservationOf(status, from, to, overrides, createdAt);
  await sql`
    INSERT INTO challenges (
      challenge_id, challenger_user_id, challenged_user_id, status, ruleset_id,
      time_control_type, initial_time_ms, increment_ms, seat_preference,
      created_at, expires_at, resolved_at, created_game_id,
      accepted_at, intended_game_id, white_user_id, black_user_id, start_deadline_at
    ) VALUES (
      ${challengeId}, ${from}::uuid, ${to}::uuid, ${status},
      ${overrides.rulesetId ?? "FIDE-E01-2023"}, ${overrides.type ?? "sudden_death"},
      ${overrides.initialMs ?? 300_000}, ${overrides.incrementMs ?? 0}, ${overrides.seat ?? "white"},
      ${at(createdAt)}, ${at(overrides.expiresAt ?? createdAt + DAY)},
      ${resolvedAt === null ? null : at(resolvedAt)}, ${overrides.gameId ?? null},
      ${reserved === null ? null : at(reserved.acceptedAt)},
      ${reserved?.intendedGameId ?? null},
      ${reserved?.white ?? null}::uuid, ${reserved?.black ?? null}::uuid,
      ${reserved === null ? null : at(reserved.startDeadlineAt)}
    )
  `.execute(target);
  return challengeId;
}

async function sqlstateOf(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
    return "no error";
  } catch (error: unknown) {
    return typeof error === "object" && error !== null && "code" in error ? error.code : error;
  }
}

async function statusOf(target: Kysely<ChallengesDatabase>, challengeId: string): Promise<string> {
  const row = await target
    .selectFrom("challenges")
    .select("status")
    .where("challenge_id", "=", challengeId)
    .executeTakeFirst();
  return row?.status ?? "missing";
}

describe("TST-CHAL-DB schema", () => {
  it("TST-CHAL-DB-001 the migration creates the table, its indexes, and the guard, with its own bookkeeping, and reverts", async () => {
    await withChallengesSchema(APP, {}, async (schema) => {
      const target = db(schema);
      const indexes = await sql<{ indexname: string }>`
        SELECT indexname FROM pg_indexes WHERE schemaname = ${schema.name} AND tablename = 'challenges'
        ORDER BY indexname
      `.execute(target);
      expect(indexes.rows.map((row) => row.indexname)).toEqual([
        "challenges_accepting_order",
        "challenges_created_game_key",
        "challenges_incoming_pending_idx",
        "challenges_intended_game_key",
        "challenges_outgoing_pending_idx",
        "challenges_pending_expiry_idx",
        "challenges_pending_pair_key",
        "challenges_pkey",
      ]);
      const tables = await sql<{ table_name: string }>`
        SELECT table_name FROM information_schema.tables WHERE table_schema = ${schema.name}
        AND table_name LIKE 'challenges%' ORDER BY table_name
      `.execute(target);
      expect(tables.rows.map((row) => row.table_name)).toEqual([
        "challenges",
        CHALLENGES_MIGRATION_LOCK_TABLE,
        CHALLENGES_MIGRATION_TABLE,
      ]);
      const migrator = challengesMigrator(schema.challenges(1), CHALLENGES_MIGRATIONS, schema.name);
      const failedReverted = await migrator.migrateDown();
      expect(failedReverted.error).toBeUndefined();
      const afterFailed = await sql<{ indexname: string }>`
        SELECT indexname FROM pg_indexes WHERE schemaname = ${schema.name} AND tablename = 'challenges'
      `.execute(target);
      expect(afterFailed.rows.map((row) => row.indexname)).not.toContain(
        "challenges_accepting_order",
      );
      const reverted = await migrator.migrateDown();
      expect(reverted.error).toBeUndefined();
      const columns = async () =>
        (
          await sql<{ column_name: string }>`
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = ${schema.name} AND table_name = 'challenges'
            ORDER BY column_name
          `.execute(target)
        ).rows.map((row) => row.column_name);
      expect(await columns()).not.toContain("intended_game_id");
      const down = await migrator.migrateDown();
      expect(down.error).toBeUndefined();
      const gone = await sql<{ count: string }>`
        SELECT count(*)::text AS count FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = ${schema.name} AND p.proname = 'challenges_guard_update'
      `.execute(target);
      expect(gone.rows[0]?.count).toBe("0");
      expect((await migrator.migrateToLatest()).error).toBeUndefined();
      expect(await columns()).toEqual(
        expect.arrayContaining([
          "accepted_at",
          "intended_game_id",
          "white_user_id",
          "black_user_id",
          "start_deadline_at",
        ]),
      );
    });
  });

  it("TST-CHAL-DB-002 CHECK and foreign-key constraints refuse every invalid row", async () => {
    await withChallengesSchema(APP, {}, async (schema) => {
      const h = stack(schema);
      const alice = await h.player("Alice");
      const bob = await h.player("Bob");
      const target = db(schema);
      const insert = (overrides: RowOverrides) =>
        insertRow(target, alice.userId, bob.userId, overrides);
      const refused: [string, RowOverrides, string][] = [
        ["same player", { challenged: alice.userId }, "23514"],
        ["status", { status: "open" }, "23514"],
        ["seat", { seat: "either" }, "23514"],
        ["increment", { incrementMs: 1_000 }, "23514"],
        ["initial below", { initialMs: 30_000 }, "23514"],
        ["initial above", { initialMs: 10_801_000 }, "23514"],
        ["initial fraction of a second", { initialMs: 300_500 }, "23514"],
        ["type", { type: "fischer" }, "23514"],
        ["ruleset format", { rulesetId: "fide" }, "23514"],
        ["challenge id", { challengeId: "short" }, "23514"],
        ["expiry not after creation", { expiresAt: WALL_START }, "23514"],
        ["pending resolved", { resolvedAt: WALL_START + 1 }, "23514"],
        ["declined unresolved", { status: "declined" }, "23514"],
        ["expired unresolved", { status: "expired" }, "23514"],
        ["accepted unresolved", { status: "accepted", gameId: "g-1" }, "23514"],
        ["declined at the deadline", { status: "declined", resolvedAt: WALL_START + DAY }, "23514"],
        ["declined before creation", { status: "declined", resolvedAt: WALL_START - 1 }, "23514"],
        ["expired early", { status: "expired", resolvedAt: WALL_START + 1 }, "23514"],
        ["accepted without game", { status: "accepted", resolvedAt: WALL_START + 1 }, "23514"],
        [
          "declined with game",
          { status: "declined", resolvedAt: WALL_START + 1, gameId: "g-1" },
          "23514",
        ],
        [
          "game id format",
          { status: "accepted", resolvedAt: WALL_START + 1, gameId: "bad id" },
          "23514",
        ],
        ["unknown user", { challenged: "5b0b0e8e-0000-4000-8000-000000000000" }, "23503"],
      ];
      for (const [name, overrides, code] of refused) {
        expect(await sqlstateOf(insert(overrides)), name).toBe(code);
      }
      expect(await sqlstateOf(insert({}))).toBe("no error");
    });
  });

  it("TST-CHAL-DB-003 one pending challenge per unordered pair; one challenge per created game", async () => {
    await withChallengesSchema(APP, {}, async (schema) => {
      const h = stack(schema);
      const alice = await h.player("Alice");
      const bob = await h.player("Bob");
      const carol = await h.player("Carol");
      const target = db(schema);
      const first = await insertRow(target, alice.userId, bob.userId);
      expect(await sqlstateOf(insertRow(target, alice.userId, bob.userId))).toBe("23505");
      expect(await sqlstateOf(insertRow(target, bob.userId, alice.userId))).toBe("23505");
      expect(await sqlstateOf(insertRow(target, alice.userId, carol.userId))).toBe("no error");
      await sql`UPDATE challenges SET status = 'declined', resolved_at = ${at(WALL_START + 1)} WHERE challenge_id = ${first}`.execute(
        target,
      );
      expect(await sqlstateOf(insertRow(target, bob.userId, alice.userId))).toBe("no error");
      const accepted = { status: "accepted", resolvedAt: WALL_START + 1, gameId: "game-1" };
      expect(await sqlstateOf(insertRow(target, carol.userId, bob.userId, accepted))).toBe(
        "no error",
      );
      expect(await sqlstateOf(insertRow(target, carol.userId, bob.userId, accepted))).toBe("23505");
    });
  });

  it("TST-CHAL-DB-004 a resolved challenge never changes again; a pending one changes only its resolution", async () => {
    await withChallengesSchema(APP, {}, async (schema) => {
      const h = stack(schema);
      const alice = await h.player("Alice");
      const bob = await h.player("Bob");
      const carol = await h.player("Carol");
      const target = db(schema);
      const accepted = await insertRow(target, alice.userId, bob.userId, {
        status: "accepted",
        resolvedAt: WALL_START + 1,
        gameId: "game-1",
      });
      const pending = await insertRow(target, alice.userId, carol.userId);
      for (const change of [
        sql`UPDATE challenges SET created_game_id = 'game-2' WHERE challenge_id = ${accepted}`,
        sql`UPDATE challenges SET status = 'pending', resolved_at = NULL, created_game_id = NULL WHERE challenge_id = ${accepted}`,
        sql`UPDATE challenges SET resolved_at = ${at(WALL_START + 2)} WHERE challenge_id = ${accepted}`,
        sql`UPDATE challenges SET initial_time_ms = 600000 WHERE challenge_id = ${pending}`,
        sql`UPDATE challenges SET challenged_user_id = ${bob.userId}::uuid WHERE challenge_id = ${pending}`,
        sql`UPDATE challenges SET expires_at = ${at(WALL_START + 2 * DAY)} WHERE challenge_id = ${pending}`,
      ]) {
        expect(await sqlstateOf(change.execute(target))).toBe("23000");
      }
      await sql`UPDATE challenges SET status = 'cancelled', resolved_at = ${at(WALL_START + 5)} WHERE challenge_id = ${pending}`.execute(
        target,
      );
      expect(await statusOf(target, pending)).toBe("cancelled");
      expect(
        await sqlstateOf(
          sql`UPDATE challenges SET status = 'declined' WHERE challenge_id = ${pending}`.execute(
            target,
          ),
        ),
      ).toBe("23000");
    });
  });

  it("TST-CHAL-DB-005 users with challenges cannot be deleted (ON DELETE RESTRICT); nothing cascades", async () => {
    await withChallengesSchema(APP, {}, async (schema) => {
      const h = stack(schema);
      const alice = await h.player("Alice");
      await h.player("Bob");
      await created(h, alice, "Bob");
      const accounts = schema.base.accounts();
      const deleted = sqlstateOf(
        sql`DELETE FROM users WHERE user_id = ${alice.userId}::uuid`.execute(accounts),
      );
      expect(await deleted).toBe("23001");
      const count = await sql<{
        count: string;
      }>`SELECT count(*)::text AS count FROM challenges`.execute(db(schema));
      expect(count.rows[0]?.count).toBe("1");
    });
  });
});

describe("TST-CHAL-DB repository", () => {
  it("TST-CHAL-DB-006 the application over PostgreSQL: create, read with joined usernames, list, decline, cancel", async () => {
    await withChallengesSchema(APP, {}, async (schema) => {
      const h = stack(schema);
      const alice = await h.player("Alice");
      const bob = await h.player("Bob");
      const outcome = await h.challenges.create(
        alice.session,
        createInput("bob", { seatPreference: "random" }),
      );
      if (!outcome.ok) throw new Error(outcome.error.kind);
      const view = outcome.value;
      const read = await h.challenges.get(bob.session, view.challengeId);
      expect(read).toEqual({ ok: true, value: { ...view, viewerRole: "challenged" } });
      const list = await h.challenges.list(bob.session, {
        direction: "incoming",
        cursor: null,
        limit: null,
      });
      expect(list.ok && list.value.challenges.map((item) => item.challengeId)).toEqual([
        view.challengeId,
      ]);
      h.accounts.clock.advance(1_234);
      const declined = await h.challenges.decline(bob.session, view.challengeId);
      expect(declined.ok && declined.value).toMatchObject({
        status: "declined",
        resolvedAt: view.createdAt + 1_234,
      });
      const again = await h.challenges.get(alice.session, view.challengeId);
      expect(again.ok && again.value.resolvedAt).toBe(view.createdAt + 1_234);
      const second = await created(h, bob, "Alice");
      const cancelled = await h.challenges.cancel(bob.session, second);
      expect(cancelled.ok && cancelled.value.status).toBe("cancelled");
      expect(h.defects.errors).toEqual([]);
    });
  });

  it("TST-CHAL-DB-007 concurrent creates for one pair, from both sides and two processes: exactly one is stored", async () => {
    await withChallengesSchema(APP, {}, async (schema) => {
      const h = stack(schema);
      const other = otherProcess(schema, h);
      const alice = await h.player("Alice");
      const bob = await h.player("Bob");
      const attempts = await Promise.all(
        Array.from({ length: 10 }, (_, index) =>
          index % 2 === 0
            ? h.challenges.create(alice.session, createInput("Bob"))
            : other.challenges.create(bob.session, createInput("Alice")),
        ),
      );
      expect(attempts.filter((attempt) => attempt.ok).length).toBe(1);
      for (const attempt of attempts) {
        if (!attempt.ok) expect(attempt.error.kind).toBe("challenge_already_pending");
      }
      const count = await sql<{
        count: string;
      }>`SELECT count(*)::text AS count FROM challenges`.execute(db(schema));
      expect(count.rows[0]?.count).toBe("1");
    });
  });

  it("TST-CHAL-DB-008 concurrent creates never exceed the outgoing cap", async () => {
    await withChallengesSchema(APP, {}, async (schema) => {
      const h = stack(schema);
      const other = otherProcess(schema, h);
      const alice = await h.player("Alice");
      for (let index = 0; index < 18; index += 1) {
        await h.player(`Opp${index}`);
        await created(h, alice, `Opp${index}`);
      }
      for (let index = 0; index < 6; index += 1) await h.player(`New${index}`);
      const attempts = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          (index % 2 === 0 ? h : other).challenges.create(
            alice.session,
            createInput(`New${index}`),
          ),
        ),
      );
      expect(attempts.filter((attempt) => attempt.ok).length).toBe(2);
      for (const attempt of attempts) {
        if (!attempt.ok) expect(attempt.error.kind).toBe("challenge_limit_reached");
      }
      const count = await sql<{ count: string }>`
        SELECT count(*)::text AS count FROM challenges WHERE status = 'pending'
      `.execute(db(schema));
      expect(count.rows[0]?.count).toBe("20");
    });
  });

  it("TST-CHAL-DB-009 decline against cancel from two processes: one linearized winner every time", async () => {
    await withChallengesSchema(APP, {}, async (schema) => {
      const h = stack(schema);
      const other = otherProcess(schema, h);
      const alice = await h.player("Alice");
      const bob = await h.player("Bob");
      for (let round = 0; round < 8; round += 1) {
        const challengeId = await created(h, alice, "Bob");
        const [declined, cancelled] = await Promise.all([
          h.challenges.decline(bob.session, challengeId),
          other.challenges.cancel(alice.session, challengeId),
        ]);
        expect([declined.ok, cancelled.ok].filter(Boolean).length).toBe(1);
        const loser = declined.ok ? cancelled : declined;
        expect(!loser.ok && loser.error.kind).toBe("challenge_not_pending");
        expect(await statusOf(db(schema), challengeId)).toBe(
          declined.ok ? "declined" : "cancelled",
        );
        h.accounts.clock.advance(1_000);
      }
    });
  });

  it("TST-CHAL-DB-010 the expiry boundary in PostgreSQL: one millisecond before acts, the deadline expires", async () => {
    await withChallengesSchema(APP, {}, async (schema) => {
      const h = stack(schema);
      const alice = await h.player("Alice");
      const bob = await h.player("Bob");
      await h.player("Carol");
      const early = await created(h, alice, "Bob");
      const late = await created(h, alice, "Carol");
      h.accounts.clock.advance(DAY - 1);
      const declined = await h.challenges.decline(bob.session, early);
      expect(declined.ok && declined.value.resolvedAt).toBe(WALL_START + DAY - 1);
      h.accounts.clock.advance(1);
      const refused = await h.challenges.cancel(alice.session, late);
      expect(!refused.ok && refused.error.kind).toBe("challenge_expired");
      const row = await sql<{ status: string; same: boolean }>`
        SELECT status, resolved_at = expires_at AS same FROM challenges WHERE challenge_id = ${late}
      `.execute(db(schema));
      expect(row.rows[0]).toEqual({ status: "expired", same: true });
    });
  });

  it("TST-CHAL-DB-011 decline against the expiry sweep at the deadline: expiry wins, the decline says so", async () => {
    await withChallengesSchema(APP, {}, async (schema) => {
      const h = stack(schema);
      const other = otherProcess(schema, h);
      const alice = await h.player("Alice");
      const bob = await h.player("Bob");
      const challengeId = await created(h, alice, "Bob");
      h.accounts.clock.advance(DAY);
      const [declined, swept] = await Promise.all([
        h.challenges.decline(bob.session, challengeId),
        other.challenges.expireOverdue(10),
      ]);
      expect(!declined.ok && declined.error.kind).toBe("challenge_expired");
      expect(swept).toBeLessThanOrEqual(1);
      expect(await statusOf(db(schema), challengeId)).toBe("expired");
    });
  });

  it("TST-CHAL-DB-012 a create after the pair's challenge expired marks the old row expired and keeps it", async () => {
    await withChallengesSchema(APP, {}, async (schema) => {
      const h = stack(schema);
      const alice = await h.player("Alice");
      const bob = await h.player("Bob");
      const old = await created(h, alice, "Bob");
      h.accounts.clock.advance(DAY);
      const fresh = await created(h, bob, "Alice");
      expect(await statusOf(db(schema), old)).toBe("expired");
      expect(await statusOf(db(schema), fresh)).toBe("pending");
    });
  });

  it("TST-CHAL-DB-013 keyset pages over PostgreSQL: newest first, ties broken by id, no repeats or gaps", async () => {
    await withChallengesSchema(APP, {}, async (schema) => {
      const h = stack(schema);
      const target = await h.player("Target");
      const expected: string[] = [];
      for (let index = 0; index < 7; index += 1) {
        const sender = await h.player(`Sender${index}`);
        if (index % 3 === 0) h.accounts.clock.advance(1_000);
        expected.push(await created(h, sender, "Target"));
      }
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 10; page += 1) {
        const result = await h.challenges.list(target.session, {
          direction: "incoming",
          cursor,
          limit: 3,
        });
        if (!result.ok) throw new Error(result.error.kind);
        seen.push(...result.value.challenges.map((item) => item.challengeId));
        cursor = result.value.nextCursor;
        if (cursor === null) break;
      }
      expect(seen.length).toBe(7);
      expect(new Set(seen)).toEqual(new Set(expected));
      const all = await h.challenges.list(target.session, {
        direction: "incoming",
        cursor: null,
        limit: 50,
      });
      expect(all.ok && all.value.challenges.map((item) => item.challengeId)).toEqual(seen);
    });
  });

  it("TST-CHAL-DB-014 a create that fails inside its transaction leaves nothing behind", async () => {
    await withChallengesSchema(APP, {}, async (schema) => {
      const h = stack(schema);
      const alice = await h.player("Alice");
      const bob = await h.player("Bob");
      const old = await created(h, alice, "Bob");
      h.accounts.clock.advance(DAY);
      const target = db(schema);
      const fn = sql.id(schema.name, "chess_one_it_fail_challenge_insert");
      await sql`create function ${fn}() returns trigger language plpgsql as $$ begin raise exception 'injected insert failure'; end $$`.execute(
        target,
      );
      await sql`create trigger chess_one_it_fail_challenge_insert before insert on challenges for each row execute function ${fn}()`.execute(
        target,
      );
      const refused = await h.challenges.create(bob.session, createInput("Alice"));
      expect(refused).toEqual({ ok: false, error: { kind: "temporarily_unavailable" } });
      expect(await statusOf(target, old)).toBe("pending");
      await sql`drop trigger chess_one_it_fail_challenge_insert on challenges`.execute(target);
      await sql`drop function ${fn}()`.execute(target);
      expect((await h.challenges.create(bob.session, createInput("Alice"))).ok).toBe(true);
      expect(await statusOf(target, old)).toBe("expired");
      expect(h.defects.errors).toEqual([]);
    });
  });

  it("TST-CHAL-DB-015 a corrupt row is refused as corrupt, naming the column, never its value", async () => {
    await withChallengesSchema(APP, {}, async (schema) => {
      const h = stack(schema);
      const alice = await h.player("Alice");
      const bob = await h.player("Bob");
      const challengeId = await insertRow(db(schema), alice.userId, bob.userId, {
        rulesetId: "OTHER-RULES-1",
      });
      const read = await h.challenges.get(bob.session, challengeId);
      expect(read).toEqual({ ok: false, error: { kind: "temporarily_unavailable" } });
      const [defect] = h.defects.errors;
      expect(defect).toBeInstanceOf(ChallengeStoreError);
      expect(defect instanceof ChallengeStoreError && [defect.kind, defect.detail]).toEqual([
        "corrupt",
        "challenges.ruleset_id",
      ]);
      expect(String(defect)).not.toContain("OTHER-RULES-1");
      const store = new PostgresChallengeStore(db(schema));
      const failure = await store.find(id(challengeId)).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ChallengeStoreError);
    });
  });

  it("TST-CHAL-DB-016 the sweep expires in bounded batches and never touches resolved or unexpired rows", async () => {
    await withChallengesSchema(APP, {}, async (schema) => {
      const h = stack(schema);
      const alice = await h.player("Alice");
      const bob = await h.player("Bob");
      for (let index = 0; index < 3; index += 1) {
        await h.player(`Opp${index}`);
        await created(h, alice, `Opp${index}`);
      }
      const declined = await created(h, bob, "Alice");
      await h.challenges.decline(alice.session, declined);
      h.accounts.clock.advance(DAY);
      await h.player("Late");
      const fresh = await created(h, alice, "Late");
      expect(await h.challenges.expireOverdue(2)).toBe(2);
      expect(await h.challenges.expireOverdue(10)).toBe(1);
      expect(await h.challenges.expireOverdue(10)).toBe(0);
      expect(await statusOf(db(schema), declined)).toBe("declined");
      expect(await statusOf(db(schema), fresh)).toBe("pending");
    });
  });
});

async function failingTrigger(
  target: Kysely<ChallengesDatabase>,
  schemaName: string,
  whenStatus: "accepting" | "accepted" | "accept_failed",
): Promise<() => Promise<void>> {
  const fn = sql.id(schemaName, "chess_one_it_fail_acceptance");
  await sql`create function ${fn}() returns trigger language plpgsql as $$ begin raise exception 'injected acceptance failure'; end $$`.execute(
    target,
  );
  await sql`create trigger chess_one_it_fail_acceptance before update on challenges for each row when (NEW.status = ${sql.lit(whenStatus)}) execute function ${fn}()`.execute(
    target,
  );
  return async () => {
    await sql`drop trigger chess_one_it_fail_acceptance on challenges`.execute(target);
    await sql`drop function ${fn}()`.execute(target);
  };
}

describe("TST-CHAL-DB acceptance (migration 002)", () => {
  it("TST-CHAL-DB-017 constraints: accepting is fully reserved and unresolved; accepted records exactly the reserved game", async () => {
    await withChallengesSchema(APP, {}, async (schema) => {
      const h = stack(schema);
      const alice = await h.player("Alice");
      const bob = await h.player("Bob");
      const carol = await h.player("Carol");
      const target = db(schema);
      const insert = (overrides: RowOverrides) =>
        insertRow(target, alice.userId, bob.userId, overrides);
      const at1 = WALL_START + 1_000;
      const refused: [string, RowOverrides, string][] = [
        ["accepting resolved", { status: "accepting", resolvedAt: at1 }, "23514"],
        ["accepting unreserved", { status: "accepting", reservation: null }, "23514"],
        ["accepting with a created game", { status: "accepting", gameId: "g-1" }, "23514"],
        [
          "deadline not ten minutes",
          { status: "accepting", reservation: { acceptedAt: at1, startDeadlineAt: at1 + 600_001 } },
          "23514",
        ],
        [
          "accepted at the challenge deadline",
          {
            status: "accepting",
            reservation: {
              acceptedAt: WALL_START + DAY,
              startDeadlineAt: WALL_START + DAY + 600_000,
            },
          },
          "23514",
        ],
        [
          "accepted before creation",
          {
            status: "accepting",
            reservation: { acceptedAt: WALL_START - 1, startDeadlineAt: WALL_START - 1 + 600_000 },
          },
          "23514",
        ],
        [
          "seats against the preference",
          { status: "accepting", reservation: { white: bob.userId, black: alice.userId } },
          "23514",
        ],
        [
          "a third user seated",
          { status: "accepting", reservation: { white: carol.userId } },
          "23514",
        ],
        [
          "accepted game is not the reserved one",
          {
            status: "accepted",
            resolvedAt: at1,
            gameId: "g-1",
            reservation: { acceptedAt: at1, intendedGameId: "g-2" },
          },
          "23514",
        ],
        [
          "accepted resolved at another time",
          {
            status: "accepted",
            resolvedAt: at1 + 1,
            gameId: "g-1",
            reservation: { acceptedAt: at1, startDeadlineAt: at1 + 600_000 },
          },
          "23514",
        ],
        [
          "declined with a reservation",
          { status: "declined", resolvedAt: at1, reservation: {} },
          "23514",
        ],
        ["pending with a reservation", { reservation: {} }, "23514"],
        [
          "intended game id format",
          { status: "accepting", reservation: { intendedGameId: "bad id" } },
          "23514",
        ],
      ];
      for (const [name, overrides, code] of refused) {
        expect(await sqlstateOf(insert(overrides)), name).toBe(code);
      }
      expect(
        await sqlstateOf(
          insert({
            status: "accepting",
            seat: "random",
            reservation: { intendedGameId: "g-random", white: bob.userId, black: alice.userId },
          }),
        ),
      ).toBe("no error");
      expect(
        await sqlstateOf(insert({ status: "accepted", resolvedAt: at1, gameId: "g-ok" })),
      ).toBe("no error");
      expect(
        await sqlstateOf(insert({ status: "accepting", reservation: { intendedGameId: "g-ok" } })),
      ).toBe("23505");
    });
  });

  it("TST-CHAL-DB-018 the guard: pending to accepting, accepting to accepted only, and the reservation never changes", async () => {
    await withChallengesSchema(APP, {}, async (schema) => {
      const h = stack(schema);
      const alice = await h.player("Alice");
      const bob = await h.player("Bob");
      const carol = await h.player("Carol");
      const target = db(schema);
      const accepting = await insertRow(target, alice.userId, bob.userId, {
        status: "accepting",
        reservation: { intendedGameId: "g-a" },
      });
      const pending = await insertRow(target, alice.userId, carol.userId);
      const reserve = sql`accepted_at = ${at(WALL_START + 1)}, intended_game_id = 'g-p',
        white_user_id = challenger_user_id, black_user_id = challenged_user_id,
        start_deadline_at = ${at(WALL_START + 1 + 600_000)}`;
      const leaving = ["declined", "cancelled", "expired", "pending"].map(
        (status): [string, RawBuilder<unknown>] => [
          `accepting to ${status}`,
          sql`UPDATE challenges SET status = ${status}, resolved_at = expires_at WHERE challenge_id = ${accepting}`,
        ],
      );
      const changes: [string, RawBuilder<unknown>][] = [
        [
          "pending straight to accepted",
          sql`UPDATE challenges SET status = 'accepted', resolved_at = ${at(WALL_START + 1)}, created_game_id = 'g-p', ${reserve} WHERE challenge_id = ${pending}`,
        ],
        ...leaving,
        [
          "intended game id",
          sql`UPDATE challenges SET intended_game_id = 'g-other' WHERE challenge_id = ${accepting}`,
        ],
        [
          "seats",
          sql`UPDATE challenges SET white_user_id = black_user_id, black_user_id = white_user_id, seat_preference = 'random' WHERE challenge_id = ${accepting}`,
        ],
        [
          "acceptance time",
          sql`UPDATE challenges SET accepted_at = accepted_at + interval '1 second', start_deadline_at = start_deadline_at + interval '1 second' WHERE challenge_id = ${accepting}`,
        ],
      ];
      for (const [name, change] of changes) {
        expect(await sqlstateOf(change.execute(target)), name).toBe("23000");
      }
      expect(
        await sqlstateOf(
          sql`UPDATE challenges SET status = 'accepted', created_game_id = intended_game_id, resolved_at = accepted_at WHERE challenge_id = ${accepting}`.execute(
            target,
          ),
        ),
      ).toBe("no error");
      expect(
        await sqlstateOf(
          sql`UPDATE challenges SET created_game_id = 'g-z', intended_game_id = 'g-z' WHERE challenge_id = ${accepting}`.execute(
            target,
          ),
        ),
      ).toBe("23000");
      expect(
        await sqlstateOf(
          sql`UPDATE challenges SET status = 'accepting', ${reserve} WHERE challenge_id = ${pending}`.execute(
            target,
          ),
        ),
      ).toBe("no error");
      expect(await statusOf(target, pending)).toBe("accepting");
    });
  });

  it("TST-CHAL-DB-019 accept over PostgreSQL: reserved once, the random seats persisted once, accepted with the reserved game; retries change nothing", async () => {
    await withChallengesSchema(APP, {}, async (schema) => {
      const h = stack(schema);
      const alice = await h.player("Alice");
      const bob = await h.player("Bob");
      const outcome = await h.challenges.create(
        alice.session,
        createInput("Bob", { seatPreference: "random" }),
      );
      if (!outcome.ok) throw new Error(outcome.error.kind);
      const { challengeId, createdAt } = outcome.value;
      h.accounts.clock.advance(5_000);
      const first = await h.challenges.accept(bob.session, challengeId);
      if (!first.ok || first.value.game === null) throw new Error("not accepted");
      const { game } = first.value;
      const row = await acceptanceRow(db(schema), challengeId);
      expect(row).toMatchObject({
        status: "accepted",
        intended_game_id: game.gameId,
        created_game_id: game.gameId,
        accepted_ms: String(createdAt + 5_000),
        resolved_ms: String(createdAt + 5_000),
        deadline_ms: String(createdAt + 5_000 + 600_000),
      });
      expect(new Set([row?.white_user_id, row?.black_user_id])).toEqual(
        new Set([alice.userId, bob.userId]),
      );
      expect(game).toMatchObject({
        viewerSeat: row?.white_user_id === bob.userId ? "white" : "black",
        lifecycle: "awaiting_players",
        startDeadlineAt: createdAt + 5_000 + 600_000,
      });
      h.accounts.clock.advance(60_000);
      const again = await h.challenges.accept(bob.session, challengeId);
      expect(again.ok && again.value.game?.gameId).toBe(game.gameId);
      expect(await acceptanceRow(db(schema), challengeId)).toEqual(row);
      const games = gamesOf(h);
      expect([...games.games.values()]).toEqual([
        expect.objectContaining({
          gameId: game.gameId,
          white: row?.white_user_id,
          black: row?.black_user_id,
          startDeadlineAt: createdAt + 5_000 + 600_000,
        }),
      ]);
      const read = await h.challenges.get(alice.session, challengeId);
      expect(read.ok && read.value).toMatchObject({
        status: "accepted",
        createdGameId: game.gameId,
        viewerSeat: game.viewerSeat === "white" ? "black" : "white",
      });
      const declined = await h.challenges.decline(bob.session, challengeId);
      const cancelled = await h.challenges.cancel(alice.session, challengeId);
      expect([!declined.ok && declined.error.kind, !cancelled.ok && cancelled.error.kind]).toEqual([
        "challenge_not_pending",
        "challenge_not_pending",
      ]);
      expect(await acceptanceRow(db(schema), challengeId)).toEqual(row);
      expect(h.defects.errors).toEqual([]);
    });
  });

  it("TST-CHAL-DB-020 five concurrent accepts from two processes: one reservation, one game id, one game, one accepted challenge", async () => {
    await withChallengesSchema(APP, {}, async (schema) => {
      const h = stack(schema);
      const other = otherProcess(schema, h);
      const alice = await h.player("Alice");
      const bob = await h.player("Bob");
      for (let round = 0; round < 3; round += 1) {
        const challengeId = await created(h, alice, "Bob");
        const results = await Promise.all(
          Array.from({ length: 5 }, (_, index) =>
            (index % 2 === 0 ? h : other).challenges.accept(bob.session, challengeId),
          ),
        );
        const ids = new Set(
          results.map((result) =>
            result.ok ? (result.value.game?.gameId ?? "processing") : "error",
          ),
        );
        const row = await acceptanceRow(db(schema), challengeId);
        expect([...ids]).toEqual([row?.created_game_id]);
        expect(row).toMatchObject({ status: "accepted", intended_game_id: row?.created_game_id });
        expect(gamesOf(h).games.size).toBe(round + 1);
        const reserved =
          h.facts.named("challenge_accept_reserved").length +
          other.facts.named("challenge_accept_reserved").length;
        expect(reserved).toBe(round + 1);
        h.accounts.clock.advance(1_000);
      }
      expect([...h.defects.errors, ...other.defects.errors]).toEqual([]);
    });
  });

  it("TST-CHAL-DB-021 accept against cancel and against decline from two processes: one winner, never a cancelled or declined challenge with a game", async () => {
    await withChallengesSchema(APP, {}, async (schema) => {
      const h = stack(schema);
      const other = otherProcess(schema, h);
      const alice = await h.player("Alice");
      const bob = await h.player("Bob");
      let accepts = 0;
      for (let round = 0; round < 8; round += 1) {
        const challengeId = await created(h, alice, "Bob");
        const [accept, rival] = await Promise.all([
          h.challenges.accept(bob.session, challengeId),
          round % 2 === 0
            ? other.challenges.cancel(alice.session, challengeId)
            : other.challenges.decline(bob.session, challengeId),
        ]);
        expect([accept.ok, rival.ok].filter(Boolean).length, `round ${round}`).toBe(1);
        const row = await acceptanceRow(db(schema), challengeId);
        if (accept.ok) {
          accepts += 1;
          expect(!rival.ok && rival.error.kind).toBe("challenge_not_pending");
          expect(row?.status).toBe("accepted");
          expect(row?.created_game_id).toBe(accept.value.game?.gameId);
        } else {
          expect(accept.error.kind).toBe("challenge_not_pending");
          expect(row).toMatchObject({
            status: round % 2 === 0 ? "cancelled" : "declined",
            intended_game_id: null,
            created_game_id: null,
            white_user_id: null,
          });
        }
        expect(gamesOf(h).games.size).toBe(accepts);
        h.accounts.clock.advance(1_000);
      }
    });
  });

  it("TST-CHAL-DB-022 accept against expiry: one millisecond before reserves, the deadline expires with no game id; the sweep racing an accept at the deadline wins", async () => {
    await withChallengesSchema(APP, {}, async (schema) => {
      const h = stack(schema);
      const other = otherProcess(schema, h);
      const alice = await h.player("Alice");
      const bob = await h.player("Bob");
      const carol = await h.player("Carol");
      const early = await created(h, alice, "Bob");
      const late = await created(h, alice, "Carol");
      h.accounts.clock.advance(DAY - 1);
      const accepted = await h.challenges.accept(bob.session, early);
      expect(accepted.ok && accepted.value.challenge.status).toBe("accepted");
      expect((await acceptanceRow(db(schema), early))?.accepted_ms).toBe(
        String(WALL_START + DAY - 1),
      );
      h.accounts.clock.advance(1);
      const refused = await h.challenges.accept(carol.session, late);
      expect(!refused.ok && refused.error.kind).toBe("challenge_expired");
      expect(await acceptanceRow(db(schema), late)).toMatchObject({
        status: "expired",
        intended_game_id: null,
        accepted_ms: null,
      });
      const raced = await created(h, bob, "Carol");
      h.accounts.clock.advance(DAY);
      const [racing] = await Promise.all([
        h.challenges.accept(carol.session, raced),
        other.challenges.expireOverdue(10),
      ]);
      expect(!racing.ok && racing.error.kind).toBe("challenge_expired");
      expect(await acceptanceRow(db(schema), raced)).toMatchObject({
        status: "expired",
        intended_game_id: null,
      });
      expect(gamesOf(h).games.size).toBe(1);
    });
  });

  it("TST-CHAL-DB-023 failure injection A: the game is stored but completing the challenge fails; reconciliation finds the same game and accepts, with no second game", async () => {
    await withChallengesSchema(APP, {}, async (schema) => {
      const h = stack(schema);
      const alice = await h.player("Alice");
      const bob = await h.player("Bob");
      const challengeId = await created(h, alice, "Bob");
      const target = db(schema);
      const restore = await failingTrigger(target, schema.name, "accepted");
      const first = await h.challenges.accept(bob.session, challengeId);
      expect(first.ok && first.value.game).toBeNull();
      expect(first.ok && first.value.challenge.status).toBe("processing");
      const reserved = await acceptanceRow(target, challengeId);
      expect(reserved).toMatchObject({ status: "accepting", created_game_id: null });
      const games = gamesOf(h);
      expect([...games.games.keys()]).toEqual([reserved?.intended_game_id]);
      expect(h.facts.named("challenge_accept_processing").map((fact) => fact.cause)).toEqual([
        "completion_failed",
      ]);
      expect(await h.challenges.reconcileAcceptingChallenge(challengeId)).toBe("processing");
      await restore();
      expect(await h.challenges.reconcileAcceptingChallenge(challengeId)).toBe("accepted");
      expect(await acceptanceRow(target, challengeId)).toMatchObject({
        status: "accepted",
        created_game_id: reserved?.intended_game_id,
      });
      expect(games.games.size).toBe(1);
      expect(games.creates).toBe(1);
      expect(h.facts.named("challenge_accepted").map((fact) => fact.via)).toEqual(["reconcile"]);
      const retry = await h.challenges.accept(bob.session, challengeId);
      expect(retry.ok && retry.value.game?.gameId).toBe(reserved?.intended_game_id);
      expect(await h.challenges.reconcileAcceptingChallenge(challengeId)).toBe("accepted");
    });
  });

  it("TST-CHAL-DB-024 failure injection B: an uncertain creation leaves the challenge accepting; retries use the same intended game id and never duplicate", async () => {
    await withChallengesSchema(APP, {}, async (schema) => {
      const h = stack(schema);
      const other = otherProcess(schema, h);
      const alice = await h.player("Alice");
      const bob = await h.player("Bob");
      const carol = await h.player("Carol");
      const games = gamesOf(h);
      const target = db(schema);

      const stored = await created(h, alice, "Bob");
      games.createFaults.push("stored_unconfirmed");
      games.checkFaults.push("unknown");
      const first = await h.challenges.accept(bob.session, stored);
      expect(first.ok && first.value.game).toBeNull();
      const intended = (await acceptanceRow(target, stored))?.intended_game_id;
      const retry = await other.challenges.accept(bob.session, stored);
      expect(retry.ok && retry.value.game?.gameId).toBe(intended);
      expect(games.creates).toBe(1);

      const lost = await created(h, alice, "Carol");
      games.createFaults.push("lost");
      const pending = await h.challenges.accept(carol.session, lost);
      expect(pending.ok && pending.value.game).toBeNull();
      const lostId = (await acceptanceRow(target, lost))?.intended_game_id;
      expect([...games.games.keys()]).not.toContain(lostId);
      expect(await other.challenges.reconcileAcceptingChallenge(lost)).toBe("accepted");
      expect(await acceptanceRow(target, lost)).toMatchObject({
        status: "accepted",
        created_game_id: lostId,
      });
      expect(games.games.size).toBe(2);
      expect(games.creates).toBe(3);
      expect(h.facts.named("challenge_accept_processing").map((fact) => fact.cause)).toEqual([
        "creation_unconfirmed",
        "game_absent",
      ]);
    });
  });

  it("TST-CHAL-DB-025 failure injection C: the database fails the reservation; no accepted answer, nothing reserved, no game", async () => {
    await withChallengesSchema(APP, {}, async (schema) => {
      const h = stack(schema);
      const alice = await h.player("Alice");
      const bob = await h.player("Bob");
      const challengeId = await created(h, alice, "Bob");
      const target = db(schema);
      const restore = await failingTrigger(target, schema.name, "accepting");
      const refused = await h.challenges.accept(bob.session, challengeId);
      expect(refused).toEqual({ ok: false, error: { kind: "temporarily_unavailable" } });
      expect(await acceptanceRow(target, challengeId)).toMatchObject({
        status: "pending",
        intended_game_id: null,
      });
      expect(gamesOf(h).creates).toBe(0);
      await restore();
      const accepted = await h.challenges.accept(bob.session, challengeId);
      expect(accepted.ok && accepted.value.challenge.status).toBe("accepted");
    });
  });
});

function userIdOf(player: Player): UserId {
  if (!isUserId(player.userId)) throw new Error("user id expected");
  return player.userId;
}

/** Bob accepts Alice's challenge while the game's creation is lost: accepting, the game surely absent. */
async function stuckAccepting(
  h: ChallengeHarness,
  target: Kysely<ChallengesDatabase>,
  from: Player,
  to: Player,
): Promise<{ readonly challengeId: ChallengeId; readonly row: StoredAcceptance }> {
  const challengeId = await created(h, from, to.username);
  gamesOf(h).createFaults.push("lost");
  const first = await h.challenges.accept(to.session, challengeId);
  expect(first.ok && first.value.game).toBeNull();
  const row = await acceptanceRow(target, challengeId);
  if (row?.status !== "accepting") throw new Error("accepting expected");
  return { challengeId, row };
}

describe("TST-CHAL-DB acceptance failure (migration 003)", () => {
  it("TST-CHAL-DB-026 constraints: accept_failed keeps the whole reservation, has no game, and resolves at or after the acceptance, even past the challenge deadline", async () => {
    await withChallengesSchema(APP, {}, async (schema) => {
      const h = stack(schema);
      const alice = await h.player("Alice");
      const bob = await h.player("Bob");
      const target = db(schema);
      const insert = (overrides: RowOverrides) =>
        insertRow(target, alice.userId, bob.userId, overrides);
      const at1 = WALL_START + 1_000;
      const reservation = { acceptedAt: at1, startDeadlineAt: at1 + 600_000 };
      const refused: [string, RowOverrides][] = [
        ["unresolved", { status: "accept_failed", reservation }],
        [
          "resolved before the acceptance",
          { status: "accept_failed", resolvedAt: at1 - 1, reservation },
        ],
        ["unreserved", { status: "accept_failed", resolvedAt: at1, reservation: null }],
        [
          "with a created game",
          {
            status: "accept_failed",
            resolvedAt: at1,
            gameId: "g-failed",
            reservation: { ...reservation, intendedGameId: "g-failed" },
          },
        ],
      ];
      for (const [name, overrides] of refused) {
        expect(await sqlstateOf(insert(overrides)), name).toBe("23514");
      }
      for (const [name, resolvedAt, gameId] of [
        ["at the acceptance", at1, "g-a"],
        ["later", at1 + 5_000, "g-b"],
        ["past the challenge deadline", WALL_START + 3 * DAY, "g-c"],
      ] satisfies [string, number, string][]) {
        expect(
          await sqlstateOf(
            insert({
              status: "accept_failed",
              resolvedAt,
              reservation: { ...reservation, intendedGameId: gameId },
            }),
          ),
          name,
        ).toBe("no error");
      }
      expect(
        await sqlstateOf(
          insert({
            status: "accepting",
            reservation: { ...reservation, intendedGameId: "g-a" },
          }),
        ),
      ).toBe("23505");
    });
  });

  it("TST-CHAL-DB-027 the guard: only accepting fails, the reservation stays fixed, and accept_failed is history", async () => {
    await withChallengesSchema(APP, {}, async (schema) => {
      const h = stack(schema);
      const alice = await h.player("Alice");
      const bob = await h.player("Bob");
      const carol = await h.player("Carol");
      const target = db(schema);
      const accepting = await insertRow(target, alice.userId, bob.userId, {
        status: "accepting",
        reservation: { intendedGameId: "g-a" },
      });
      const pending = await insertRow(target, alice.userId, carol.userId);
      const accepted = await insertRow(target, bob.userId, carol.userId, {
        status: "accepted",
        resolvedAt: WALL_START + 1,
        gameId: "g-done",
      });
      const fail = (id: string) =>
        sql`UPDATE challenges SET status = 'accept_failed', resolved_at = accepted_at + interval '1 second' WHERE challenge_id = ${id}`;
      const refused: [string, RawBuilder<unknown>][] = [
        [
          "pending straight to accept_failed",
          sql`UPDATE challenges SET status = 'accept_failed', resolved_at = ${at(WALL_START + 2)},
            accepted_at = ${at(WALL_START + 1)}, intended_game_id = 'g-p',
            white_user_id = challenger_user_id, black_user_id = challenged_user_id,
            start_deadline_at = ${at(WALL_START + 1 + 600_000)} WHERE challenge_id = ${pending}`,
        ],
        ["accepted to accept_failed", fail(accepted)],
        [
          "failing with another game id",
          sql`UPDATE challenges SET status = 'accept_failed', resolved_at = accepted_at, intended_game_id = 'g-other' WHERE challenge_id = ${accepting}`,
        ],
      ];
      for (const [name, change] of refused) {
        expect(await sqlstateOf(change.execute(target)), name).toBe("23000");
      }
      expect(await sqlstateOf(fail(accepting).execute(target))).toBe("no error");
      const failedRow = await acceptanceRow(target, accepting);
      expect(failedRow).toMatchObject({
        status: "accept_failed",
        intended_game_id: "g-a",
        created_game_id: null,
      });
      const afterwards: [string, RawBuilder<unknown>][] = [
        [
          "back to accepting",
          sql`UPDATE challenges SET status = 'accepting', resolved_at = NULL WHERE challenge_id = ${accepting}`,
        ],
        [
          "on to accepted",
          sql`UPDATE challenges SET status = 'accepted', resolved_at = accepted_at, created_game_id = intended_game_id WHERE challenge_id = ${accepting}`,
        ],
        [
          "back to pending",
          sql`UPDATE challenges SET status = 'pending', resolved_at = NULL, accepted_at = NULL, intended_game_id = NULL, white_user_id = NULL, black_user_id = NULL, start_deadline_at = NULL WHERE challenge_id = ${accepting}`,
        ],
        [
          "another resolution time",
          sql`UPDATE challenges SET resolved_at = resolved_at + interval '1 second' WHERE challenge_id = ${accepting}`,
        ],
        [
          "the reservation",
          sql`UPDATE challenges SET white_user_id = black_user_id, black_user_id = white_user_id WHERE challenge_id = ${accepting}`,
        ],
      ];
      for (const [name, change] of afterwards) {
        expect(await sqlstateOf(change.execute(target)), name).toBe("23000");
      }
      expect(await acceptanceRow(target, accepting)).toEqual(failedRow);
    });
  });

  it("TST-CHAL-DB-028 race C over PostgreSQL: a participant disabled before the game exists; another process fails the acceptance once, keeps the reservation, and creates nothing", async () => {
    await withChallengesSchema(APP, {}, async (schema) => {
      const h = stack(schema);
      const other = otherProcess(schema, h);
      const alice = await h.player("Alice");
      const bob = await h.player("Bob");
      const target = db(schema);
      const { challengeId, row } = await stuckAccepting(h, target, alice, bob);
      h.accounts.clock.advance(45_000);
      await h.accounts.accounts.setAccountStatus(userIdOf(alice), "disabled");
      expect(await other.challenges.reconcileAcceptingChallenge(challengeId)).toBe("accept_failed");
      const failed = await acceptanceRow(target, challengeId);
      expect(failed).toEqual({
        ...row,
        status: "accept_failed",
        resolved_ms: String(h.accounts.clock.now()),
      });
      const retry = await h.challenges.accept(bob.session, challengeId);
      expect(retry).toEqual({ ok: false, error: { kind: "challenge_accept_failed" } });
      expect(await h.challenges.reconcileAcceptingChallenges(10)).toMatchObject({ examined: 0 });
      expect(await acceptanceRow(target, challengeId)).toEqual(failed);
      const games = gamesOf(h);
      expect([games.games.size, games.creates]).toEqual([0, 1]);
      expect(other.facts.named("challenge_accept_failed")).toEqual([
        { name: "challenge_accept_failed", challengeId, reason: "participant_unavailable" },
      ]);
      expect([...h.defects.errors, ...other.defects.errors]).toEqual([]);
    });
  });

  it("TST-CHAL-DB-029 races A and B over two processes: accept retries and maintenance passes settle once, to one game or one failure", async () => {
    await withChallengesSchema(APP, {}, async (schema) => {
      const h = stack(schema);
      const other = otherProcess(schema, h);
      const alice = await h.player("Alice");
      const bob = await h.player("Bob");
      const carol = await h.player("Carol");
      const target = db(schema);
      const games = gamesOf(h);
      const facts = (name: "challenge_accepted" | "challenge_accept_failed") =>
        h.facts.count(name) + other.facts.count(name);

      const accepting = await stuckAccepting(h, target, alice, bob);
      const [first, swept, reconciled, second, sweptAgain] = await Promise.all([
        h.challenges.accept(bob.session, accepting.challengeId),
        other.challenges.reconcileAcceptingChallenges(10),
        h.challenges.reconcileAcceptingChallenge(accepting.challengeId),
        other.challenges.accept(bob.session, accepting.challengeId),
        h.challenges.reconcileAcceptingChallenges(10),
      ]);
      const intended = accepting.row.intended_game_id;
      for (const outcome of [first, second]) {
        expect(outcome.ok && outcome.value.game?.gameId).toBe(intended);
      }
      expect(reconciled).toBe("accepted");
      expect([swept.failed, sweptAgain.failed]).toEqual([0, 0]);
      expect(await acceptanceRow(target, accepting.challengeId)).toMatchObject({
        status: "accepted",
        created_game_id: intended,
      });
      expect([...games.games.keys()]).toEqual([intended]);
      expect(facts("challenge_accepted")).toBe(1);

      h.accounts.clock.advance(1_000);
      const failing = await stuckAccepting(h, target, alice, carol);
      await h.accounts.accounts.setAccountStatus(userIdOf(carol), "locked");
      const outcomes = await Promise.all([
        h.challenges.reconcileAcceptingChallenge(failing.challengeId),
        other.challenges.reconcileAcceptingChallenge(failing.challengeId),
        other.challenges.reconcileAcceptingChallenges(10),
        h.challenges.reconcileAcceptingChallenges(10),
      ]);
      expect([outcomes[0], outcomes[1]]).toEqual(["accept_failed", "accept_failed"]);
      expect(await acceptanceRow(target, failing.challengeId)).toMatchObject({
        status: "accept_failed",
        intended_game_id: failing.row.intended_game_id,
        created_game_id: null,
      });
      expect(facts("challenge_accept_failed")).toBe(1);
      expect(games.games.size).toBe(1);
      expect([...h.defects.errors, ...other.defects.errors]).toEqual([]);
    });
  });

  it("TST-CHAL-DB-030 races E, F, G, and H over PostgreSQL: a proven game accepts, an absent one is recreated under the same id, an unknown one waits, a foreign one fails closed", async () => {
    await withChallengesSchema(APP, {}, async (schema) => {
      const h = stack(schema);
      const other = otherProcess(schema, h);
      const alice = await h.player("Alice");
      const author = await h.player("Author");
      const bob = await h.player("Bob");
      const carol = await h.player("Carol");
      const dave = await h.player("Dave");
      const erin = await h.player("Erin");
      const target = db(schema);
      const games = gamesOf(h);

      const proven = await created(h, alice, "Erin");
      const restore = await failingTrigger(target, schema.name, "accepted");
      const first = await h.challenges.accept(erin.session, proven);
      expect(first.ok && first.value.game).toBeNull();
      await restore();
      await h.accounts.accounts.setAccountStatus(userIdOf(alice), "locked");
      expect(await other.challenges.reconcileAcceptingChallenge(proven)).toBe("accepted");
      const provenRow = await acceptanceRow(target, proven);
      expect(provenRow).toMatchObject({
        status: "accepted",
        created_game_id: provenRow?.intended_game_id,
      });
      expect(games.creates).toBe(1);

      const absent = await stuckAccepting(h, target, author, bob);
      expect(await other.challenges.reconcileAcceptingChallenge(absent.challengeId)).toBe(
        "accepted",
      );
      expect(await acceptanceRow(target, absent.challengeId)).toEqual({
        ...absent.row,
        status: "accepted",
        created_game_id: absent.row.intended_game_id,
        resolved_ms: absent.row.accepted_ms,
      });
      const recreated = [...games.games.values()].find(
        (spec) => spec.gameId === absent.row.intended_game_id,
      );
      expect(recreated).toMatchObject({
        white: absent.row.white_user_id,
        black: absent.row.black_user_id,
        startDeadlineAt: Number(absent.row.deadline_ms),
      });

      const unknown = await stuckAccepting(h, target, author, carol);
      h.accounts.clock.advance(30 * DAY);
      games.checkFaults.push("unknown", "unknown");
      expect(await other.challenges.reconcileAcceptingChallenge(unknown.challengeId)).toBe(
        "processing",
      );
      expect(await other.challenges.reconcileAcceptingChallenges(10)).toMatchObject({
        examined: 1,
        processing: 1,
      });
      expect(await acceptanceRow(target, unknown.challengeId)).toEqual(unknown.row);

      const foreign = await stuckAccepting(h, target, author, dave);
      const foreignId = foreign.row.intended_game_id;
      if (foreignId === null || !isGameReference(foreignId)) throw new Error("game id expected");
      const before = games.creates;
      games.games.set(foreignId, {
        gameId: foreignId,
        white: userIdOf(dave),
        black: userIdOf(author),
        rulesetId: DEFAULT_CHALLENGE_RULESET_ID,
        timeControl: { type: "sudden_death", initialMs: 60_000, incrementMs: 0 },
        startDeadlineAt: Number(foreign.row.deadline_ms),
      });
      expect(await other.challenges.reconcileAcceptingChallenge(foreign.challengeId)).toBe(
        "accept_failed",
      );
      expect(await acceptanceRow(target, foreign.challengeId)).toMatchObject({
        status: "accept_failed",
        intended_game_id: foreignId,
        created_game_id: null,
      });
      expect(games.creates).toBe(before);
      expect(other.defects.errors).toHaveLength(1);
      expect(other.facts.named("challenge_accept_failed").map((fact) => fact.reason)).toEqual([
        "game_mismatch",
      ]);
      expect(h.defects.errors).toEqual([]);
    });
  });

  it("TST-CHAL-DB-031 failure injection: the failure's final write fails, and the challenge table is unreadable during reconciliation; nothing changes until the next attempt", async () => {
    await withChallengesSchema(APP, {}, async (schema) => {
      const h = stack(schema);
      const alice = await h.player("Alice");
      const bob = await h.player("Bob");
      const carol = await h.player("Carol");
      const target = db(schema);

      const failing = await stuckAccepting(h, target, alice, bob);
      await h.accounts.accounts.setAccountStatus(userIdOf(bob), "disabled");
      const restore = await failingTrigger(target, schema.name, "accept_failed");
      expect(await h.challenges.reconcileAcceptingChallenge(failing.challengeId)).toBe(
        "processing",
      );
      expect(h.facts.named("challenge_accept_processing").at(-1)?.cause).toBe("completion_failed");
      expect(await acceptanceRow(target, failing.challengeId)).toEqual(failing.row);
      await restore();
      expect(await h.challenges.reconcileAcceptingChallenge(failing.challengeId)).toBe(
        "accept_failed",
      );

      const waiting = await stuckAccepting(h, target, alice, carol);
      await sql`ALTER TABLE challenges RENAME TO challenges_hidden`.execute(target);
      try {
        expect(await h.challenges.reconcileAcceptingChallenges(10)).toMatchObject({
          listed: false,
          examined: 0,
          next: null,
        });
        expect(await h.challenges.reconcileAcceptingChallenge(waiting.challengeId)).toBe(
          "unavailable",
        );
      } finally {
        await sql`ALTER TABLE challenges_hidden RENAME TO challenges`.execute(target);
      }
      expect(
        h.facts
          .named("challenge_accept_reconcile_unavailable")
          .filter((fact) => fact.cause === "store_unavailable")
          .map((fact) => fact.challengeId),
      ).toEqual([null, waiting.challengeId]);
      expect(await acceptanceRow(target, waiting.challengeId)).toEqual(waiting.row);
      expect(await h.challenges.reconcileAcceptingChallenges(10)).toMatchObject({
        listed: true,
        examined: 1,
        accepted: 1,
      });
      expect(gamesOf(h).games.size).toBe(1);
      expect(h.defects.errors).toEqual([]);
    });
  });

  it("TST-CHAL-DB-032 listAccepting: accepting rows only, oldest reservation first with ties by id, resumed strictly after the cursor", async () => {
    await withChallengesSchema(APP, {}, async (schema) => {
      const h = stack(schema);
      const alice = await h.player("Alice");
      const bob = await h.player("Bob");
      const target = db(schema);
      const store = new PostgresChallengeStore(target);
      const rows: [string, number, string][] = [
        ["AAAAAAAAAAAAAAAAAAAAA3", WALL_START + 3_000, "g-3"],
        ["AAAAAAAAAAAAAAAAAAAAA1", WALL_START + 1_000, "g-1"],
        ["AAAAAAAAAAAAAAAAAAAAA5", WALL_START + 2_000, "g-5"],
        ["AAAAAAAAAAAAAAAAAAAAA4", WALL_START + 2_000, "g-4"],
      ];
      for (const [challengeId, acceptedAt, intendedGameId] of rows) {
        await insertRow(target, alice.userId, bob.userId, {
          challengeId,
          status: "accepting",
          reservation: { acceptedAt, intendedGameId },
        });
      }
      await insertRow(target, alice.userId, bob.userId, {
        status: "accept_failed",
        resolvedAt: WALL_START + 9_000,
        reservation: { acceptedAt: WALL_START, intendedGameId: "g-failed" },
      });
      await insertRow(target, alice.userId, bob.userId, {
        status: "accepted",
        resolvedAt: WALL_START + 500,
        gameId: "g-accepted",
      });
      const idsOf = (listings: readonly { challenge: { challengeId: string } }[]) =>
        listings.map((listing) => listing.challenge.challengeId);
      const first = await store.listAccepting({ after: null, limit: 2 });
      expect(idsOf(first)).toEqual(["AAAAAAAAAAAAAAAAAAAAA1", "AAAAAAAAAAAAAAAAAAAAA4"]);
      const second = await store.listAccepting({
        after: { acceptedAt: WALL_START + 2_000, challengeId: id("AAAAAAAAAAAAAAAAAAAAA4") },
        limit: 2,
      });
      expect(idsOf(second)).toEqual(["AAAAAAAAAAAAAAAAAAAAA5", "AAAAAAAAAAAAAAAAAAAAA3"]);
      expect(
        await store.listAccepting({
          after: { acceptedAt: WALL_START + 3_000, challengeId: id("AAAAAAAAAAAAAAAAAAAAA3") },
          limit: 2,
        }),
      ).toEqual([]);
      expect(idsOf(await store.listAccepting({ after: null, limit: 10 }))).toHaveLength(4);
      expect(() => store.listAccepting({ after: null, limit: 0 })).toThrow(RangeError);
    });
  });
});
