import type { RulesetId } from "@chess-one/chess-rules";
import type { UserId } from "@chess-one/identity";
import type { ChallengeId, GameReference } from "./challenge-id.ts";
import { expiresAtFor, isExpiredAt, isWallTimeMs, startDeadlineFor } from "./policy.ts";
import { resolveSeats, type SeatColor, type SeatPreference } from "./seat.ts";
import type { ChallengeStatus } from "./status.ts";
import type { TimeControlRequest } from "./time-control.ts";

/**
 * What an acceptance fixed, once, when it was reserved: the game's id and
 * final seats, and when it was accepted. Every retry and reconciliation
 * creates or finds exactly this game; nothing here is drawn again.
 */
export interface AcceptanceReservation {
  readonly acceptedAt: number;
  readonly gameId: GameReference;
  readonly white: UserId;
  readonly black: UserId;
  /** `acceptedAt` plus the start window: the game may start while `now < startDeadlineAt`. */
  readonly startDeadlineAt: number;
}

/**
 * One direct challenge from one registered player to another. The game
 * settings are fixed at creation. Acceptance first reserves (`accepting`),
 * then completes (`accepted`) once its game is proven to exist, or fails
 * (`accept_failed`) once it is proven the game never will; decline, cancel,
 * and expiry set only the status and the resolution time.
 */
export interface Challenge {
  readonly challengeId: ChallengeId;
  readonly challengerUserId: UserId;
  readonly challengedUserId: UserId;
  readonly status: ChallengeStatus;
  readonly rulesetId: RulesetId;
  readonly timeControl: TimeControlRequest;
  readonly seatPreference: SeatPreference;
  readonly createdAt: number;
  readonly expiresAt: number;
  /**
   * Null while pending or accepting; `expiresAt` itself for an expired
   * challenge; the acceptance time for an accepted one; the time the failure
   * was proven (never before the acceptance) for a failed acceptance.
   */
  readonly resolvedAt: number | null;
  /**
   * Set exactly while accepting, accepted, or accept_failed, and never
   * changed: a failed acceptance keeps its reservation for audit.
   */
  readonly acceptance: AcceptanceReservation | null;
  /**
   * Set exactly when accepted, to the reserved game id, and never replaced.
   * Null for a failed acceptance: it has no game.
   */
  readonly createdGameId: GameReference | null;
}

export interface NewChallengeInput {
  readonly challengeId: ChallengeId;
  readonly challengerUserId: UserId;
  readonly challengedUserId: UserId;
  readonly rulesetId: RulesetId;
  readonly timeControl: TimeControlRequest;
  readonly seatPreference: SeatPreference;
  readonly now: number;
}

export function newChallenge(
  input: NewChallengeInput,
):
  | { readonly ok: true; readonly challenge: Challenge }
  | { readonly ok: false; readonly reason: "same_player" | "invalid_time" } {
  if (input.challengerUserId === input.challengedUserId)
    return { ok: false, reason: "same_player" };
  if (!isWallTimeMs(input.now) || !isWallTimeMs(expiresAtFor(input.now))) {
    return { ok: false, reason: "invalid_time" };
  }
  return {
    ok: true,
    challenge: Object.freeze({
      challengeId: input.challengeId,
      challengerUserId: input.challengerUserId,
      challengedUserId: input.challengedUserId,
      status: "pending",
      rulesetId: input.rulesetId,
      timeControl: input.timeControl,
      seatPreference: input.seatPreference,
      createdAt: input.now,
      expiresAt: expiresAtFor(input.now),
      resolvedAt: null,
      acceptance: null,
      createdGameId: null,
    }),
  };
}

/** The first rule a reservation breaks against its challenge, or null. */
function reservationViolation(
  challenge: Challenge,
  acceptance: AcceptanceReservation,
): string | null {
  const { acceptedAt, white, black, startDeadlineAt } = acceptance;
  if (!isWallTimeMs(acceptedAt) || acceptedAt < challenge.createdAt) return "accepted_at";
  if (acceptedAt >= challenge.expiresAt) return "accepted_at";
  if (startDeadlineAt !== startDeadlineFor(acceptedAt)) return "start_deadline_at";
  const challenger = challenge.challengerUserId;
  const challenged = challenge.challengedUserId;
  const seated =
    (white === challenger && black === challenged) ||
    (white === challenged && black === challenger);
  if (!seated) return "seats";
  const { seatPreference } = challenge;
  if (seatPreference === "white" && white !== challenger) return "seats";
  if (seatPreference === "black" && black !== challenger) return "seats";
  return null;
}

