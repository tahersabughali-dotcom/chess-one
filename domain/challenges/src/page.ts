import { type ChallengeId, isChallengeId } from "./challenge-id.ts";
import { CHALLENGE_POLICY } from "./policy.ts";

export type ChallengeDirection = "incoming" | "outgoing";

export function isChallengeDirection(value: string): value is ChallengeDirection {
  return value === "incoming" || value === "outgoing";
}

/**
 * Where a page of pending challenges resumes. Pages run newest first by
 * (`createdAt`, `challengeId`), a total order, so a cursor never repeats or
 * skips a challenge that stays pending. Both parts are already visible to
 * the reader; the cursor reveals nothing new.
 */
export interface ChallengeCursor {
  readonly createdAt: number;
  readonly challengeId: ChallengeId;
}

const CURSOR_FORMAT = /^(0|[1-9][0-9]{0,15})\.([A-Za-z0-9_-]{22})$/;

export function encodeChallengeCursor(cursor: ChallengeCursor): string {
  return `${cursor.createdAt}.${cursor.challengeId}`;
}

export function parseChallengeCursor(text: string): ChallengeCursor | null {
  const match = CURSOR_FORMAT.exec(text);
  const createdAt = Number(match?.[1]);
  const challengeId = match?.[2] ?? "";
  if (!Number.isSafeInteger(createdAt) || !isChallengeId(challengeId)) return null;
  return Object.freeze({ createdAt, challengeId });
}

/** The page size to use: the default when none is asked for, null when the request is out of range. */
export function resolvePageSize(requested: number | null): number | null {
  if (requested === null) return CHALLENGE_POLICY.defaultPageSize;
  return Number.isSafeInteger(requested) &&
    requested >= 1 &&
    requested <= CHALLENGE_POLICY.maxPageSize
    ? requested
    : null;
}
