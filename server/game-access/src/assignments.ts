import type { AccountDirectory, AccountStanding, Outcome } from "@chess-one/accounts";
import type { UserId } from "@chess-one/identity";
import {
  type Activation,
  type ControlDirectory,
  type GameId,
  isPlayerId,
  type PlayerId,
  type Seat,
  type SyncOutcome,
  type TimeControl,
} from "@chess-one/live-game-runtime";
import type { GameAccessFactSink } from "./facts.ts";
import { newControlLease } from "./leases.ts";
import type { GameAccessStore } from "./ports.ts";

export interface AssignedGameRequest {
  readonly gameId: GameId;
  readonly white: UserId;
  readonly black: UserId;
  readonly timeControl: TimeControl;
}

export interface AssignmentPolicy {
  /**
   * Hook for rated play (AUTH-EMAIL-VERIFIED-001): refuse accounts whose
   * email address is unverified. Off: no rated game exists yet.
   */
  readonly requireVerifiedEmail: boolean;
}

export const DEFAULT_ASSIGNMENT_POLICY: AssignmentPolicy = Object.freeze({
  requireVerifiedEmail: false,
});

export interface AssignedGame {
  readonly gameId: GameId;
  readonly players: Readonly<Record<Seat, PlayerId>>;
  readonly activation: Activation;
}

/**
 * `creation_unconfirmed`: the outcome is not fully known and is never
 * reported as success. `stored`: the game exists (and may be paused) but its
 * assignment could not be marked confirmed; `unknown`: whether the game was
 * stored is unknown. Both leave a pending assignment for
 * `reconcileAssignment`.
 */
export type AssignedGameError =
  | { readonly kind: "same_user" }
  | { readonly kind: "user_not_found"; readonly seat: Seat }
  | { readonly kind: "user_not_active"; readonly seat: Seat }
  | { readonly kind: "email_not_verified"; readonly seat: Seat }
  | { readonly kind: "game_already_assigned" }
  | { readonly kind: "start_refused"; readonly reason: string }
  | { readonly kind: "creation_unconfirmed"; readonly reconciliation: "stored" | "unknown" }
  | { readonly kind: "unavailable" };

export interface AssignmentDeps {
  readonly store: GameAccessStore;
  readonly accounts: AccountDirectory;
  readonly writers: ControlDirectory;
  readonly facts: GameAccessFactSink;
  readonly reportDefect: (error: unknown) => void;
  readonly policy: AssignmentPolicy;
}

const SEATS: readonly Seat[] = ["white", "black"];
const FAILED: unique symbol = Symbol("failed");

/** Runs `work`; a thrown error is reported and becomes FAILED, so the caller fails closed. */
async function attempt<T>(
  deps: AssignmentDeps,
  work: () => Promise<T>,
): Promise<T | typeof FAILED> {
  try {
    return await work();
  } catch (error: unknown) {
    deps.reportDefect(error);
    return FAILED;
  }
}

function standingRefusal(
  seat: Seat,
  standing: AccountStanding | null,
  policy: AssignmentPolicy,
): AssignedGameError | null {
  if (standing === null) return { kind: "user_not_found", seat };
  if (standing.status !== "active") return { kind: "user_not_active", seat };
  if (policy.requireVerifiedEmail && !standing.emailVerified) {
    return { kind: "email_not_verified", seat };
  }
  return null;
}

/**
 * The trusted internal use case that creates a playable game between two
 * accounts (there is no public endpoint). Order, so a game never runs
 * without both players able to reach it:
 *
 * 1. both accounts exist, differ, and are active (and verified, if required);
 * 2. the assignment and both seat-control rows, with fresh leases and no
 *    controller, in one transaction (pending);
 * 3. the live game, created and activated through the writer registry with
 *    the same players and leases;
 * 4. the assignment marked confirmed.
 *
 * The two stores are separate transactions, so the gap is closed by
 * compensation and reconciliation, never by assuming: a start that surely
 * stored nothing deletes the pending assignment; one whose outcome is
 * unknown keeps it pending and answers `creation_unconfirmed`.
 */
