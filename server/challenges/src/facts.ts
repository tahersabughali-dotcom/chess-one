import type { ChallengeId } from "@chess-one/challenge-domain";

export interface ChallengeFactSink {
  record(fact: ChallengeFact): void;
}

export type ChallengeCreateRejection =
  | "rate_limited"
  | "invalid_input"
  | "account_unavailable"
  | "player_not_found"
  | "player_unavailable"
  | "same_player"
  | "already_pending"
  | "outgoing_limit"
  | "incoming_limit"
  | "store_unavailable";

export type ChallengeActionRefusal =
  | "not_found"
  | "wrong_role"
  | "not_pending"
  | "expired"
  | "account_unavailable"
  | "store_unavailable";

export type ChallengeAcceptRefusal =
  | ChallengeActionRefusal
  | "player_unavailable"
  | "accept_failed";

/**
 * Why an acceptance is still `accepting` after a request or reconciliation:
 * - `creation_unconfirmed`: the game's creation or check proved nothing;
 * - `game_absent`: surely nothing was stored; a retry creates the same game id;
 * - `eligibility_unavailable`: the game is surely absent, but whether both
 *   participants may still play could not be read, so nothing was created;
 * - `completion_failed`: the outcome is proven but its final status
 *   (`accepted` or `accept_failed`) could not be stored.
 */
export type ChallengeAcceptPending =
  | "creation_unconfirmed"
  | "game_absent"
  | "eligibility_unavailable"
  | "completion_failed";

/**
 * Why an acceptance failed for good. `participant_unavailable` covers every
 * account reason (disabled, locked, missing, or ineligible) without telling
 * them apart; `game_mismatch`: the reserved id holds another game (a defect).
 */
export type ChallengeAcceptFailure = "participant_unavailable" | "game_mismatch";

/** Who ran a reconciliation: an accept request retrying, or the maintenance operation. */
export type ChallengeReconcileVia = "request" | "maintenance";

/**
 * Internal challenge facts, in process only: codes and challenge ids, never
 * a user id, username, email, session, or request body. None is a durable
 * event; a challenge outbox is not defined yet (CHALLENGE-DURABLE-EVENTS-001).
 */
export type ChallengeFact =
  | { readonly name: "challenge_accept_reserved"; readonly challengeId: ChallengeId }
  | {
      readonly name: "challenge_accept_processing";
      readonly challengeId: ChallengeId;
      readonly cause: ChallengeAcceptPending;
    }
  | {
      readonly name: "challenge_accepted";
      readonly challengeId: ChallengeId;
      readonly via: "request" | "reconcile";
    }
  | {
      readonly name: "challenge_accept_failed";
      readonly challengeId: ChallengeId;
      readonly reason: ChallengeAcceptFailure;
    }
  | {
      readonly name: "challenge_accept_reconcile_started";
      readonly challengeId: ChallengeId;
      readonly via: ChallengeReconcileVia;
    }
  | {
      readonly name: "challenge_accept_reconciled";
      readonly challengeId: ChallengeId;
      readonly via: ChallengeReconcileVia;
      readonly outcome: "accepted" | "accept_failed";
    }
  | {
      /** Null `challengeId`: the accepting challenges could not even be listed. */
      readonly name: "challenge_accept_reconcile_unavailable";
      readonly challengeId: ChallengeId | null;
      readonly via: ChallengeReconcileVia;
      readonly cause: ChallengeAcceptPending | "store_unavailable";
    }
  | { readonly name: "challenge_accept_refused"; readonly reason: ChallengeAcceptRefusal }
  | { readonly name: "challenge_created"; readonly challengeId: ChallengeId }
  | { readonly name: "challenge_create_rejected"; readonly reason: ChallengeCreateRejection }
  | { readonly name: "challenge_declined"; readonly challengeId: ChallengeId }
  | { readonly name: "challenge_cancelled"; readonly challengeId: ChallengeId }
  | {
      readonly name: "challenge_expired";
      readonly challengeId: ChallengeId;
      readonly via: "action" | "accept";
    }
  | { readonly name: "challenges_expired_swept"; readonly count: number }
  | {
      readonly name: "challenge_action_refused";
      readonly action: "decline" | "cancel";
      readonly reason: ChallengeActionRefusal;
    };
