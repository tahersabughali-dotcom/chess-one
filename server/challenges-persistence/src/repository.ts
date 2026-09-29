import {
  type AcceptanceReservation,
  type Challenge,
  type ChallengeId,
  challengeInvariantViolation,
  type GameReference,
  isChallengeId,
  isChallengeStatus,
  isGameReference,
  isSeatPreference,
  parseChallengeRuleset,
  parseTimeControlRequest,
} from "@chess-one/challenge-domain";
import {
  type AcceptingQuery,
  type ChallengeListing,
  type ChallengeStore,
  ChallengeStoreError,
  type CreateChallengeOutcome,
  type PendingCaps,
  type PendingQuery,
} from "@chess-one/challenges";
import { isUserId, type UserId } from "@chess-one/identity";
import { type Kysely, type RawBuilder, sql } from "kysely";
import type { ChallengesDatabase } from "./schema.ts";

/** A value the database returned that the adapter cannot trust. */
class MalformedRow extends Error {
  readonly column: string;

  constructor(column: string) {
    super(`malformed ${column}`);
    this.column = column;
  }
}

function sqlState(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  const { code } = error;
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : null;
}

/**
 * Every store call: a malformed row becomes `corrupt` (naming the column),
 * any driver failure `unavailable` (with its SQLSTATE); never a driver
 * message, SQL text, or stored value.
 */
async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error: unknown) {
    if (error instanceof ChallengeStoreError) throw error;
    if (error instanceof MalformedRow) throw new ChallengeStoreError("corrupt", error.column);
    throw new ChallengeStoreError("unavailable", sqlState(error));
  }
}

/** Wall-clock epoch milliseconds as an exact `timestamptz` expression; no driver `Date`. */
function wallTime(epochMs: number): RawBuilder<unknown> {
  if (!Number.isSafeInteger(epochMs) || epochMs < 0) {
    throw new RangeError("Wall time must be non-negative integer milliseconds");
  }
  return sql`(timestamptz 'epoch' + ${String(epochMs)}::bigint * interval '1 millisecond')`;
}

/** Epoch milliseconds of a `timestamptz` column, as exact text. */
function epochMsOf(column: string): RawBuilder<unknown> {
  return sql`(extract(epoch from ${sql.ref(column)}) * 1000)::bigint::text`;
}

/**
 * Serialises every create involving one user: the pending caps are counted
 * under it, so two concurrent creates can never both pass a cap.
 */
const LOCK_NAMESPACE = "chess-one.challenges.user:";

interface ListingRow {
  readonly challenge_id: string;
  readonly challenger_user_id: string;
  readonly challenged_user_id: string;
  readonly status: string;
  readonly ruleset_id: string;
  readonly time_control_type: string;
  readonly initial_time_ms: number;
  readonly increment_ms: number;
  readonly seat_preference: string;
  readonly created_at_ms: string;
  readonly expires_at_ms: string;
  readonly resolved_at_ms: string | null;
  readonly created_game_id: string | null;
  readonly accepted_at_ms: string | null;
  readonly intended_game_id: string | null;
  readonly white_user_id: string | null;
  readonly black_user_id: string | null;
  readonly start_deadline_at_ms: string | null;
  readonly challenger_username: string;
  readonly challenged_username: string;
}

function integerOf(value: string, column: string): number {
  const ms = /^(0|[1-9][0-9]{0,15})$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(ms)) throw new MalformedRow(column);
  return ms;
}

function userIdOf(value: string, column: string): UserId {
  if (!isUserId(value)) throw new MalformedRow(column);
  return value;
}

function challengeIdOf(value: string): ChallengeId {
  if (!isChallengeId(value)) throw new MalformedRow("challenges.challenge_id");
  return value;
}

function gameReferenceOf(value: string | null, column: string): GameReference | null {
  if (value === null) return null;
  if (!isGameReference(value)) throw new MalformedRow(column);
  return value;
}