/**
 * The first invariant a stored challenge breaks, or null. The same rules are
 * CHECK constraints in PostgreSQL; the adapter uses this to refuse a row
 * that could only come from corruption.
 */
export function challengeInvariantViolation(challenge: Challenge): string | null {
  const { status, createdAt, expiresAt, resolvedAt, createdGameId, acceptance } = challenge;
  if (challenge.challengerUserId === challenge.challengedUserId) return "participants";
  if (!isWallTimeMs(createdAt) || !isWallTimeMs(expiresAt) || expiresAt <= createdAt) {
    return "expires_at";
  }
  const reserved = status === "accepting" || status === "accepted" || status === "accept_failed";
  if (reserved !== (acceptance !== null)) return "acceptance";
  if ((status === "accepted") !== (createdGameId !== null)) return "created_game_id";
  if (acceptance !== null) {
    const violation = reservationViolation(challenge, acceptance);
    if (violation !== null) return violation;
    if (createdGameId !== null && createdGameId !== acceptance.gameId) return "created_game_id";
  }
  if (status === "pending" || status === "accepting") {
    return resolvedAt === null ? null : "resolved_at";
  }
  if (resolvedAt === null || !isWallTimeMs(resolvedAt) || resolvedAt < createdAt) {
    return "resolved_at";
  }
  if (status === "expired") return resolvedAt === expiresAt ? null : "resolved_at";
  if (status === "accepted") return resolvedAt === acceptance?.acceptedAt ? null : "resolved_at";
  /** A failure is proven after the acceptance, possibly past the challenge's own deadline. */
  if (status === "accept_failed") {
    return acceptance !== null && resolvedAt >= acceptance.acceptedAt ? null : "resolved_at";
  }
  return resolvedAt < expiresAt ? null : "resolved_at";
}

export type ChallengeRole = "challenger" | "challenged";

export function roleOf(challenge: Challenge, userId: UserId): ChallengeRole | null {
  if (userId === challenge.challengerUserId) return "challenger";
  if (userId === challenge.challengedUserId) return "challenged";
  return null;
}

export interface ChallengeRequest {
  readonly action: "decline" | "cancel";
  readonly actor: UserId;
  readonly now: number;
}

/**
 * What a decline or cancel does to a challenge:
 * - `transition`: store `next` if the stored challenge is still pending and unexpired;
 * - `unchanged`: a repeat of the resolution that already happened, by the same player;
 * - `expired`: the deadline has passed; store `next` (the expiry) and refuse the request;
 * - `refused`: a third user (`not_participant`, answered as not found), the
 *   other participant (`wrong_role`), or a challenge no longer pending
 *   (`not_pending`), which includes one whose acceptance is reserved.
 */
export type ChallengeDecision =
  | { readonly kind: "transition"; readonly next: Challenge }
  | { readonly kind: "unchanged"; readonly challenge: Challenge }
  | { readonly kind: "expired"; readonly next: Challenge }
  | {
      readonly kind: "refused";
      readonly reason: "not_participant" | "wrong_role" | "not_pending";
    };

const OUTCOME = Object.freeze({
  decline: "declined",
  cancel: "cancelled",
});

const ACTING_ROLE = Object.freeze({
  decline: "challenged",
  cancel: "challenger",
});

/** The expiry of a pending challenge whose deadline has passed, else null. An acceptance never expires. */
export function expiryOf(challenge: Challenge, now: number): Challenge | null {
  if (challenge.status !== "pending" || !isExpiredAt(challenge.expiresAt, now)) return null;
  return Object.freeze({ ...challenge, status: "expired", resolvedAt: challenge.expiresAt });
}

/** The status a reader sees: a pending challenge past its deadline reads as expired. */
export function effectiveChallenge(challenge: Challenge, now: number): Challenge {
  return expiryOf(challenge, now) ?? challenge;
}

/**
 * The decline and cancel state machine. Order: a third user learns nothing;
 * a challenge no longer pending stays so (a repeat by the same player is
 * `unchanged`); the deadline comes next, so no action lands at or after
 * `expiresAt`; only then the acting role.
 */
export function decide(challenge: Challenge, request: ChallengeRequest): ChallengeDecision {
  const role = roleOf(challenge, request.actor);
  if (role === null) return { kind: "refused", reason: "not_participant" };
  const permitted = ACTING_ROLE[request.action] === role;
  if (challenge.status !== "pending") {
    return permitted && challenge.status === OUTCOME[request.action]
      ? { kind: "unchanged", challenge }
      : { kind: "refused", reason: "not_pending" };
  }
  const expired = expiryOf(challenge, request.now);
  if (expired !== null) return { kind: "expired", next: expired };
  if (!permitted) return { kind: "refused", reason: "wrong_role" };
  return {
    kind: "transition",
    next: Object.freeze({
      ...challenge,
      status: OUTCOME[request.action],
      /** A wall clock stepped back never dates a resolution before the creation. */
      resolvedAt: Math.max(request.now, challenge.createdAt),
    }),
  };
}

