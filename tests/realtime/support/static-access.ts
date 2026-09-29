import type { TrustedSessionContext } from "@chess-one/edge";
import type {
  ClaimDecision,
  GameAccessDecision,
  ReplayAccess,
  SessionGameAuthority,
} from "@chess-one/game-access";
import type { ControlLeaseId, GameId, PlayerId, Seat } from "@chess-one/live-game-runtime";

export interface StaticSeat {
  readonly gameId: GameId;
  readonly seat: Seat;
  readonly controlLeaseId: ControlLeaseId;
}

const DENIED: GameAccessDecision = Object.freeze({ kind: "denied" });
const NO_ACCESS: ClaimDecision = Object.freeze({ kind: "refused", reason: "no_access" });
const REPLAY_DENIED: ReplayAccess = Object.freeze({ kind: "denied" });

/**
 * TEST-ONLY authority: fixed seats whose control this session always holds
 * under a fixed lease. It stands in for game access where a test is about
 * the transport, not about who controls a seat.
 */
export function staticAuthority(seats: readonly StaticSeat[]): SessionGameAuthority {
  const bySeat = new Map(seats.map((seat) => [seat.gameId, seat]));
  return Object.freeze({
    access: async (gameId: GameId): Promise<GameAccessDecision> => {
      const found = bySeat.get(gameId);
      if (found === undefined) return DENIED;
      return {
        kind: "player",
        seat: found.seat,
        control: { held: true, controlLeaseId: found.controlLeaseId },
      };
    },
    claim: async (gameId: GameId): Promise<ClaimDecision> => {
      const found = bySeat.get(gameId);
      if (found === undefined) return NO_ACCESS;
      return { kind: "granted", seat: found.seat, controlLeaseId: found.controlLeaseId };
    },
    replayAccess: async (gameId: GameId): Promise<ReplayAccess> => {
      const found = bySeat.get(gameId);
      return found === undefined ? REPLAY_DENIED : { kind: "player", seat: found.seat };
    },
    watchControl: () => () => undefined,
    sessionEnded: () => undefined,
  });
}

/** A test session listing and controlling `seats`. */
export function staticSession(
  actorId: PlayerId,
  seats: readonly StaticSeat[],
): TrustedSessionContext {
  return {
    actorId,
    games: seats.map(({ gameId, seat }) => ({ gameId, seat })),
    authority: staticAuthority(seats),
  };
}