/** The reservation columns: all set or all null, or the row is corrupt. */
function acceptanceOf(row: ListingRow): AcceptanceReservation | null {
  const acceptedAt = row.accepted_at_ms;
  const gameId = gameReferenceOf(row.intended_game_id, "challenges.intended_game_id");
  const white = row.white_user_id;
  const black = row.black_user_id;
  const deadline = row.start_deadline_at_ms;
  if (acceptedAt === null && gameId === null && white === null && black === null) {
    if (deadline !== null) throw new MalformedRow("challenges.acceptance");
    return null;
  }
  if (acceptedAt === null || gameId === null || white === null || black === null) {
    throw new MalformedRow("challenges.acceptance");
  }
  if (deadline === null) throw new MalformedRow("challenges.acceptance");
  return Object.freeze({
    acceptedAt: integerOf(acceptedAt, "challenges.accepted_at"),
    gameId,
    white: userIdOf(white, "challenges.white_user_id"),
    black: userIdOf(black, "challenges.black_user_id"),
    startDeadlineAt: integerOf(deadline, "challenges.start_deadline_at"),
  });
}

function listingOf(row: ListingRow): ChallengeListing {
  const { status, seat_preference: seatPreference } = row;
  if (!isChallengeStatus(status)) throw new MalformedRow("challenges.status");
  if (!isSeatPreference(seatPreference)) throw new MalformedRow("challenges.seat_preference");
  const rulesetId = parseChallengeRuleset(row.ruleset_id);
  if (rulesetId === null) throw new MalformedRow("challenges.ruleset_id");
  const timeControl = parseTimeControlRequest(
    row.time_control_type,
    row.initial_time_ms,
    row.increment_ms,
  );
  if (timeControl === null) throw new MalformedRow("challenges.time_control");
  const challenge: Challenge = Object.freeze({
    challengeId: challengeIdOf(row.challenge_id),
    challengerUserId: userIdOf(row.challenger_user_id, "challenges.challenger_user_id"),
    challengedUserId: userIdOf(row.challenged_user_id, "challenges.challenged_user_id"),
    status,
    rulesetId,
    timeControl,
    seatPreference,
    createdAt: integerOf(row.created_at_ms, "challenges.created_at"),
    expiresAt: integerOf(row.expires_at_ms, "challenges.expires_at"),
    resolvedAt:
      row.resolved_at_ms === null ? null : integerOf(row.resolved_at_ms, "challenges.resolved_at"),
    acceptance: acceptanceOf(row),
    createdGameId: gameReferenceOf(row.created_game_id, "challenges.created_game_id"),
  });
  const violation = challengeInvariantViolation(challenge);
  if (violation !== null) throw new MalformedRow(`challenges.${violation}`);
  return Object.freeze({
    challenge,
    challengerUsername: row.challenger_username,
    challengedUsername: row.challenged_username,
  });
}

const LISTING_SELECT = sql`
  SELECT
    c.challenge_id, c.challenger_user_id::text AS challenger_user_id,
    c.challenged_user_id::text AS challenged_user_id, c.status, c.ruleset_id,
    c.time_control_type, c.initial_time_ms, c.increment_ms, c.seat_preference,
    ${epochMsOf("c.created_at")} AS created_at_ms,
    ${epochMsOf("c.expires_at")} AS expires_at_ms,
    ${epochMsOf("c.resolved_at")} AS resolved_at_ms,
    c.created_game_id,
    ${epochMsOf("c.accepted_at")} AS accepted_at_ms,
    c.intended_game_id,
    c.white_user_id::text AS white_user_id,
    c.black_user_id::text AS black_user_id,
    ${epochMsOf("c.start_deadline_at")} AS start_deadline_at_ms,
    challenger.username AS challenger_username,
    challenged.username AS challenged_username
  FROM challenges AS c
  JOIN users AS challenger ON challenger.user_id = c.challenger_user_id
  JOIN users AS challenged ON challenged.user_id = c.challenged_user_id`;

const RESOLUTIONS = new Set(["declined", "cancelled"]);

/**
 * The challenge table on PostgreSQL. Every method is one statement or one
 * transaction; every resolution is a compare-and-set on `status = 'pending'`
 * and the deadline, and every acceptance outcome one on `status =
 * 'accepting'` and the reserved game id, so exactly one of any concurrent
 * writers wins.
 */
export class PostgresChallengeStore implements ChallengeStore {
  readonly #db: Kysely<ChallengesDatabase>;

  constructor(db: Kysely<ChallengesDatabase>) {
    this.#db = db;
  }

