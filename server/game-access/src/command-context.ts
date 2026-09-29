import type { AuthorizedGameActor, GameId, PlayerId, Seat } from "@chess-one/live-game-runtime";
import type { SeatControl } from "./values.ts";

/**
 * Everything a play command carries that the client may not choose: the
 * actor from the session, the seat from the assignment, and the lease from
 * the control record. The live game still validates all three.
 */
export interface TrustedGameCommandContext {
  readonly actor: AuthorizedGameActor;
}

/** Null unless this session holds control of the seat: no lease, no command. */
export function trustedCommandContext(
  actorId: PlayerId,
  gameId: GameId,
  seat: Seat,
  control: SeatControl,
): TrustedGameCommandContext | null {
  if (!control.held) return null;
  const actor: AuthorizedGameActor = Object.freeze({
    gameId,
    playerId: actorId,
    seat,
    controlLeaseId: control.controlLeaseId,
  });
  return Object.freeze({ actor });
}
