import type {
  Challenge,
  ChallengeCursor,
  ChallengeDirection,
  ChallengeId,
  GameReference,
  TimeControlRequest,
} from "@chess-one/challenge-domain";
import type { UserId } from "@chess-one/identity";

/** A stored challenge with both participants' current display usernames. */
export interface ChallengeListing {
  readonly challenge: Challenge;
  readonly challengerUsername: string;
  readonly challengedUsername: string;
}

export interface PendingCaps {
  readonly maxOutgoingPending: number;
  readonly maxIncomingPending: number;
}

export type CreateChallengeOutcome =
  | "created"
  | "pair_pending"
  | "outgoing_limit"
  | "incoming_limit";

export interface PendingQuery {
  readonly userId: UserId;
  readonly direction: ChallengeDirection;
  /** Only challenges with `now < expiresAt` are listed. */
  readonly now: number;
  readonly after: ChallengeCursor | null;
  readonly limit: number;
}

/** Where an accepting listing resumes: strictly after this reservation, in `(acceptedAt, challengeId)` order. */
export interface AcceptingCursor {
  readonly acceptedAt: number;
  readonly challengeId: ChallengeId;
}

export interface AcceptingQuery {
  readonly after: AcceptingCursor | null;
  readonly limit: number;
}

/**
 * Durable challenges. Every method is one statement or one transaction;
 * every time is wall-clock epoch milliseconds from the application's clock.
 */
export interface ChallengeStore {
  /**
   * Inserts a new pending challenge, serialised with every other create
   * that involves either participant: first the pair's pending challenge
   * already past its deadline is expired, then both pending caps are
   * counted at `createdAt`, then the insert, which the one-pending-per-pair
   * constraint may refuse (`pair_pending`).
   */
  create(challenge: Challenge, caps: PendingCaps): Promise<CreateChallengeOutcome>;
  find(challengeId: ChallengeId): Promise<ChallengeListing | null>;
  listPending(query: PendingQuery): Promise<readonly ChallengeListing[]>;
  /**
   * Compare-and-set of a decline or cancel: stores `next` only if the stored
   * challenge is still pending and `now < expiresAt`. False if another
   * resolution, an acceptance, or the deadline won.
   */
  resolve(next: Challenge, now: number): Promise<boolean>;
  /**
   * Compare-and-set of an acceptance reservation (`accepting`): stores
   * `next`'s reservation only if the stored challenge is still pending and
   * `now < expiresAt`. False if anything else won.
   */
  reserveAcceptance(next: Challenge, now: number): Promise<boolean>;
  /**
   * Compare-and-set of `accepting` to `accepted`: only if the stored
   * challenge is accepting with `next`'s reserved game id. False otherwise.
   */
  completeAcceptance(next: Challenge): Promise<boolean>;
  /**
   * Compare-and-set of `accepting` to `accept_failed` at `next.resolvedAt`:
   * only if the stored challenge is accepting with `next`'s reserved game
   * id; the reservation is kept. False otherwise.
   */
  failAcceptance(next: Challenge): Promise<boolean>;
  /**
   * Maintenance: up to `limit` accepting challenges after the cursor, oldest
   * reservation first, `(acceptedAt, challengeId)` ascending.
   */
  listAccepting(query: AcceptingQuery): Promise<readonly ChallengeListing[]>;
  /** Compare-and-set of the expiry: only a pending challenge with `now >= expiresAt`. */
  expire(challengeId: ChallengeId, now: number): Promise<boolean>;
  /** Maintenance: expires up to `limit` overdue pending challenges; returns how many. */
  expireOverdue(now: number, limit: number): Promise<number>;
}

/** The game an acceptance reserved, exactly as the trusted creator receives it. */
export interface ChallengeGameSpec {
  readonly gameId: GameReference;
  readonly white: UserId;
  readonly black: UserId;
  readonly rulesetId: Challenge["rulesetId"];
  readonly timeControl: TimeControlRequest;
  /** UTC wall time from which the game, if not yet started, is aborted. */
  readonly startDeadlineAt: number;
}

/**
 * - `created`: the game exists, awaiting its players, and its assignment is confirmed;
 * - `refused`: nothing was stored because a player can no longer play (the
 *   creator refuses before storing anything); `check` still decides whether
 *   an earlier attempt stored the game;
 * - `unconfirmed`: anything else; only `check` can tell what is stored.
 */
export type ChallengeGameCreation =
  | { readonly kind: "created" }
  | { readonly kind: "refused"; readonly reason: "player_unavailable" }
  | { readonly kind: "unconfirmed" };

/**
 * `matches`: the reserved game exists exactly as specified (id, both seats,
 * ruleset, initial time, and, while the game still records it, its start
 * deadline; any lifecycle); `absent`: surely nothing is stored under its id;
 * `mismatch`: something else holds the id; `unknown`: not provable now.
 */
export type ChallengeGameCheck = "matches" | "absent" | "mismatch" | "unknown";

export type ChallengeGameLifecycle =
  | "awaiting_players"
  | "in_progress"
  | "ended"
  | "aborted_before_start"
  | "unknown";

/**
 * The only way the challenge application reaches games: a trusted creator
 * of the assigned game an acceptance reserved. It knows nothing of how games
 * are stored or played. Creating the same spec again is safe: an id already
 * taken is never replaced.
 */
export interface ChallengeGameCreator {
  create(spec: ChallengeGameSpec): Promise<ChallengeGameCreation>;
  check(spec: ChallengeGameSpec): Promise<ChallengeGameCheck>;
  lifecycle(gameId: GameReference): Promise<ChallengeGameLifecycle>;
}

export class ChallengeStoreError extends Error {
  override readonly name = "ChallengeStoreError";
  readonly kind: "unavailable" | "corrupt";
  /** The SQLSTATE when known, or the corrupt field; never a value or a message. */
  readonly detail: string | null;

  constructor(kind: "unavailable" | "corrupt", detail: string | null) {
    super(`Challenge store ${kind}${detail === null ? "" : `: ${detail}`}`);
    this.kind = kind;
    this.detail = detail;
  }
}
