import type { GameCondition, GameId } from "@chess-one/live-game";

/**
 * Why this process stopped serving a game (LIVE-RETRY-RECEIPT-001):
 * - `PERSISTENCE_UNAVAILABLE`: a load, commit, or create failed;
 * - `WRITER_FAULT`: the writer hit an unexpected exception and stopped;
 * - `CONCURRENCY_OWNERSHIP_UNCERTAIN`: the stored sequence moved under the
 *   writer, so another writer may own the game (LIVE-WRITER-OWNERSHIP-001);
 *   the database itself may be healthy;
 * - `CREATE_RECONCILIATION_REQUIRED`: a create reported failed and the
 *   reconciliation read could not tell whether it was stored.
 * Nothing about any of them is stored; the game record keeps its last
 * durable state and balances.
 */
export type InfrastructureReason =
  | "PERSISTENCE_UNAVAILABLE"
  | "WRITER_FAULT"
  | "CONCURRENCY_OWNERSHIP_UNCERTAIN"
  | "CREATE_RECONCILIATION_REQUIRED";

const OWNERSHIP_UNCERTAIN: InfrastructureReason = "CONCURRENCY_OWNERSHIP_UNCERTAIN";

/**
 * Why a game is out of play until an operator recovery
 * (LIVE-RECOVERY-RESUME-001, still open): the stored clock anchor belongs to
 * another clock domain (a restart; durable in the game record), or an
 * infrastructure failure in this process.
 */
export type RecoveryReason = "RECOVERY_PAUSED_CLOCK_DOMAIN_CHANGED" | InfrastructureReason;

/**
 * A durably running game that this process stopped serving after an
 * infrastructure failure. Its balances are the last committed ones: the time
 * since that commit, the outage, and any retry are never charged. It is not
 * finished and has no result.
 */
export interface InfrastructurePaused {
  readonly kind: "infrastructure_paused";
  readonly reason: InfrastructureReason;
}

/** The condition a writer serves: the durable condition, or the pause over it. */
export type WriterCondition = GameCondition | InfrastructurePaused;

export function infrastructurePaused(reason: InfrastructureReason): InfrastructurePaused {
  return Object.freeze({ kind: "infrastructure_paused", reason });
}

/** The recovery a condition needs, or null for a game in play or stopped. */
export function recoveryReasonOf(condition: WriterCondition): RecoveryReason | null {
  switch (condition.kind) {
    case "recovery_paused":
      return condition.reason;
    case "infrastructure_paused":
      return condition.reason;
    case "running":
    case "finished":
    case "rules_unresolved":
      return null;
  }
}

/**
 * An infrastructure pause overrides a running game: a finished or unresolved
 * game has no clock to protect, and a clock-domain pause already stops the
 * clock. Uncertain ownership overrides every condition, so no command of any
 * kind is written while another writer may own the game.
 */
export function effectiveCondition(
  durable: GameCondition,
  paused: InfrastructureReason | undefined,
): WriterCondition {
  if (paused === undefined) return durable;
  return durable.kind === "running" || paused === OWNERSHIP_UNCERTAIN
    ? infrastructurePaused(paused)
    : durable;
}

/**
 * Games this process paused after an infrastructure failure. The registry
 * owns it, so a pause outlives the writer that entered it (idle retirement,
 * a stop) and binds every later writer of the game in this process. Nothing
 * removes an entry: there is no automatic resume, even after the database
 * answers again. A new process starts in a new clock domain, where the
 * stored anchor already pauses every running game.
 */
export class InfrastructurePauses {
  readonly #paused = new Map<GameId, InfrastructureReason>();

  get size(): number {
    return this.#paused.size;
  }

  reasonOf(gameId: GameId): InfrastructureReason | undefined {
    return this.#paused.get(gameId);
  }

  /**
   * True when the entry changed. The first reason is kept, except that
   * uncertain ownership replaces any other: it stops more.
   */
  add(gameId: GameId, reason: InfrastructureReason): boolean {
    const existing = this.#paused.get(gameId);
    if (existing === reason) return false;
    if (existing !== undefined && reason !== OWNERSHIP_UNCERTAIN) return false;
    this.#paused.set(gameId, reason);
    return true;
  }
}
