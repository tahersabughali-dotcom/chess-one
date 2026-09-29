import type { Challenge, ChallengeId } from "@chess-one/challenge-domain";
import {
  type AcceptingQuery,
  type ChallengeListing,
  type ChallengeStore,
  ChallengeStoreError,
  type CreateChallengeOutcome,
  type PendingCaps,
  type PendingQuery,
} from "@chess-one/challenges";

type AcceptanceMethod = "reserveAcceptance" | "completeAcceptance" | "failAcceptance";

/**
 * `fail`: the call throws and stores nothing; `apply_then_fail`: the call
 * stores its change, then throws as if the reply were lost.
 */
export interface AcceptanceFault {
  readonly method: AcceptanceMethod;
  readonly mode: "fail" | "apply_then_fail";
}

/**
 * TEST ADAPTER: the challenge store in memory, with the PostgreSQL
 * adapter's semantics (the same pair, cap, compare-and-set, deadline, and
 * one-reservation-per-game-id rules). Usernames come from a lookup the test
 * supplies. `failNext` makes the next call throw a store error;
 * `acceptanceFault` injects one fault into the next acceptance write.
 */
export class MemoryChallengeStore implements ChallengeStore {
  readonly rows = new Map<ChallengeId, Challenge>();
  readonly #usernameOf: (userId: string) => string;
  failNext: "unavailable" | "corrupt" | null = null;
  acceptanceFault: AcceptanceFault | null = null;
  calls = 0;

  constructor(usernameOf: (userId: string) => string) {
    this.#usernameOf = usernameOf;
  }

