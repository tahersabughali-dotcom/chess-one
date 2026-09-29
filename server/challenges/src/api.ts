import type { AuthenticatedSession, Outcome } from "@chess-one/accounts";
import type {
  ChallengeDirection,
  ChallengeId,
  ChallengeRole,
  SeatColor,
  SeatPreference,
  TimeControlRequest,
} from "@chess-one/challenge-domain";
import type { AcceptingCursor, ChallengeGameLifecycle } from "./ports.ts";

/**
 * The status a participant sees. The stored `accepting` reads as
 * `processing`: the acceptance is reserved and its game is being created or
 * confirmed; the challenge can no longer be declined, cancelled, or expire.
 * `accept_failed`: the acceptance ended with no game, for a reason neither
 * participant is told.
 */
export type ChallengeViewStatus =
  | "pending"
  | "processing"
  | "accepted"
  | "accept_failed"
  | "declined"
  | "cancelled"
  | "expired";

/**
 * What a participant may see of a challenge: usernames, never an internal
 * user id, email, account status, session, or lease. A pending challenge
 * past its deadline reads as `expired`.
 */
export interface ChallengeView {
  readonly challengeId: ChallengeId;
  readonly status: ChallengeViewStatus;
  readonly viewerRole: ChallengeRole;
  readonly challengerUsername: string;
  readonly challengedUsername: string;
  readonly rulesetId: string;
  readonly timeControl: TimeControlRequest;
  readonly seatPreference: SeatPreference;
  /** UTC epoch milliseconds. */
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly resolvedAt: number | null;
  /** Set only once accepted: the game is proven to exist. */
  readonly createdGameId: string | null;
  /** The viewer's colour in the created game; null unless accepted. */
  readonly viewerSeat: SeatColor | null;
}

/** The accepted challenge's game as a participant may see it. */
export interface AcceptedGameView {
  readonly gameId: string;
  readonly viewerSeat: SeatColor;
  /** `unknown` when the game could not be read just now; it exists regardless. */
  readonly lifecycle: ChallengeGameLifecycle;
  /** UTC epoch milliseconds: the game may start while `now < startDeadlineAt`. */
  readonly startDeadlineAt: number;
}

/**
 * An accept answer: `accepted` with its game, or `processing` (the
 * acceptance is reserved, the game not yet proven): retrying the same
 * accept continues the same game, never another. A failed acceptance is the
 * error `challenge_accept_failed`, not an acceptance.
 */
export interface ChallengeAcceptance {
  readonly challenge: ChallengeView;
  /** Null exactly while processing. */
  readonly game: AcceptedGameView | null;
}

/**
 * One bounded pass of `reconcileAcceptingChallenges`. `next` resumes after
 * the last challenge examined, or is null once the pass reached the end of
 * the accepting challenges. When the pass could not list them (`listed`
 * false) `next` is the cursor it was given, so the same page is retried.
 */
export interface AcceptingReconciliation {
  readonly listed: boolean;
  readonly examined: number;
  readonly accepted: number;
  readonly failed: number;
  readonly processing: number;
  readonly next: AcceptingCursor | null;
}

export interface ChallengePage {
  readonly direction: ChallengeDirection;
  readonly challenges: readonly ChallengeView[];
  /** Null on the last page. */
  readonly nextCursor: string | null;
}

/** As the transport received it; every value is checked here, not by the transport. */
export interface CreateChallengeInput {
  readonly opponentUsername: string;
  /** Absent: the default ruleset. */
  readonly rulesetId: string | null;
  readonly timeControl: {
    readonly type: string;
    readonly initialMs: number;
    readonly incrementMs: number;
  };
  readonly seatPreference: string;
}

export interface ListChallengesInput {
  readonly direction: string;
  readonly cursor: string | null;
  readonly limit: number | null;
}

export type ChallengeError =
  | { readonly kind: "invalid_request" }
  | { readonly kind: "invalid_time_control" }
  | { readonly kind: "invalid_seat_preference" }
  | { readonly kind: "invalid_ruleset" }
  | { readonly kind: "player_not_found" }
  | { readonly kind: "player_unavailable" }
  | { readonly kind: "cannot_challenge_self" }
  | { readonly kind: "account_unavailable" }
  | { readonly kind: "challenge_already_pending" }
  | { readonly kind: "challenge_limit_reached" }
  | { readonly kind: "challenge_not_found" }
  | { readonly kind: "challenge_not_pending" }
  | { readonly kind: "challenge_expired" }
  /** The acceptance failed for good; never which participant or why. */
  | { readonly kind: "challenge_accept_failed" }
  | { readonly kind: "not_challenge_participant" }
  | { readonly kind: "rate_limited"; readonly retryAfterMs: number }
  | { readonly kind: "temporarily_unavailable" };

/**
 * The challenge use cases the HTTP transport calls, always with a session
 * the accounts application has just authenticated.
 */
export interface ChallengeApi {
  create(
    session: AuthenticatedSession,
    input: CreateChallengeInput,
  ): Promise<Outcome<ChallengeView, ChallengeError>>;
  get(
    session: AuthenticatedSession,
    challengeId: string,
  ): Promise<Outcome<ChallengeView, ChallengeError>>;
  list(
    session: AuthenticatedSession,
    input: ListChallengesInput,
  ): Promise<Outcome<ChallengePage, ChallengeError>>;
  accept(
    session: AuthenticatedSession,
    challengeId: string,
  ): Promise<Outcome<ChallengeAcceptance, ChallengeError>>;
  decline(
    session: AuthenticatedSession,
    challengeId: string,
  ): Promise<Outcome<ChallengeView, ChallengeError>>;
  cancel(
    session: AuthenticatedSession,
    challengeId: string,
  ): Promise<Outcome<ChallengeView, ChallengeError>>;
}