/**
 * What an accept request does. Only the challenged player accepts:
 * - `reserve`: pending and unexpired; the caller revalidates the accounts
 *   and stores `reserveAcceptance` with a compare-and-set;
 * - `continue`: already accepting; finish the reserved game, never another;
 * - `accepted`: already accepted; the same game again (idempotent);
 * - `failed`: the acceptance failed; the same failure again (idempotent);
 * - `expired`: the deadline has passed; store `next` (the expiry) and refuse;
 * - `refused`: a third user (`not_participant`), the challenger
 *   (`wrong_role`), or a declined, cancelled, or expired challenge
 *   (`not_pending`).
 */
export type AcceptanceDecision =
  | { readonly kind: "reserve" }
  | { readonly kind: "continue"; readonly challenge: Challenge }
  | { readonly kind: "accepted"; readonly challenge: Challenge }
  | { readonly kind: "failed"; readonly challenge: Challenge }
  | { readonly kind: "expired"; readonly next: Challenge }
  | {
      readonly kind: "refused";
      readonly reason: "not_participant" | "wrong_role" | "not_pending";
    };

export function decideAcceptance(
  challenge: Challenge,
  actor: UserId,
  now: number,
): AcceptanceDecision {
  const role = roleOf(challenge, actor);
  if (role === null) return { kind: "refused", reason: "not_participant" };
  if (role === "challenger") {
    return challenge.status === "pending" && expiryOf(challenge, now) === null
      ? { kind: "refused", reason: "wrong_role" }
      : { kind: "refused", reason: "not_pending" };
  }
  switch (challenge.status) {
    case "accepting":
      return { kind: "continue", challenge };
    case "accepted":
      return { kind: "accepted", challenge };
    case "accept_failed":
      return { kind: "failed", challenge };
    case "declined":
    case "cancelled":
    case "expired":
      return { kind: "refused", reason: "not_pending" };
    case "pending": {
      const expired = expiryOf(challenge, now);
      return expired === null ? { kind: "reserve" } : { kind: "expired", next: expired };
    }
  }
}

export interface AcceptanceInput {
  readonly now: number;
  /** Generated once by the server for this reservation. */
  readonly gameId: GameReference;
  /** Asked only for a `random` preference, once, from the server's CSPRNG. */
  readonly drawChallengerColor: () => SeatColor;
}

/** The `accepting` challenge that reserves this acceptance: its game id, seats, and deadline. */
export function reserveAcceptance(challenge: Challenge, input: AcceptanceInput): Challenge {
  if (challenge.status !== "pending") throw new Error("Only a pending challenge is accepted");
  /** A wall clock stepped back never dates an acceptance before the creation. */
  const acceptedAt = Math.max(input.now, challenge.createdAt);
  const seats = resolveSeats(
    challenge.seatPreference,
    challenge.challengerUserId,
    challenge.challengedUserId,
    input.drawChallengerColor,
  );
  return Object.freeze({
    ...challenge,
    status: "accepting",
    acceptance: Object.freeze({
      acceptedAt,
      gameId: input.gameId,
      white: seats.white,
      black: seats.black,
      startDeadlineAt: startDeadlineFor(acceptedAt),
    }),
  });
}

/** The accepted challenge once its reserved game is proven to exist. */
export function completeAcceptance(challenge: Challenge): Challenge {
  const { acceptance } = challenge;
  if (challenge.status !== "accepting" || acceptance === null) {
    throw new Error("Only an accepting challenge is completed");
  }
  return Object.freeze({
    ...challenge,
    status: "accepted",
    resolvedAt: acceptance.acceptedAt,
    createdGameId: acceptance.gameId,
  });
}

/**
 * The failed acceptance once it is proven its reserved game will never
 * exist. The reservation stays as it was (audit); there is no game, and no
 * second game id or seat draw is ever made for this challenge.
 */
export function failAcceptance(challenge: Challenge, now: number): Challenge {
  const { acceptance } = challenge;
  if (challenge.status !== "accepting" || acceptance === null) {
    throw new Error("Only an accepting challenge fails");
  }
  return Object.freeze({
    ...challenge,
    status: "accept_failed",
    /** A wall clock stepped back never dates the failure before the acceptance. */
    resolvedAt: Math.max(now, acceptance.acceptedAt),
  });
}
