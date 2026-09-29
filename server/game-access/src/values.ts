import type { SessionId } from "@chess-one/accounts";
import type { ControlLeaseId, GameId, PlayerId, Seat } from "@chess-one/live-game-runtime";

/**
 * The durable seat assignment of one game: exactly two different users,
 * one per seat. `pending` marks a creation not yet confirmed against the
 * live game (reconciliation); it grants the same access as `confirmed`.
 */
export interface Assignment {
  readonly gameId: GameId;
  readonly players: Readonly<Record<Seat, PlayerId>>;
  readonly state: "pending" | "confirmed";
}

/**
 * Who controls one seat. The lease is server-generated, opaque, and never
 * leaves the server; `version` grows by one with every change of holder or
 * lease and is the compare-and-set token.
 */
export interface SeatControlRecord {
  readonly gameId: GameId;
  readonly seat: Seat;
  readonly controllingSessionId: SessionId | null;
  readonly controlLeaseId: ControlLeaseId;
  readonly version: number;
}

/** One seat of a user, as listed to that user. Informational, never authority. */
export interface SeatListing {
  readonly gameId: GameId;
  readonly seat: Seat;
}

/** This session's control of its seat. Only `held` carries the lease, and only server-side. */
export type SeatControl =
  | { readonly held: true; readonly controlLeaseId: ControlLeaseId }
  | { readonly held: false };

/**
 * A change of a seat's controller as one watching session sees it: it now
 * holds the seat, another session of the same player took it, or nobody
 * holds it. Never names the other session.
 */
export type ControlNotice =
  | { readonly kind: "held"; readonly controlLeaseId: ControlLeaseId }
  | { readonly kind: "taken" }
  | { readonly kind: "released" };

/**
 * ProductionGameAccessResolver's answer for a user id and a game id. Only
 * the two player answers grant anything.
 */
export type AccessResolution =
  | "player_white"
  | "player_black"
  | "no_access"
  | "game_not_found"
  | "unavailable";

/**
 * What a session may do in one game. `denied` covers both a game that does
 * not exist and a game of other players, so the answer never reveals which.
 */
export type GameAccessDecision =
  | { readonly kind: "player"; readonly seat: Seat; readonly control: SeatControl }
  | { readonly kind: "denied" }
  | { readonly kind: "unavailable" };

/**
 * Whether a session may read its seat's historical command decisions: an
 * active session of the assigned player, controlling or not. `denied`
 * covers a game of other players and a game that does not exist alike.
 */
export type ReplayAccess =
  | { readonly kind: "player"; readonly seat: Seat }
  | { readonly kind: "denied" }
  | { readonly kind: "session_ended" }
  | { readonly kind: "unavailable" };

export type ClaimRefusal =
  /** Not a player of this game, or no such game. */
  | "no_access"
  /** The game is finished or stopped on an unresolved rules question. */
  | "game_closed"
  | "session_ended"
  | "rate_limited"
  /** The control record changed under the claim (another process); nothing was taken. */
  | "conflict";

export type ClaimDecision =
  | { readonly kind: "granted"; readonly seat: Seat; readonly controlLeaseId: ControlLeaseId }
  | { readonly kind: "refused"; readonly reason: ClaimRefusal }
  | { readonly kind: "unavailable" };

/** Why a seat lost its controller. Codes only; never a session id or lease. */
export type ControlRevocation =
  | "claimed_by_other_session"
  | "session_revoked"
  | "session_ended"
  | "account_closed";

export function seatOf(assignment: Assignment, playerId: PlayerId): Seat | null {
  if (assignment.players.white === playerId) return "white";
  if (assignment.players.black === playerId) return "black";
  return null;
}
