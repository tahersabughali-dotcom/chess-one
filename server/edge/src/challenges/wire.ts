import type { ChallengeAcceptance, ChallengePage, ChallengeView } from "@chess-one/challenges";

/**
 * Versioned challenge response bodies. Participants appear by username
 * only: never an internal user id, email address, account status, session,
 * lease, or token. A reserved acceptance reads as status `processing`; its
 * game id is shown only once the game is proven to exist (`accepted`). A
 * failed acceptance reads as status `accept_failed`, with no game id and no
 * reason (never which account, or whether disabled or locked).
 */
export const CHALLENGE_FORMAT = "challenge.v1";
export const CHALLENGE_PAGE_FORMAT = "challenge_page.v1";
export const CHALLENGE_ACCEPT_FORMAT = "challenge_accept.v1";
export const CHALLENGE_ERROR_FORMAT = "challenge_error.v1";

export type ChallengeErrorCode =
  | "INVALID_REQUEST"
  | "UNAUTHENTICATED"
  | "ORIGIN_NOT_ALLOWED"
  | "NOT_FOUND"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "RATE_LIMITED"
  | "ACCOUNT_UNAVAILABLE"
  | "PLAYER_NOT_FOUND"
  | "PLAYER_UNAVAILABLE"
  | "CANNOT_CHALLENGE_SELF"
  | "INVALID_TIME_CONTROL"
  | "INVALID_SEAT_PREFERENCE"
  | "INVALID_RULESET"
  | "CHALLENGE_ALREADY_PENDING"
  | "CHALLENGE_LIMIT_REACHED"
  | "CHALLENGE_NOT_FOUND"
  | "CHALLENGE_NOT_PENDING"
  | "CHALLENGE_EXPIRED"
  | "CHALLENGE_ACCEPT_FAILED"
  | "NOT_CHALLENGE_PARTICIPANT"
  | "TEMPORARILY_UNAVAILABLE";

export interface ChallengeBodyWire {
  readonly challengeId: string;
  readonly status: string;
  readonly viewerRole: string;
  readonly challenger: { readonly username: string };
  readonly challenged: { readonly username: string };
  readonly rulesetId: string;
  readonly timeControl: {
    readonly type: string;
    readonly initialMs: number;
    readonly incrementMs: number;
  };
  readonly seatPreference: string;
  /** UTC epoch milliseconds. */
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly resolvedAt: number | null;
  readonly createdGameId: string | null;
  /** The viewer's colour in the created game; null unless accepted. */
  readonly viewerSeat: string | null;
}

export interface ChallengeWire {
  readonly format: typeof CHALLENGE_FORMAT;
  readonly challenge: ChallengeBodyWire;
}

/**
 * The answer to an accept: `game` is null exactly while the challenge is
 * `processing` (HTTP 202); retrying the accept continues the same game. A
 * failed acceptance is the error `CHALLENGE_ACCEPT_FAILED` (HTTP 409).
 */
export interface ChallengeAcceptWire {
  readonly format: typeof CHALLENGE_ACCEPT_FORMAT;
  readonly challenge: ChallengeBodyWire;
  readonly game: {
    readonly gameId: string;
    readonly viewerSeat: string;
    /** `awaiting_players` right after acceptance: no clock runs until both players are ready. */
    readonly lifecycle: string;
    /** UTC epoch milliseconds: the game may start while `now < startDeadlineAt`. */
    readonly startDeadlineAt: number;
  } | null;
}

export interface ChallengePageWire {
  readonly format: typeof CHALLENGE_PAGE_FORMAT;
  readonly direction: string;
  readonly challenges: readonly ChallengeBodyWire[];
  readonly nextCursor: string | null;
}

export interface ChallengeErrorWire {
  readonly format: typeof CHALLENGE_ERROR_FORMAT;
  readonly code: ChallengeErrorCode;
  /** RATE_LIMITED only. */
  readonly retryAfterMs?: number;
}

function body(view: ChallengeView): ChallengeBodyWire {
  return {
    challengeId: view.challengeId,
    status: view.status,
    viewerRole: view.viewerRole,
    challenger: { username: view.challengerUsername },
    challenged: { username: view.challengedUsername },
    rulesetId: view.rulesetId,
    timeControl: {
      type: view.timeControl.type,
      initialMs: view.timeControl.initialMs,
      incrementMs: view.timeControl.incrementMs,
    },
    seatPreference: view.seatPreference,
    createdAt: view.createdAt,
    expiresAt: view.expiresAt,
    resolvedAt: view.resolvedAt,
    createdGameId: view.createdGameId,
    viewerSeat: view.viewerSeat,
  };
}

export function encodeChallenge(view: ChallengeView): ChallengeWire {
  return { format: CHALLENGE_FORMAT, challenge: body(view) };
}

export function encodeChallengeAcceptance(acceptance: ChallengeAcceptance): ChallengeAcceptWire {
  const { game } = acceptance;
  return {
    format: CHALLENGE_ACCEPT_FORMAT,
    challenge: body(acceptance.challenge),
    game:
      game === null
        ? null
        : {
            gameId: game.gameId,
            viewerSeat: game.viewerSeat,
            lifecycle: game.lifecycle,
            startDeadlineAt: game.startDeadlineAt,
          },
  };
}

export function encodeChallengePage(page: ChallengePage): ChallengePageWire {
  return {
    format: CHALLENGE_PAGE_FORMAT,
    direction: page.direction,
    challenges: page.challenges.map(body),
    nextCursor: page.nextCursor,
  };
}

export function encodeChallengeError(
  code: ChallengeErrorCode,
  retryAfterMs?: number,
): ChallengeErrorWire {
  return {
    format: CHALLENGE_ERROR_FORMAT,
    code,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  };
}