export async function createAssignedGame(
  deps: AssignmentDeps,
  request: AssignedGameRequest,
): Promise<Outcome<AssignedGame, AssignedGameError>> {
  const { gameId } = request;
  const fail = (error: AssignedGameError): Outcome<AssignedGame, AssignedGameError> => {
    deps.facts.record({ name: "game_assignment_failed", gameId, reason: error.kind });
    return { ok: false, error };
  };
  if (request.white === request.black) return fail({ kind: "same_user" });
  const userIds: Readonly<Record<Seat, UserId>> = { white: request.white, black: request.black };
  for (const seat of SEATS) {
    const standing = await attempt(deps, () => deps.accounts.accountStanding(userIds[seat]));
    if (standing === FAILED) return fail({ kind: "unavailable" });
    const refusal = standingRefusal(seat, standing, deps.policy);
    if (refusal !== null) return fail(refusal);
  }
  const { white, black } = request;
  if (!isPlayerId(white)) return fail({ kind: "user_not_found", seat: "white" });
  if (!isPlayerId(black)) return fail({ kind: "user_not_found", seat: "black" });
  const players: Readonly<Record<Seat, PlayerId>> = Object.freeze({ white, black });
  const leases = Object.freeze({ white: newControlLease(), black: newControlLease() });

  const reserved = await attempt(deps, () =>
    deps.store.reserveAssignment({ gameId, players, leases }),
  );
  if (reserved === FAILED) return fail({ kind: "unavailable" });
  if (reserved === "already_assigned") return fail({ kind: "game_already_assigned" });

  const started = await deps.writers.startGame({
    gameId,
    players,
    controlLeases: leases,
    timeControl: request.timeControl,
  });
  if (started.ok) {
    if ((await attempt(deps, () => deps.store.confirmAssignment(gameId))) === FAILED) {
      return fail({ kind: "creation_unconfirmed", reconciliation: "stored" });
    }
    deps.facts.record({ name: "game_assignment_created", gameId });
    return { ok: true, value: { gameId, players, activation: started.value.activation } };
  }
  const { error } = started;
  if (typeof error === "string") {
    await attempt(deps, () => deps.store.discardPendingAssignment(gameId));
    return fail({ kind: "start_refused", reason: error });
  }
  switch (error.kind) {
    case "game_already_exists":
      await attempt(deps, () => deps.store.discardPendingAssignment(gameId));
      return fail({ kind: "start_refused", reason: error.kind });
    case "writer_refused":
      await attempt(deps, () => deps.store.discardPendingAssignment(gameId));
      return fail({ kind: "start_refused", reason: error.reason });
    case "create_unconfirmed":
      if (error.reconciliation === "not_stored") {
        await attempt(deps, () => deps.store.discardPendingAssignment(gameId));
        return fail({ kind: "unavailable" });
      }
      if (error.reconciliation === "stored") {
        await attempt(deps, () => deps.store.confirmAssignment(gameId));
        return fail({ kind: "creation_unconfirmed", reconciliation: "stored" });
      }
      return fail({ kind: "creation_unconfirmed", reconciliation: "unknown" });
  }
}

export type ReconciliationOutcome = "confirmed" | "discarded" | "unknown" | "none";

/**
 * Settles a pending assignment against the live game: stored means
 * confirmed, surely absent means discarded, and anything else leaves it
 * pending. A confirmed assignment is never touched.
 */
export async function reconcileAssignment(
  deps: AssignmentDeps,
  gameId: GameId,
): Promise<ReconciliationOutcome> {
  const assignment = await attempt(deps, () => deps.store.findAssignment(gameId));
  if (assignment === FAILED) return "unknown";
  if (assignment === null) return "none";
  if (assignment.state === "confirmed") return "confirmed";
  const stored = await liveGameStored(deps.writers, gameId);
  let outcome: "confirmed" | "discarded" | "unknown" = "unknown";
  if (stored === "stored") {
    const confirmed = await attempt(deps, () => deps.store.confirmAssignment(gameId));
    if (confirmed !== FAILED) outcome = "confirmed";
  } else if (stored === "absent") {
    const discarded = await attempt(deps, () => deps.store.discardPendingAssignment(gameId));
    if (discarded !== FAILED) outcome = "discarded";
  }
  deps.facts.record({ name: "game_assignment_reconciled", gameId, outcome });
  return outcome;
}

/**
 * Only a snapshot proves the game is stored (a game paused by a clock-domain
 * change still loads as one); `recovery_required` means the load itself
 * failed or the id is paused in this process, which proves nothing.
 */
function liveGameStored(
  writers: ControlDirectory,
  gameId: GameId,
): Promise<"stored" | "absent" | "unknown"> {
  const writer = writers.acquire(gameId);
  if (writer === null) return Promise.resolve("unknown");
  const done = Promise.withResolvers<"stored" | "absent" | "unknown">();
  const ingress = writer.requestSync((outcome: SyncOutcome) => {
    if (outcome.kind === "snapshot") done.resolve("stored");
    else if (outcome.kind === "unavailable" && outcome.reason === "game_not_found") {
      done.resolve("absent");
    } else done.resolve("unknown");
  });
  if (!ingress.accepted) done.resolve("unknown");
  return done.promise;
}