  create(challenge: Challenge, caps: PendingCaps): Promise<CreateChallengeOutcome> {
    const { challengerUserId: challenger, challengedUserId: challenged } = challenge;
    const now = wallTime(challenge.createdAt);
    const expiresAt = wallTime(challenge.expiresAt);
    const lockOrder = [challenger, challenged].sort();
    return guard(() =>
      this.#db.transaction().execute(async (trx): Promise<CreateChallengeOutcome> => {
        for (const userId of lockOrder) {
          await sql`SELECT pg_advisory_xact_lock(hashtextextended(${LOCK_NAMESPACE + userId}, 0))`.execute(
            trx,
          );
        }
        await sql`
          UPDATE challenges SET status = 'expired', resolved_at = expires_at
          WHERE status = 'pending' AND expires_at <= ${now}
            AND LEAST(challenger_user_id, challenged_user_id) = LEAST(${challenger}::uuid, ${challenged}::uuid)
            AND GREATEST(challenger_user_id, challenged_user_id) = GREATEST(${challenger}::uuid, ${challenged}::uuid)
        `.execute(trx);
        const counted = await sql<{ outgoing: string; incoming: string }>`
          SELECT
            (SELECT count(*) FROM challenges
              WHERE challenger_user_id = ${challenger}::uuid
                AND status = 'pending' AND expires_at > ${now})::text AS outgoing,
            (SELECT count(*) FROM challenges
              WHERE challenged_user_id = ${challenged}::uuid
                AND status = 'pending' AND expires_at > ${now})::text AS incoming
        `.execute(trx);
        const counts = counted.rows[0];
        if (counts === undefined) throw new MalformedRow("challenges.count");
        if (integerOf(counts.outgoing, "challenges.count") >= caps.maxOutgoingPending) {
          return "outgoing_limit";
        }
        if (integerOf(counts.incoming, "challenges.count") >= caps.maxIncomingPending) {
          return "incoming_limit";
        }
        const { timeControl } = challenge;
        const inserted = await sql<{ challenge_id: string }>`
          INSERT INTO challenges (
            challenge_id, challenger_user_id, challenged_user_id, status, ruleset_id,
            time_control_type, initial_time_ms, increment_ms, seat_preference,
            created_at, expires_at, resolved_at, created_game_id
          ) VALUES (
            ${challenge.challengeId}, ${challenger}::uuid, ${challenged}::uuid, 'pending',
            ${challenge.rulesetId}, ${timeControl.type}, ${timeControl.initialMs},
            ${timeControl.incrementMs}, ${challenge.seatPreference},
            ${now}, ${expiresAt}, NULL, NULL
          )
          ON CONFLICT DO NOTHING
          RETURNING challenge_id
        `.execute(trx);
        return inserted.rows.length === 1 ? "created" : "pair_pending";
      }),
    );
  }

  find(challengeId: ChallengeId): Promise<ChallengeListing | null> {
    return guard(async () => {
      const { rows } = await sql<ListingRow>`
        ${LISTING_SELECT}
        WHERE c.challenge_id = ${challengeId}
        LIMIT 2
      `.execute(this.#db);
      if (rows.length > 1) throw new MalformedRow("challenges.challenge_id");
      const [row] = rows;
      return row === undefined ? null : listingOf(row);
    });
  }

  listPending(query: PendingQuery): Promise<readonly ChallengeListing[]> {
    const participant = sql.ref(
      query.direction === "incoming" ? "c.challenged_user_id" : "c.challenger_user_id",
    );
    const { after } = query;
    const resume =
      after === null
        ? sql``
        : sql`AND (c.created_at, c.challenge_id) < (${wallTime(after.createdAt)}, ${after.challengeId})`;
    return guard(async () => {
      const { rows } = await sql<ListingRow>`
        ${LISTING_SELECT}
        WHERE ${participant} = ${query.userId}::uuid
          AND c.status = 'pending'
          AND c.expires_at > ${wallTime(query.now)}
          ${resume}
        ORDER BY c.created_at DESC, c.challenge_id DESC
        LIMIT ${query.limit}
      `.execute(this.#db);
      return rows.map(listingOf);
    });
  }

  resolve(next: Challenge, now: number): Promise<boolean> {
    if (!RESOLUTIONS.has(next.status) || next.resolvedAt === null) {
      throw new RangeError("Only a decline or cancel is stored as a resolution");
    }
    const resolvedAt = wallTime(next.resolvedAt);
    const decidedAt = wallTime(now);
    return guard(async () => {
      const result = await sql`
        UPDATE challenges
        SET status = ${next.status}, resolved_at = ${resolvedAt}
        WHERE challenge_id = ${next.challengeId}
          AND status = 'pending'
          AND expires_at > ${decidedAt}
      `.execute(this.#db);
      return (result.numAffectedRows ?? 0n) > 0n;
    });
  }

  reserveAcceptance(next: Challenge, now: number): Promise<boolean> {
    const { acceptance } = next;
    if (next.status !== "accepting" || acceptance === null) {
      throw new RangeError("Only an accepting challenge reserves an acceptance");
    }
    const decidedAt = wallTime(now);
    return guard(async () => {
      const result = await sql`
        UPDATE challenges
        SET status = 'accepting',
          accepted_at = ${wallTime(acceptance.acceptedAt)},
          intended_game_id = ${acceptance.gameId},
          white_user_id = ${acceptance.white}::uuid,
          black_user_id = ${acceptance.black}::uuid,
          start_deadline_at = ${wallTime(acceptance.startDeadlineAt)}
        WHERE challenge_id = ${next.challengeId}
          AND status = 'pending'
          AND expires_at > ${decidedAt}
      `.execute(this.#db);
      return (result.numAffectedRows ?? 0n) > 0n;
    });
  }

  completeAcceptance(next: Challenge): Promise<boolean> {
    const { acceptance, createdGameId } = next;
    if (next.status !== "accepted" || acceptance === null || createdGameId !== acceptance.gameId) {
      throw new RangeError("Only an accepted challenge with its reserved game completes");
    }
    return guard(async () => {
      const result = await sql`
        UPDATE challenges
        SET status = 'accepted', created_game_id = intended_game_id, resolved_at = accepted_at
        WHERE challenge_id = ${next.challengeId}
          AND status = 'accepting'
          AND intended_game_id = ${acceptance.gameId}
      `.execute(this.#db);
      return (result.numAffectedRows ?? 0n) > 0n;
    });
  }

  failAcceptance(next: Challenge): Promise<boolean> {
    const { acceptance, resolvedAt } = next;
    if (
      next.status !== "accept_failed" ||
      acceptance === null ||
      resolvedAt === null ||
      next.createdGameId !== null
    ) {
      throw new RangeError("Only a failed acceptance of its reserved game is stored as failed");
    }
    return guard(async () => {
      const result = await sql`
        UPDATE challenges
        SET status = 'accept_failed', resolved_at = ${wallTime(resolvedAt)}
        WHERE challenge_id = ${next.challengeId}
          AND status = 'accepting'
          AND intended_game_id = ${acceptance.gameId}
      `.execute(this.#db);
      return (result.numAffectedRows ?? 0n) > 0n;
    });
  }

  listAccepting(query: AcceptingQuery): Promise<readonly ChallengeListing[]> {
    if (!Number.isSafeInteger(query.limit) || query.limit < 1) {
      throw new RangeError("The accepting listing limit must be a positive integer");
    }
    const { after } = query;
    const resume =
      after === null
        ? sql``
        : sql`AND (c.accepted_at, c.challenge_id) > (${wallTime(after.acceptedAt)}, ${after.challengeId})`;
    return guard(async () => {
      const { rows } = await sql<ListingRow>`
        ${LISTING_SELECT}
        WHERE c.status = 'accepting'
          ${resume}
        ORDER BY c.accepted_at, c.challenge_id
        LIMIT ${query.limit}
      `.execute(this.#db);
      return rows.map(listingOf);
    });
  }

  expire(challengeId: ChallengeId, now: number): Promise<boolean> {
    const decidedAt = wallTime(now);
    return guard(async () => {
      const result = await sql`
        UPDATE challenges SET status = 'expired', resolved_at = expires_at
        WHERE challenge_id = ${challengeId} AND status = 'pending' AND expires_at <= ${decidedAt}
      `.execute(this.#db);
      return (result.numAffectedRows ?? 0n) > 0n;
    });
  }

  expireOverdue(now: number, limit: number): Promise<number> {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new RangeError("The expiry sweep limit must be a positive integer");
    }
    const decidedAt = wallTime(now);
    return guard(async () => {
      const result = await sql`
        WITH due AS MATERIALIZED (
          SELECT challenge_id FROM challenges
          WHERE status = 'pending' AND expires_at <= ${decidedAt}
          ORDER BY expires_at
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE challenges AS c SET status = 'expired', resolved_at = c.expires_at
        FROM due
        WHERE c.challenge_id = due.challenge_id AND c.status = 'pending'
      `.execute(this.#db);
      return Number(result.numAffectedRows ?? 0n);
    });
  }
}
