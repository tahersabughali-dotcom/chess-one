import type {
  ControlDirectory,
  ControlLeaseId,
  GameId,
  LeaseOutcome,
  Seat,
  SyncOutcome,
} from "@chess-one/live-game-runtime";

export type Applied = "applied" | "not_applied";

/** Makes `lease` the writer's lease for the seat and waits for the outcome. */
export function applyLease(
  writers: ControlDirectory,
  gameId: GameId,
  seat: Seat,
  lease: ControlLeaseId,
): Promise<Applied> {
  const writer = writers.acquire(gameId);
  if (writer === null) return Promise.resolve("not_applied");
  const done = Promise.withResolvers<Applied>();
  const ingress = writer.applyControlLease(seat, lease, (outcome: LeaseOutcome) =>
    done.resolve(outcome.kind === "applied" ? "applied" : "not_applied"),
  );
  if (!ingress.accepted) done.resolve("not_applied");
  return done.promise;
}

export type GameOpenness = "open" | "closed" | "unavailable";

/**
 * Whether the game still takes commands: active, even if paused for a
 * recovery. Finished and rules-unresolved games are closed to claims.
 */
export function gameOpenness(writers: ControlDirectory, gameId: GameId): Promise<GameOpenness> {
  const writer = writers.acquire(gameId);
  if (writer === null) return Promise.resolve("unavailable");
  const done = Promise.withResolvers<GameOpenness>();
  const ingress = writer.requestSync((outcome: SyncOutcome) => {
    if (outcome.kind === "snapshot") {
      done.resolve(outcome.view.status.kind === "active" ? "open" : "closed");
    } else if (outcome.kind === "recovery_required") {
      done.resolve("open");
    } else {
      done.resolve("unavailable");
    }
  });
  if (!ingress.accepted) {
    done.resolve(ingress.reason === "infrastructure_paused" ? "open" : "unavailable");
  }
  return done.promise;
}