  #enter(): void {
    this.calls += 1;
    const failure = this.failNext;
    if (failure === null) return;
    this.failNext = null;
    throw new ChallengeStoreError(failure, failure === "corrupt" ? "challenges.status" : "08006");
  }

  #listing(challenge: Challenge): ChallengeListing {
    return {
      challenge,
      challengerUsername: this.#usernameOf(challenge.challengerUserId),
      challengedUsername: this.#usernameOf(challenge.challengedUserId),
    };
  }

  #pending(now: number): Challenge[] {
    return [...this.rows.values()].filter((row) => row.status === "pending" && now < row.expiresAt);
  }

  async create(challenge: Challenge, caps: PendingCaps): Promise<CreateChallengeOutcome> {
    this.#enter();
    const now = challenge.createdAt;
    const pair = new Set([challenge.challengerUserId, challenge.challengedUserId]);
    for (const row of this.rows.values()) {
      const samePair = pair.has(row.challengerUserId) && pair.has(row.challengedUserId);
      if (samePair && row.status === "pending" && now >= row.expiresAt) {
        this.rows.set(row.challengeId, { ...row, status: "expired", resolvedAt: row.expiresAt });
      }
    }
    const pending = this.#pending(now);
    const outgoing = pending.filter((row) => row.challengerUserId === challenge.challengerUserId);
    const incoming = pending.filter((row) => row.challengedUserId === challenge.challengedUserId);
    if (outgoing.length >= caps.maxOutgoingPending) return "outgoing_limit";
    if (incoming.length >= caps.maxIncomingPending) return "incoming_limit";
    const pairTaken = [...this.rows.values()].some(
      (row) =>
        row.status === "pending" &&
        pair.has(row.challengerUserId) &&
        pair.has(row.challengedUserId),
    );
    if (pairTaken || this.rows.has(challenge.challengeId)) return "pair_pending";
    this.rows.set(challenge.challengeId, challenge);
    return "created";
  }

  async find(challengeId: ChallengeId): Promise<ChallengeListing | null> {
    this.#enter();
    const row = this.rows.get(challengeId);
    return row === undefined ? null : this.#listing(row);
  }

  async listPending(query: PendingQuery): Promise<readonly ChallengeListing[]> {
    this.#enter();
    const mine = this.#pending(query.now).filter((row) =>
      query.direction === "incoming"
        ? row.challengedUserId === query.userId
        : row.challengerUserId === query.userId,
    );
    const { after } = query;
    return mine
      .filter(
        (row) =>
          after === null ||
          row.createdAt < after.createdAt ||
          (row.createdAt === after.createdAt && row.challengeId < after.challengeId),
      )
      .sort((a, b) =>
        a.createdAt !== b.createdAt
          ? b.createdAt - a.createdAt
          : a.challengeId < b.challengeId
            ? 1
            : -1,
      )
      .slice(0, query.limit)
      .map((row) => this.#listing(row));
  }

  async resolve(next: Challenge, now: number): Promise<boolean> {
    this.#enter();
    const row = this.rows.get(next.challengeId);
    if (row === undefined || row.status !== "pending" || now >= row.expiresAt) return false;
    this.rows.set(next.challengeId, next);
    return true;
  }

  #faultAt(method: AcceptanceMethod): AcceptanceFault | null {
    const fault = this.acceptanceFault;
    if (fault === null || fault.method !== method) return null;
    this.acceptanceFault = null;
    if (fault.mode === "fail") {
      throw new ChallengeStoreError("unavailable", "08006");
    }
    return fault;
  }

  async reserveAcceptance(next: Challenge, now: number): Promise<boolean> {
    this.#enter();
    const { acceptance } = next;
    if (next.status !== "accepting" || acceptance === null) {
      throw new RangeError("Only an accepting challenge reserves an acceptance");
    }
    const fault = this.#faultAt("reserveAcceptance");
    const row = this.rows.get(next.challengeId);
    if (row === undefined || row.status !== "pending" || now >= row.expiresAt) return false;
    for (const other of this.rows.values()) {
      if (other.acceptance?.gameId === acceptance.gameId) {
        throw new ChallengeStoreError("corrupt", "challenges_intended_game_key");
      }
    }
    this.rows.set(next.challengeId, { ...row, status: "accepting", acceptance });
    if (fault !== null) throw new ChallengeStoreError("unavailable", "08006");
    return true;
  }

  async completeAcceptance(next: Challenge): Promise<boolean> {
    this.#enter();
    const { acceptance, createdGameId } = next;
    if (next.status !== "accepted" || acceptance === null || createdGameId !== acceptance.gameId) {
      throw new RangeError("Only an accepted challenge with its reserved game completes");
    }
    const fault = this.#faultAt("completeAcceptance");
    const row = this.rows.get(next.challengeId);
    const reserved = row?.acceptance;
    if (row === undefined || row.status !== "accepting" || reserved?.gameId !== acceptance.gameId) {
      return false;
    }
    this.rows.set(next.challengeId, {
      ...row,
      status: "accepted",
      resolvedAt: reserved.acceptedAt,
      createdGameId: reserved.gameId,
    });
    if (fault !== null) throw new ChallengeStoreError("unavailable", "08006");
    return true;
  }

  async failAcceptance(next: Challenge): Promise<boolean> {
    this.#enter();
    const { acceptance, resolvedAt } = next;
    if (
      next.status !== "accept_failed" ||
      acceptance === null ||
      resolvedAt === null ||
      next.createdGameId !== null
    ) {
      throw new RangeError("Only a failed acceptance of its reserved game is stored as failed");
    }
    const fault = this.#faultAt("failAcceptance");
    const row = this.rows.get(next.challengeId);
    const reserved = row?.acceptance;
    if (row === undefined || row.status !== "accepting" || reserved?.gameId !== acceptance.gameId) {
      return false;
    }
    this.rows.set(next.challengeId, { ...row, status: "accept_failed", resolvedAt });
    if (fault !== null) throw new ChallengeStoreError("unavailable", "08006");
    return true;
  }

  async listAccepting(query: AcceptingQuery): Promise<readonly ChallengeListing[]> {
    this.#enter();
    const { after } = query;
    const keyed = [...this.rows.values()].flatMap((row) =>
      row.status === "accepting" && row.acceptance !== null
        ? [{ row, acceptedAt: row.acceptance.acceptedAt }]
        : [],
    );
    return keyed
      .filter(
        ({ row, acceptedAt }) =>
          after === null ||
          acceptedAt > after.acceptedAt ||
          (acceptedAt === after.acceptedAt && row.challengeId > after.challengeId),
      )
      .sort((a, b) =>
        a.acceptedAt !== b.acceptedAt
          ? a.acceptedAt - b.acceptedAt
          : a.row.challengeId < b.row.challengeId
            ? -1
            : 1,
      )
      .slice(0, query.limit)
      .map(({ row }) => this.#listing(row));
  }

  async expire(challengeId: ChallengeId, now: number): Promise<boolean> {
    this.#enter();
    const row = this.rows.get(challengeId);
    if (row === undefined || row.status !== "pending" || now < row.expiresAt) return false;
    this.rows.set(challengeId, { ...row, status: "expired", resolvedAt: row.expiresAt });
    return true;
  }

  async expireOverdue(now: number, limit: number): Promise<number> {
    this.#enter();
    const due = [...this.rows.values()]
      .filter((row) => row.status === "pending" && now >= row.expiresAt)
      .slice(0, limit);
    for (const row of due) {
      this.rows.set(row.challengeId, { ...row, status: "expired", resolvedAt: row.expiresAt });
    }
    return due.length;
  }
}
