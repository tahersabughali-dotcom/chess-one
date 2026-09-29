import type { SessionId } from "@chess-one/accounts";
import type { ControlLeaseId, GameId, PlayerId, Seat } from "@chess-one/live-game-runtime";
import type { Assignment, SeatControlRecord, SeatListing } from "./values.ts";

/**
 * The store could not answer (`unavailable`), or answered with a row that
 * breaks the model (`corrupt`). Either way nothing is granted: every caller
 * fails closed.
 */
export class GameAccessStoreError extends Error {
  override readonly name = "GameAccessStoreError";
  readonly kind: "unavailable" | "corrupt";
  /** The SQLSTATE when known, or the corrupt field; never a value or a message. */
  readonly detail: string | null;

  constructor(kind: "unavailable" | "corrupt", detail: string | null) {
    super(`Game access store ${kind}${detail === null ? "" : `: ${detail}`}`);
    this.kind = kind;
    this.detail = detail;
  }
}

export interface NewAssignment {
  readonly gameId: GameId;
  readonly players: Readonly<Record<Seat, PlayerId>>;
  /** The initial lease of each seat; no session holds either yet. */
  readonly leases: Readonly<Record<Seat, ControlLeaseId>>;
}

export interface ControlChange {
  readonly gameId: GameId;
  readonly seat: Seat;
  readonly expectedVersion: number;
  readonly sessionId: SessionId | null;
  readonly controlLeaseId: ControlLeaseId;
}

/**
 * The game-access tables. Every method is one statement or one transaction;
 * none returns a partial write. Implementations throw `GameAccessStoreError`.
 */
export interface GameAccessStore {
  /**
   * The assignment (pending) and both seat-control rows, in one transaction.
   * `already_assigned`: the game id has an assignment; nothing was written.
   */
  reserveAssignment(assignment: NewAssignment): Promise<"reserved" | "already_assigned">;
  /** Pending to confirmed; false when there is no pending assignment. */
  confirmAssignment(gameId: GameId): Promise<boolean>;
  /** Deletes a pending assignment and its control rows; a confirmed one is never deleted. */
  discardPendingAssignment(gameId: GameId): Promise<boolean>;
  findAssignment(gameId: GameId): Promise<Assignment | null>;
  /** The user's most recently created seats, newest first, at most `limit`. */
  seatsOf(playerId: PlayerId, limit: number): Promise<readonly SeatListing[]>;
  findControl(gameId: GameId, seat: Seat): Promise<SeatControlRecord | null>;
  /**
   * Compare-and-set on `expectedVersion`: the new holder and lease, with
   * the version one higher. Null when the version moved; nothing written.
   */
  transferControl(change: ControlChange): Promise<SeatControlRecord | null>;
  controlsHeldBySession(sessionId: SessionId): Promise<readonly SeatControlRecord[]>;
  /** Seats assigned to the user that some session controls. */
  controlsHeldForUser(playerId: PlayerId): Promise<readonly SeatControlRecord[]>;
}
