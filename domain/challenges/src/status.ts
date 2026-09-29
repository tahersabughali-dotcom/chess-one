/**
 * The life of a direct challenge. `pending` is the only open state.
 * `accepting` is the durable reservation of an acceptance while its game is
 * created across another owner's persistence: it leads only to `accepted`
 * (the reserved game is proven to exist) or `accept_failed` (proven that it
 * never will: a participant became ineligible before the game existed, or
 * the reserved id holds another game). Each of the others is terminal and
 * absorbing: nothing ever leaves it.
 */
export const CHALLENGE_STATUSES: readonly ChallengeStatus[] = Object.freeze([
  "pending",
  "accepting",
  "accepted",
  "accept_failed",
  "declined",
  "cancelled",
  "expired",
]);

export type ChallengeStatus =
  | "pending"
  | "accepting"
  | "accepted"
  | "accept_failed"
  | "declined"
  | "cancelled"
  | "expired";

export type TerminalChallengeStatus = Exclude<ChallengeStatus, "pending" | "accepting">;

export function isChallengeStatus(value: string): value is ChallengeStatus {
  return (
    value === "pending" ||
    value === "accepting" ||
    value === "accepted" ||
    value === "accept_failed" ||
    value === "declined" ||
    value === "cancelled" ||
    value === "expired"
  );
}

export function isTerminalStatus(status: ChallengeStatus): status is TerminalChallengeStatus {
  return status !== "pending" && status !== "accepting";
}
