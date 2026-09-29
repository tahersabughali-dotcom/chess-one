import type { TrustedSessionContext } from "@chess-one/edge";
import type {
  ClaimDecision,
  GameAccessDecision,
  ReadyDecision,
  ReplayAccess,
  SessionGameAuthority,
} from "@chess-one/game-access";
import type {
  ControlDirectory,
  ControlLeaseId,
  GameId,
  PlayerId,
  ReadyOutcome,
  ReadyPresence,
  Seat,
} from "@chess-one/live-game-runtime";

export interface StaticSeat {
  readonly gameId: GameId;
  readonly seat: Seat;
  readonly controlLeaseId: ControlLeaseId;
}

const DENIED: GameAccessDecision = Object.freeze({ kind: "denied" });
const NO_ACCESS: ClaimDecision = Object.freeze({ kind: "refused", reason: "no_access" });
const REPLAY_DENIED: ReplayAccess = Object.freeze({ kind: "denied" });
const READY_NO_ACCESS: ReadyDecision = Object.freeze({ kind: "refused", reason: "no_access" });
const READY_UNAVAILABLE: ReadyDecision = Object.freeze({ kind: "unavailable" });

/** The writer's answer to a ready mark under the fixed lease, as game access would map it. */
function markReady(
  writers: ControlDirectory,
  found: StaticSeat,
  presence: ReadyPresence,
): Promise<ReadyDecision> {
  const writer = writers.acquire(found.gameId);
  if (writer === null) return Promise.resolve(READY_UNAVAILABLE);
  const done = Promise.withResolvers<ReadyDecision>();
  const ingress = writer.markReady(
    found.seat,
    found.controlLeaseId,
    presence,
    (outcome: ReadyOutcome) => {
      switch (outcome.kind) {
        case "ready":
          done.resolve({ kind: "ready", seat: found.seat, readiness: outcome.readiness });
          return;
        case "started":
          done.resolve({ kind: "started", seat: found.seat });
          return;
        case "refused":
          done.resolve({ kind: "refused", reason: outcome.reason });
          return;
        case "recovery_required":
        case "unavailable":
          done.resolve(READY_UNAVAILABLE);
          return;
      }
    },
  );
  if (!ingress.accepted) done.resolve(READY_UNAVAILABLE);
  return done.promise;
}

/**
 * TEST-ONLY authority: fixed seats whose control this session always holds
 * under a fixed lease. It stands in for game access where a test is about
 * the transport, not about who controls a seat. Ready marks go straight to
 * `writers` under the fixed lease; without writers, ready is unavailable.
 */
export function staticAuthority(
  seats: readonly StaticSeat[],
  writers: ControlDirectory | null = null,
): SessionGameAuthority {
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
    ready: (gameId: GameId, presence: ReadyPresence): Promise<ReadyDecision> => {
      const found = bySeat.get(gameId);
      if (found === undefined) return Promise.resolve(READY_NO_ACCESS);
      if (writers === null) return Promise.resolve(READY_UNAVAILABLE);
      return markReady(writers, found, presence);
    },
    watchControl: () => () => undefined,
    sessionEnded: () => undefined,
  });
}

/** A test session listing and controlling `seats`. */
export function staticSession(
  actorId: PlayerId,
  seats: readonly StaticSeat[],
  writers: ControlDirectory | null = null,
): TrustedSessionContext {
  return {
    actorId,
    games: seats.map(({ gameId, seat }) => ({ gameId, seat })),
    authority: staticAuthority(seats, writers),
  };
}
