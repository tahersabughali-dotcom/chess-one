import type { AuthenticatedSession } from "@chess-one/accounts";
import type { GameId, PlayerId, Seat } from "@chess-one/live-game-runtime";
import type {
  ClaimDecision,
  ControlNotice,
  GameAccessDecision,
  ReplayAccess,
  SeatListing,
} from "./values.ts";

/**
 * Game access for one authenticated session. The edge holds one per
 * connection and asks it everything; it never reads a store and never
 * decides a seat or a lease itself.
 */
export interface SessionGameAuthority {
  /** The session's seat and control in `gameId`, read now. */
  access(gameId: GameId): Promise<GameAccessDecision>;
  /** Explicit takeover of the session's seat in `gameId` (rate limited per session). */
  claim(gameId: GameId): Promise<ClaimDecision>;
  /** The session's seat for reading its historical command decisions; control is not needed. */
  replayAccess(gameId: GameId): Promise<ReplayAccess>;
  /**
   * Called whenever the seat changes hands in this process. Returns the
   * unsubscribe; a full registry returns a no-op and the edge relies on the
   * writer refusing stale leases.
   */
  watchControl(gameId: GameId, seat: Seat, onChange: (notice: ControlNotice) => void): () => void;
  /** The session ended (expiry seen by the edge): its seats lose their controller. */
  sessionEnded(): void;
}

/** What the edge's session resolver needs to build a trusted session context. */
export interface GameAccessProvider {
  /** `production` only for the real store-backed implementation. */
  readonly trust: "production" | "test_only";
  /** The user's seats for `connection_ready`: informational, never authority. */
  seatsOf(playerId: PlayerId): Promise<readonly SeatListing[]>;
  forSession(session: AuthenticatedSession, playerId: PlayerId): SessionGameAuthority;
}
