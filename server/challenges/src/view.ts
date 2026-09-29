import type { Challenge, ChallengeRole, SeatColor } from "@chess-one/challenge-domain";
import type { ChallengeView, ChallengeViewStatus } from "./api.ts";
import type { ChallengeListing } from "./ports.ts";

function viewStatus(challenge: Challenge): ChallengeViewStatus {
  return challenge.status === "accepting" ? "processing" : challenge.status;
}

/** The viewer's colour once the game is proven to exist; null before. */
export function viewerSeatOf(challenge: Challenge, viewerRole: ChallengeRole): SeatColor | null {
  const { acceptance } = challenge;
  if (challenge.status !== "accepted" || acceptance === null) return null;
  const viewer =
    viewerRole === "challenger" ? challenge.challengerUserId : challenge.challengedUserId;
  return acceptance.white === viewer ? "white" : "black";
}

export function challengeView(
  listing: ChallengeListing,
  challenge: Challenge,
  viewerRole: ChallengeRole,
): ChallengeView {
  return Object.freeze({
    challengeId: challenge.challengeId,
    status: viewStatus(challenge),
    viewerRole,
    challengerUsername: listing.challengerUsername,
    challengedUsername: listing.challengedUsername,
    rulesetId: challenge.rulesetId,
    timeControl: challenge.timeControl,
    seatPreference: challenge.seatPreference,
    createdAt: challenge.createdAt,
    expiresAt: challenge.expiresAt,
    resolvedAt: challenge.resolvedAt,
    createdGameId: challenge.createdGameId,
    viewerSeat: viewerSeatOf(challenge, viewerRole),
  });
}
