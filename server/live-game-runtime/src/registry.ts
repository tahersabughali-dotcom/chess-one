import { err, ok, type Result } from "@chess-one/game-values";
import {
  type ActiveGameState,
  type AwaitingGameIndex,
  type CreateError,
  type GameId,
  type LiveGameRepository,
  type LiveGameWriter,
  type NewAwaitingGame,
  type NewGame,
  type NewGameError,
  type PersistenceFailure,
  startGame,
  storeAwaitingGame,
} from "@chess-one/live-game";
import type { ClockDomain, WakeScheduler, WallClock } from "./clock.ts";
import type { FactSink, RuntimeFact } from "./facts.ts";
import { createSystemWallClock } from "./system.ts";
import type { Activation, GameControlPort, GameWriterPort, WriterLimits } from "./writer-port.ts";
import { InfrastructurePauses, type InfrastructureReason } from "./writer-recovery.ts";
import { GameWriterRuntime } from "./writer-runtime.ts";

export interface RuntimeLimits extends WriterLimits {
  /** Writers held at once by this process; beyond it new games are refused, never queued. */
  readonly maxWriters: number;
}

export const DEFAULT_RUNTIME_LIMITS: RuntimeLimits = Object.freeze({
  maxWriters: 10_000,
  maxQueuedRequests: 32,
  maxSubscribers: 8,
  idleRetireMs: 60_000,
});

export interface RegistryOptions {
  readonly repository: LiveGameRepository;
  readonly clockDomain: ClockDomain;
  readonly scheduler: WakeScheduler;
  readonly facts: FactSink<RuntimeFact>;
  readonly reportDefect: (error: unknown) => void;
  readonly limits?: Partial<RuntimeLimits>;
  /** UTC wall clock for start deadlines; the host's by default. */
  readonly wallClock?: WallClock;
  /** Where `expireAwaitingGames` finds overdue awaiting games; without it, it finds none. */
  readonly awaitingGames?: AwaitingGameIndex;
}

/** What a transport may ask of the registry. */
export interface WriterDirectory {
  acquire(gameId: GameId): GameWriterPort | null;
}

/**
 * What the trusted game-access layer may ask of the registry: a writer that
 * also applies control leases and marks seats ready, and the creation of
 * assigned games, which always await their players.
 */
export interface ControlDirectory {
  acquire(gameId: GameId): GameControlPort | null;
  createAwaitingGame(game: NewAwaitingGame): Promise<Result<StartedGame, StartGameError>>;
}

/**
 * No writer could be held for the game, so it was not created. `game_paused`:
 * this process paused the game id and never resumes it by itself.
 */
export interface WriterRefused {
  readonly kind: "writer_refused";
  readonly reason: "writer_capacity" | "writer_stopped" | "game_paused";
}

/**
 * A create was reported failed. Neither outcome is assumed: a fresh read of
 * the repository settles what is stored.
 * - `stored`: the game exists. Its writer holds it paused as
 *   `PERSISTENCE_UNAVAILABLE`: no clock runs, no command is played, and
 *   recovery is required.
 * - `not_stored`: nothing exists. The writer reservation is released: no
 *   writer, timer, or pause is left.
 * - `unknown`: the read failed too. Only a `CREATE_RECONCILIATION_REQUIRED`
 *   pause is kept, so this process never plays or times the game id and
 *   refuses to start it again; no writer is held.
 */
export type CreateUnconfirmed =
  | {
      readonly kind: "create_unconfirmed";
      readonly reconciliation: "stored";
      readonly activation: Activation;
    }
  | { readonly kind: "create_unconfirmed"; readonly reconciliation: "not_stored" | "unknown" };

export type StartGameError =
  | NewGameError
  | Exclude<CreateError, PersistenceFailure>
  | CreateUnconfirmed
  | WriterRefused;

export interface StartedGame {
  readonly state: ActiveGameState;
  readonly activation: Activation;
}

function refused(reason: WriterRefused["reason"]): WriterRefused {
  return Object.freeze({ kind: "writer_refused", reason });
}

function positiveInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Runtime limit ${name} must be a positive integer`);
  }
  return value;
}

function resolveLimits(overrides: Partial<RuntimeLimits> | undefined): RuntimeLimits {
  const limits = { ...DEFAULT_RUNTIME_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) positiveInteger(name, value);
  return Object.freeze(limits);
}

/**
 * GameWriterRegistry: gameId to exactly one writer runtime, in this process
 * and one clock domain (LIVE-WRITER-OWNERSHIP-001). Two connections to the
 * same game reach the same writer. Nothing here coordinates with another
 * process: a second process over the same database is not a supported
 * deployment. Its writes surface as concurrency conflicts, which pause the
 * game as `CONCURRENCY_OWNERSHIP_UNCERTAIN` and stop its writer; no writer
 * is started again by itself.
 *
 * LIVE-WRITER-ACTIVATION-001: every game created in this process is created
 * through `createAwaitingGame` (or the `startGame` seam), which holds its
 * writer before anything is stored and activates it before returning. An
 * awaiting game enters play only through its writer's start, which arms the
 * running clock's deadline in the same step. A running game is then always
 * watched by its writer, or paused.
 */
export class GameWriterRegistry implements WriterDirectory, ControlDirectory {
  readonly #writers = new Map<GameId, GameWriterRuntime>();
  readonly #pauses = new InfrastructurePauses();
  readonly #options: RegistryOptions;
  readonly #limits: RuntimeLimits;
  readonly #writer: LiveGameWriter;
  readonly #wallClock: WallClock;
  #disposed = false;

  constructor(options: RegistryOptions) {
    this.#options = options;
    this.#limits = resolveLimits(options.limits);
    this.#wallClock = options.wallClock ?? createSystemWallClock();
    this.#writer = Object.freeze({
      repository: options.repository,
      clockDomainId: options.clockDomain.id,
    });
  }

  get clockDomain(): ClockDomain {
    return this.#options.clockDomain;
  }

  get limits(): RuntimeLimits {
    return this.#limits;
  }

  get size(): number {
    return this.#writers.size;
  }

  /** The live runtime of `gameId`, if any, for inspection. */
  peek(gameId: GameId): GameWriterRuntime | undefined {
    return this.#writers.get(gameId);
  }

  /** Why this process paused `gameId`, if it did. */
  infrastructurePause(gameId: GameId): InfrastructureReason | undefined {
    return this.#pauses.reasonOf(gameId);
  }

  acquire(gameId: GameId): GameControlPort | null {
    return this.#runtime(gameId);
  }

  /**
   * Holds the writer of `gameId` and loads the game now, with no connection
   * or command. Repeating it keeps one writer and one deadline timer.
   */
  async activate(gameId: GameId): Promise<Activation> {
    const runtime = this.#runtime(gameId);
    if (runtime === null) return Object.freeze({ kind: "unavailable", reason: this.#refusal() });
    return runtime.activate();
  }

  /**
   * Creates and stores a game whose clock starts now in this registry's clock
   * domain. Its writer is held first, so a game is never stored without one,
   * and activated before this returns, so the deadline is watched with no
   * connection open. A create reported failed is reconciled, never assumed
   * (`CreateUnconfirmed`). A game id this process paused is refused. The
   * trusted caller supplies players and leases. A seam for tests and
   * tooling: no product flow creates a running game (`createAwaitingGame`).
   */
  startGame(
    game: Omit<NewGame, "startedAtMonotonicMs">,
  ): Promise<Result<StartedGame, StartGameError>> {
    return this.#create(game.gameId, true, () =>
      startGame(this.#writer, {
        ...game,
        startedAtMonotonicMs: this.#options.clockDomain.clock.now(),
      }),
    );
  }

  /**
   * Creates and stores a game awaiting its players: no clock runs until both
   * are ready and its writer starts it, and it is aborted at
   * `startDeadlineAtWallMs`. Held, activated, and reconciled exactly as
   * `startGame`, except that a create found stored on reconciliation is not
   * paused: nothing ran, and its stored state is the created one.
   */
  async createAwaitingGame(game: NewAwaitingGame): Promise<Result<StartedGame, StartGameError>> {
    const created = await this.#create(game.gameId, false, () =>
      storeAwaitingGame(this.#writer, game),
    );
    if (created.ok) {
      this.#options.facts.record({ name: "game_awaiting_players", gameId: game.gameId });
    }
    return created;
  }

  /**
   * Maintenance hook for a future scheduler: asks the index for up to
   * `limit` awaiting games whose start deadline has passed and has each one's
   * writer reload it, which aborts it. Returns how many are now aborted.
   * Reads and actions already abort an overdue game without it.
   */
  async expireAwaitingGames(limit: number): Promise<number> {
    const index = this.#options.awaitingGames;
    if (index === undefined || this.#disposed) return 0;
    const due = await index.dueAwaitingGames(this.#wallClock.now(), limit);
    if (!due.ok) {
      this.#options.facts.record({ name: "awaiting_sweep_failed" });
      return 0;
    }
    let aborted = 0;
    for (const gameId of due.value) {
      const activation = await this.activate(gameId);
      if (activation.kind === "stopped" && activation.view.status.kind === "aborted_before_start") {
        aborted += 1;
      }
    }
    return aborted;
  }

  async #create(
    gameId: GameId,
    pauseIfStored: boolean,
    store: () => Promise<Result<ActiveGameState, NewGameError | CreateError>>,
  ): Promise<Result<StartedGame, StartGameError>> {
    if (this.#disposed) return err(refused("writer_stopped"));
    if (this.#pauses.reasonOf(gameId) !== undefined) return err(refused("game_paused"));
    const reserved = !this.#writers.has(gameId);
    const runtime = this.#runtime(gameId);
    if (runtime === null) return err(refused(this.#refusal()));
    const created = await store();
    if (created.ok) {
      const activation = await runtime.activate();
      return ok(Object.freeze({ state: created.value, activation }));
    }
    const { error } = created;
    if (typeof error === "string") {
      if (reserved) await runtime.dispose();
      return err(error);
    }
    if (error.kind === "game_already_exists") {
      await runtime.activate();
      return err(error);
    }
    this.#options.facts.record({ name: "persistence_failure", gameId, operation: "create" });
    return err(await this.#reconcileCreate(runtime, pauseIfStored));
  }

  /** Stops every writer after its job in progress; afterwards nothing is acquired. */
  async dispose(): Promise<void> {
    this.#disposed = true;
    await Promise.all([...this.#writers.values()].map((runtime) => runtime.dispose()));
    this.#writers.clear();
  }

  #refusal(): "writer_capacity" | "writer_stopped" {
    return this.#disposed ? "writer_stopped" : "writer_capacity";
  }

  #runtime(gameId: GameId): GameWriterRuntime | null {
    if (this.#disposed) return null;
    const existing = this.#writers.get(gameId);
    if (existing !== undefined) return existing;
    if (this.#writers.size >= this.#limits.maxWriters) {
      this.#options.facts.record({ name: "writer_capacity_reached" });
      return null;
    }
    const runtime = new GameWriterRuntime({
      gameId,
      writer: this.#writer,
      clock: this.#options.clockDomain.clock,
      wallClock: this.#wallClock,
      scheduler: this.#options.scheduler,
      limits: this.#limits,
      facts: this.#options.facts,
      pauses: this.#pauses,
      reportDefect: this.#options.reportDefect,
      onRetired: (retired) => {
        if (this.#writers.get(retired.gameId) === retired) this.#writers.delete(retired.gameId);
      },
    });
    this.#writers.set(gameId, runtime);
    this.#options.facts.record({ name: "writer_created", gameId });
    return runtime;
  }

  /**
   * The reconciliation read goes to the repository itself, outside the
   * writer's queue, on a fresh connection of its pool. Whatever it finds,
   * the writer was never activated, so no deadline was armed meanwhile.
   */
  async #reconcileCreate(
    runtime: GameWriterRuntime,
    pauseIfStored: boolean,
  ): Promise<CreateUnconfirmed> {
    const { gameId } = runtime;
    const read = await this.#options.repository.loadGame(gameId);
    if (!read.ok && read.error.kind === "game_not_found") {
      this.#options.facts.record({ name: "create_reconciled", gameId, outcome: "not_stored" });
      await runtime.dispose();
      return Object.freeze({ kind: "create_unconfirmed", reconciliation: "not_stored" });
    }
    if (!read.ok && read.error.kind === "persistence_failure") {
      this.#options.facts.record({ name: "create_reconciled", gameId, outcome: "unknown" });
      const reason = "CREATE_RECONCILIATION_REQUIRED";
      if (this.#pauses.add(gameId, reason)) {
        this.#options.facts.record({ name: "infrastructure_pause_entered", gameId, reason });
      }
      await runtime.dispose();
      return Object.freeze({ kind: "create_unconfirmed", reconciliation: "unknown" });
    }
    this.#options.facts.record({ name: "create_reconciled", gameId, outcome: "stored" });
    if (pauseIfStored) runtime.pause("PERSISTENCE_UNAVAILABLE");
    const activation = await runtime.activate();
    return Object.freeze({ kind: "create_unconfirmed", reconciliation: "stored", activation });
  }
}
