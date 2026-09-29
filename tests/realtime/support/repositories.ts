import { err, type Result } from "@chess-one/game-values";
import type {
  ActiveGameState,
  ClockDomainId,
  CommitError,
  CommitPlan,
  CommitReceipt,
  CreateError,
  GameId,
  LiveGameRepository,
  LoadError,
  StoredGame,
} from "@chess-one/live-game";

export type CommitFault =
  | "none"
  /** The commit is not applied and a driver failure is reported. */
  | "fail"
  /** The commit is applied, but the driver reports a failure: the outcome is ambiguous. */
  | "apply_then_fail"
  /** Another writer moved the stored sequence. */
  | "conflict";

/**
 * TEST ADAPTER over any repository (the contract double or PostgreSQL). It
 * can hold loads until released and inject commit faults, so tests control
 * the writer's timing and the database's failures without touching either.
 */
export class ControlledRepository implements LiveGameRepository {
  readonly #inner: LiveGameRepository;
  #gate: PromiseWithResolvers<void> | null = null;
  commitFault: CommitFault = "none";
  createFault: "none" | "fail" | "apply_then_fail" = "none";
  loadFault = false;
  /** A load throws instead of returning a result: a defect, not a reported failure. */
  loadThrows = false;
  commits = 0;
  creates = 0;
  /**
   * Runs once before the next commit reaches the repository underneath, after
   * the writer loaded and decided: another writer may commit here, so the
   * stored sequence really moves under this one.
   */
  beforeCommit: (() => Promise<void>) | null = null;

  constructor(inner: LiveGameRepository) {
    this.#inner = inner;
  }

  /** Loads wait until `release`. */
  hold(): void {
    this.#gate ??= Promise.withResolvers<void>();
  }

  release(): void {
    this.#gate?.resolve();
    this.#gate = null;
  }

  /** Loads currently waiting at the gate. */
  heldLoads = 0;
  loads = 0;

  async loadGame(gameId: GameId): Promise<Result<StoredGame, LoadError>> {
    this.loads += 1;
    if (this.#gate !== null) {
      this.heldLoads += 1;
      await this.#gate.promise;
      this.heldLoads -= 1;
    }
    if (this.loadThrows) throw new Error("injected repository defect");
    if (this.loadFault) return err({ kind: "persistence_failure", operation: "load", code: null });
    return this.#inner.loadGame(gameId);
  }

  async createGame(
    state: ActiveGameState,
    clockDomainId: ClockDomainId,
  ): Promise<Result<null, CreateError>> {
    this.creates += 1;
    const failure: Result<null, CreateError> = err({
      kind: "persistence_failure",
      operation: "create",
      code: "08006",
    });
    switch (this.createFault) {
      case "fail":
        return failure;
      case "apply_then_fail":
        await this.#inner.createGame(state, clockDomainId);
        return failure;
      case "none":
        return this.#inner.createGame(state, clockDomainId);
    }
  }

  async commitDecision(
    plan: CommitPlan,
    clockDomainId: ClockDomainId,
  ): Promise<Result<CommitReceipt, CommitError>> {
    const interleave = this.beforeCommit;
    this.beforeCommit = null;
    if (interleave !== null) await interleave();
    switch (this.commitFault) {
      case "fail":
        return err({ kind: "persistence_failure", operation: "commit", code: "08006" });
      case "conflict":
        return err({ kind: "concurrency_conflict", expectedSequence: plan.expectedSequence });
      case "apply_then_fail": {
        const applied = await this.#inner.commitDecision(plan, clockDomainId);
        if (applied.ok) this.commits += 1;
        return err({ kind: "persistence_failure", operation: "commit", code: "08006" });
      }
      case "none": {
        const committed = await this.#inner.commitDecision(plan, clockDomainId);
        if (committed.ok) this.commits += 1;
        return committed;
      }
    }
  }
}
