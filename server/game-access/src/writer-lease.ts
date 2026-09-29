import type {
  ControlDirectory,
  ControlLeaseId,
  GameId,
  GameLifecycle,
  LeaseOutcome,
  ReadyOutcome,
  ReadyPresence,
  Seat,
  SyncOutcome,
} from "@chess-one/live-game-runtime";
import { lifecycleOf } from "@chess-one/live-game-runtime";

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

/** Marks the seat ready at the writer and waits for the outcome. */
export function markReady(
  writers: ControlDirectory,
  gameId: GameId,
  seat: Seat,
  lease: ControlLeaseId,
  presence: ReadyPresence,
): Promise<ReadyOutcome> {
  const writer = writers.acquire(gameId);
  const unavailable: ReadyOutcome = { kind: "unavailable", reason: "temporarily_unavailable" };
  if (writer === null) return Promise.resolve(unavailable);
  const done = Promise.withResolvers<ReadyOutcome>();
  const ingress = writer.markReady(seat, lease, presence, done.resolve);
  if (!ingress.accepted) done.resolve(unavailable);
  return done.promise;
}

export type GameOpenness = "open" | "closed" | "unavailable";

/**
 * The game's lifecycle, read through its writer (which aborts an awaiting
 * game whose start deadline has passed as it loads it). `recovery_required`
 * means play is paused, which is not an ended game: `paused`.
 */
export function gameLifecycle(
  writers: ControlDirectory,
  gameId: GameId,
): Promise<GameLifecycle | "paused" | "unavailable"> {
  const writer = writers.acquire(gameId);
  if (writer === null) return Promise.resolve("unavailable");
  const done = Promise.withResolvers<GameLifecycle | "paused" | "unavailable">();
  const ingress = writer.requestSync((outcome: SyncOutcome) => {
    if (outcome.kind === "snapshot") done.resolve(lifecycleOf(outcome.view.status));
    else if (outcome.kind === "recovery_required") done.resolve("paused");
    else done.resolve("unavailable");
  });
  if (!ingress.accepted) {
    done.resolve(ingress.reason === "infrastructure_paused" ? "paused" : "unavailable");
  }
  return done.promise;
}

/**
 * Whether seats may still be claimed: a game awaiting its players or in
 * progress, even if paused for a recovery. Finished, rules-unresolved, and
 * aborted games are closed to claims.
 */
export async function gameOpenness(
  writers: ControlDirectory,
  gameId: GameId,
): Promise<GameOpenness> {
  const lifecycle = await gameLifecycle(writers, gameId);
  switch (lifecycle) {
    case "awaiting_players":
    case "in_progress":
    case "paused":
      return "open";
    case "ended":
    case "aborted_before_start":
      return "closed";
    case "unavailable":
      return "unavailable";
  }
}
