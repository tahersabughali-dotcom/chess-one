import type { GameId, Seat } from "@chess-one/live-game-runtime";
import type { ClaimRefusal, ControlRevocation, ReadyRefusal } from "./values.ts";

export interface GameAccessFactSink {
  record(fact: GameAccessFact): void;
}

export type AssignmentFailure =
  | "same_user"
  | "user_not_found"
  | "user_not_active"
  | "email_not_verified"
  | "game_already_assigned"
  | "start_refused"
  | "creation_unconfirmed"
  | "unavailable";

/**
 * Internal game-access facts: codes and game ids only. Never a user id next
 * to a session id, a session id, a lease, a token, a cookie, or an email.
 * None is a `game.finished` outbox event; a durable control-change event is
 * not defined yet (GAME-CONTROL-EVENT-001).
 */
export type GameAccessFact =
  | { readonly name: "game_assignment_created"; readonly gameId: GameId }
  | {
      readonly name: "game_assignment_failed";
      readonly gameId: GameId;
      readonly reason: AssignmentFailure;
    }
  | {
      readonly name: "game_assignment_reconciled";
      readonly gameId: GameId;
      readonly outcome: "confirmed" | "discarded" | "unknown";
    }
  | {
      readonly name: "game_access_denied";
      readonly gameId: GameId;
      readonly reason: "no_access" | "game_not_found";
    }
  | {
      readonly name: "game_control_claimed";
      readonly gameId: GameId;
      readonly seat: Seat;
      readonly rotated: boolean;
    }
  | {
      readonly name: "game_control_denied";
      readonly gameId: GameId;
      readonly reason: ClaimRefusal | "unavailable";
    }
  | {
      readonly name: "game_control_revoked";
      readonly gameId: GameId;
      readonly seat: Seat;
      readonly reason: ControlRevocation;
    }
  | { readonly name: "game_control_conflict"; readonly gameId: GameId; readonly seat: Seat }
  /** A ready request refused before or at the writer; codes only. */
  | {
      readonly name: "game_ready_denied";
      readonly gameId: GameId;
      readonly reason: ReadyRefusal | "unavailable";
    }
  | {
      readonly name: "game_access_unavailable";
      readonly operation: "resolve" | "claim" | "revoke" | "assign" | "list";
      readonly cause: "store_unavailable" | "store_corrupt" | "writer";
    };
