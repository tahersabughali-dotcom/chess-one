import { err } from "@chess-one/game-values";
import {
  type ActiveGameState,
  type AuthorizedGameActor,
  abortIfStartDeadlinePassed,
  type CommitError,
  type CommitPlan,
  type ControlLeaseId,
  commitLifecycle,
  type ExecutionError,
  executeCommand,
  executeDeadline,
  executeLeaseRotation,
  type GameId,
  type GameParticipant,
  gameCondition,
  historicalReplay,
  type LeaselessCommand,
  type LeaseRotationFailure,
  type LifecycleDecision,
  type LiveGameCommand,
  type LiveGameRepository,
  type LiveGameWriter,
  type LoadError,
  loadForWriter,
  type MonotonicMs,
  type Seat,
  startAwaitingGame,
} from "@chess-one/live-game";
import { BoundedQueue } from "./bounded-queue.ts";
import type { MonotonicClock, WakeHandle, WakeScheduler, WallClock } from "./clock.ts";
import { DeadlineWatch, lateInstant } from "./deadline-watch.ts";
import type { FactSink, RetireReason, RuntimeFact } from "./facts.ts";
import { type GameView, viewOf } from "./game-view.ts";
import { ReadyMarks } from "./readiness.ts";
import {
  type Activation,
  activationOf,
  type CommandIngress,
  type CommandLookup,
  type CommandOutcome,
  type ControlNotHeld,
  type GameControlPort,
  type GameSubscriber,
  type IngressRefused,
  type LeaseOutcome,
  type NotInPlay,
  type Readiness,
  type ReadyOutcome,
  type ReadyPresence,
  type ReadyRefusal,
  type RecoveryRequired,
  type ReplayOutcome,
  type SubscribeResult,
  type SyncIngress,
  type SyncOutcome,
  type Unavailable,
  type UnavailableReason,
  type WriterLimits,
} from "./writer-port.ts";
import {
  effectiveCondition,
  type InfrastructurePauses,
  type InfrastructureReason,
  infrastructurePaused,
  type RecoveryReason,
  type WriterCondition,
} from "./writer-recovery.ts";

type Job =
  | {
      readonly kind: "command";
      readonly actor: AuthorizedGameActor;
      readonly command: LiveGameCommand;
      readonly receivedAt: MonotonicMs;
      readonly reply: (outcome: CommandOutcome) => void;
    }
  | {
      readonly kind: "lookup";
      readonly actor: AuthorizedGameActor;
      readonly command: LiveGameCommand;
      readonly reply: (outcome: CommandOutcome) => void;
    }
  | { readonly kind: "sync"; readonly reply: (outcome: SyncOutcome) => void }
  | { readonly kind: "deadline"; readonly observedAt: MonotonicMs }
  | {
      readonly kind: "lease";
      readonly seat: Seat;
      readonly lease: ControlLeaseId;
      readonly reply: (outcome: LeaseOutcome) => void;
    }
  | {
      readonly kind: "replay";
      readonly participant: GameParticipant;
      readonly command: LeaselessCommand;
      readonly reply: (outcome: ReplayOutcome) => void;
    }
  | {
      readonly kind: "ready";
      readonly seat: Seat;
      readonly lease: ControlLeaseId;
      readonly presence: ReadyPresence;
      readonly reply: (outcome: ReadyOutcome) => void;
    }
  /** The start deadline of an awaiting game may have passed; uses the deadline check's slot. */
  | { readonly kind: "start_deadline" };

export interface WriterRuntimeOptions {
  readonly gameId: GameId;
  readonly writer: LiveGameWriter;
  readonly clock: MonotonicClock;
  /** UTC wall clock for the start deadline of an awaiting game; nothing else reads it. */
  readonly wallClock: WallClock;
  readonly scheduler: WakeScheduler;
  readonly limits: WriterLimits;
  readonly facts: FactSink<RuntimeFact>;
  /** Shared by every writer of the registry; a pause outlives its writer. */
  readonly pauses: InfrastructurePauses;
  /** Receives unexpected exceptions; the writer has already stopped or dropped the culprit. */
  readonly reportDefect: (error: unknown) => void;
  readonly onRetired: (runtime: GameWriterRuntime, reason: RetireReason) => void;
}

const QUEUE_FULL: IngressRefused = Object.freeze({ accepted: false, reason: "queue_full" });
const STOPPED: IngressRefused = Object.freeze({ accepted: false, reason: "writer_stopped" });
const CONTROL_NOT_HELD: ControlNotHeld = Object.freeze({
  accepted: false,
  reason: "control_not_held",
});
const NOT_HELD_OUTCOME: { readonly kind: "control_not_held" } = Object.freeze({
  kind: "control_not_held",
});
const IDENTITY_CONFLICT_OUTCOME: { readonly kind: "identity_conflict" } = Object.freeze({
  kind: "identity_conflict",
});
const APPLIED: LeaseOutcome = Object.freeze({ kind: "applied" });
const SYNC_ACCEPTED: SyncIngress = Object.freeze({ accepted: true });
const NOBODY_READY: Readiness = Object.freeze({ white: false, black: false });

/** The lifecycle of a game not in play, or null for one that started. */
function notInPlayOf(state: ActiveGameState | null): NotInPlay["lifecycle"] | null {
  const kind = state?.status.kind;
  return kind === "awaiting_players" || kind === "aborted_before_start" ? kind : null;
}

function unavailable(reason: UnavailableReason): Unavailable {
  return Object.freeze({ kind: "unavailable", reason });
}

function participantOf(actor: AuthorizedGameActor): GameParticipant {
  return Object.freeze({ gameId: actor.gameId, playerId: actor.playerId, seat: actor.seat });
}

/** Seats are `white` and `black`, so the key is unambiguous for any command id text. */
function waitKey(seat: Seat, command: LiveGameCommand): string {
  return `${seat} ${command.clientCommandId}`;
}

/** The stored game after `plan` was committed on top of `known`. */
function knownAfter(known: ActiveGameState | null, plan: CommitPlan): ActiveGameState | null {
  if (plan.kind !== "bind_only") return plan.state;
  if (known === null) return null;
  return Object.freeze({
    ...known,
    commandBindings: Object.freeze([...known.commandBindings, plan.binding]),
  });
}

/** Each request is answered at most once, whatever path answers it. */
function once<T>(reply: (outcome: T) => void): (outcome: T) => void {
  let answered = false;
  return (outcome) => {
    if (answered) return;
    answered = true;
    reply(outcome);
  };
}

/**
 * The one authoritative writer of one game in this process
 * (LIVE-WRITER-OWNERSHIP-001: in-process only). Every command, sync, and
 * deadline check passes through one bounded FIFO and runs one at a time, so
 * processing order is the order of the monotonic stamps. State is loaded
 * from the repository for every job, and every decision is made on that
 * load. Besides the last sequence it published and the condition it last
 * observed, the writer keeps the game as it last loaded or committed it,
 * only to route ingress: the seats' leases and the stored bindings.
 */
export class GameWriterRuntime implements GameControlPort {
  readonly gameId: GameId;
  readonly #writer: LiveGameWriter;
  readonly #clock: MonotonicClock;
  readonly #wallClock: WallClock;
  readonly #scheduler: WakeScheduler;
  readonly #limits: WriterLimits;
  readonly #facts: FactSink<RuntimeFact>;
  readonly #pauses: InfrastructurePauses;
  readonly #reportDefect: (error: unknown) => void;
  readonly #onRetired: (runtime: GameWriterRuntime, reason: RetireReason) => void;
  /** One slot beyond the request limit is reserved for the single deadline check. */
  readonly #queue: BoundedQueue<Job>;
  readonly #subscribers = new Set<GameSubscriber>();
  readonly #deadline: DeadlineWatch;
  #status: "active" | "stopping" | "stopped" = "active";
  #stopReason: RetireReason | null = null;
  #requests = 0;
  #deadlineQueued = false;
  #busy = false;
  #current: Job | null = null;
  #draining: Promise<void> = Promise.resolve();
  #loaded = false;
  /** Null until the first successful load, unless the registry already holds a pause. */
  #condition: WriterCondition | null;
  #lastPublished = -1;
  /** The stored sequence the job in progress read. */
  #lastLoaded = -1;
  #lastLoadFailure: Unavailable | RecoveryRequired = unavailable("temporarily_unavailable");
  #idleTimer: WakeHandle | null = null;
  /**
   * The game as this writer last loaded or committed it; null before the
   * first load. Only this writer writes the game, and it updates this on
   * every load and every commit, so it is the stored game as of the job last
   * run. It routes ingress only; no decision is made on it.
   */
  #known: ActiveGameState | null = null;
  /**
   * Command ids of the command and lookup jobs in the queue or in progress,
   * per seat, with their counts: a job that may still bind the id. At most
   * the queue's size.
   */
  readonly #waiting = new Map<string, number>();
  /** Rotations waiting in the queue, per seat (at most two keys), and the lease the last one sets. */
  readonly #queuedRotations = new Map<
    Seat,
    { readonly lease: ControlLeaseId; readonly count: number }
  >();
  /** Ready marks while the game awaits its players: memory only, at most one per seat. */
  readonly #ready = new ReadyMarks();
  /** The wake-up for the start deadline of an awaiting game, if armed. */
  #startWake: WakeHandle | null = null;

  constructor(options: WriterRuntimeOptions) {
    this.gameId = options.gameId;
    this.#writer = Object.freeze({
      clockDomainId: options.writer.clockDomainId,
      repository: this.#owned(options.writer.repository),
    });
    this.#clock = options.clock;
    this.#wallClock = options.wallClock;
    this.#scheduler = options.scheduler;
    this.#limits = options.limits;
    this.#facts = options.facts;
    this.#pauses = options.pauses;
    this.#reportDefect = options.reportDefect;
    this.#onRetired = options.onRetired;
    this.#queue = new BoundedQueue<Job>(options.limits.maxQueuedRequests + 1);
    this.#deadline = new DeadlineWatch(options.clock, options.scheduler, () =>
      this.#deadlineWake(),
    );
    const paused = options.pauses.reasonOf(options.gameId);
    this.#condition = paused === undefined ? null : infrastructurePaused(paused);
  }

  get subscriberCount(): number {
    return this.#subscribers.size;
  }

  get queuedRequests(): number {
    return this.#requests;
  }

  get stopped(): boolean {
    return this.#status !== "active";
  }

  /** True while a wake-up or a queued check waits for the running clock's deadline. */
  get deadlineArmed(): boolean {
    return this.#deadline.armed || this.#deadlineQueued;
  }

  /** True while a wake-up waits for the start deadline of an awaiting game. */
  get startDeadlineArmed(): boolean {
    return this.#startWake !== null;
  }

  /** The condition this writer serves, or null before its first load. */
  get condition(): WriterCondition | null {
    return this.#condition;
  }

  subscribe(subscriber: GameSubscriber): SubscribeResult {
    if (this.#status !== "active") return "writer_stopped";
    if (this.#subscribers.has(subscriber)) return "already_subscribed";
    if (this.#subscribers.size >= this.#limits.maxSubscribers) return "limit_reached";
    this.#subscribers.add(subscriber);
    this.#cancelIdle();
    return "subscribed";
  }

  unsubscribe(subscriber: GameSubscriber): void {
    if (this.#subscribers.delete(subscriber)) this.#considerRetiring();
  }

  /**
   * While play is paused a command is refused before it is stamped: it is
   * not received, reaches no queue, touches no repository, and its command id
   * stays unbound. A command id bound or not yet ruled out is taken as a
   * lookup, with no clock reading (`CommandLookup`). Any other command is
   * refused when its lease is not the seat's lease as of the end of the
   * queue, and otherwise received: stamped now, before any repository work.
   */
  submitCommand(
    actor: AuthorizedGameActor,
    command: LiveGameCommand,
    reply: (outcome: CommandOutcome) => void,
  ): CommandIngress {
    if (actor.gameId !== this.gameId)
      throw new Error("Writer runtime defect: actor of another game");
    if (this.#status === "active" && this.#condition?.kind === "infrastructure_paused") {
      this.#facts.record({ name: "command_refused_paused", gameId: this.gameId });
      return Object.freeze({
        accepted: false,
        reason: "infrastructure_paused",
        recovery: this.#condition.reason,
      });
    }
    const lookup = this.#lookupOf(actor, command);
    if (lookup === null && this.#status === "active" && !this.#admits(actor, command)) {
      this.#facts.record({ name: "command_refused_control", gameId: this.gameId });
      return CONTROL_NOT_HELD;
    }
    const lifecycle = notInPlayOf(this.#known);
    if (lookup === null && this.#status === "active" && lifecycle !== null) {
      this.#facts.record({ name: "command_refused_not_started", gameId: this.gameId });
      return Object.freeze({ accepted: false, reason: "not_in_play", lifecycle });
    }
    const refused = this.#refusal();
    if (refused !== null) return refused;
    if (lookup !== null) {
      this.#enqueue({ kind: "lookup", actor, command, reply: once(reply) });
      return Object.freeze({ accepted: true, receivedAt: null, lookup });
    }
    const receivedAt = this.#clock.now();
    this.#enqueue({ kind: "command", actor, command, receivedAt, reply: once(reply) });
    return Object.freeze({ accepted: true, receivedAt });
  }

  /** A sync is served while paused: it reads, and never changes the game. */
  requestSync(reply: (outcome: SyncOutcome) => void): SyncIngress {
    const refused = this.#refusal();
    if (refused !== null) return refused;
    this.#enqueue({ kind: "sync", reply: once(reply) });
    return SYNC_ACCEPTED;
  }

  replayCommand(
    participant: GameParticipant,
    command: LeaselessCommand,
    reply: (outcome: ReplayOutcome) => void,
  ): SyncIngress {
    if (participant.gameId !== this.gameId)
      throw new Error("Writer runtime defect: participant of another game");
    const refused = this.#refusal();
    if (refused !== null) return refused;
    this.#enqueue({ kind: "replay", participant, command, reply: once(reply) });
    return SYNC_ACCEPTED;
  }

  /**
   * From the moment this returns accepted, only `lease` admits commands for
   * `seat`. A lease that is already the seat's, with no rotation queued, is
   * answered at once, in any condition. Otherwise, while play is paused for
   * an infrastructure failure nothing is written and the rotation is refused.
   */
  applyControlLease(
    seat: Seat,
    lease: ControlLeaseId,
    reply: (outcome: LeaseOutcome) => void,
  ): SyncIngress {
    const refused = this.#refusal();
    if (refused !== null) return refused;
    if (!this.#queuedRotations.has(seat) && this.#known?.controlLeases[seat] === lease) {
      reply(APPLIED);
      return SYNC_ACCEPTED;
    }
    if (this.#condition?.kind === "infrastructure_paused") {
      return Object.freeze({
        accepted: false,
        reason: "infrastructure_paused",
        recovery: this.#condition.reason,
      });
    }
    const queued = this.#queuedRotations.get(seat);
    this.#queuedRotations.set(seat, { lease, count: (queued?.count ?? 0) + 1 });
    this.#dropMark(seat, (markLease) => markLease !== lease, "control_changed");
    this.#enqueue({ kind: "lease", seat, lease, reply: once(reply) });
    return SYNC_ACCEPTED;
  }

  /**
   * Queued like any request; decided on a fresh load at its turn. The game
   * access layer calls it only after proving the session active, the account
   * active, the seat the player's, and `lease` the session's control lease.
   */
  markReady(
    seat: Seat,
    lease: ControlLeaseId,
    presence: ReadyPresence,
    reply: (outcome: ReadyOutcome) => void,
  ): SyncIngress {
    const refused = this.#refusal();
    if (refused !== null) return refused;
    this.#enqueue({ kind: "ready", seat, lease, presence, reply: once(reply) });
    return SYNC_ACCEPTED;
  }

  clearReady(seat: Seat, presence: ReadyPresence): void {
    this.#dropMark(seat, (_lease, markPresence) => markPresence === presence, "connection_closed");
  }

  readiness(): Readiness {
    if (this.#known?.status.kind !== "awaiting_players") return NOBODY_READY;
    return this.#ready.readiness((seat, lease, presence) => this.#validMark(seat, lease, presence));
  }

  /**
   * LIVE-WRITER-ACTIVATION-001: loads the game now, with no connection or
   * command, and arms the deadline of a running clock. Idempotent: the
   * deadline instant already armed keeps its one timer.
   */
  activate(): Promise<Activation> {
    return new Promise((resolve) => {
      const ingress = this.requestSync((outcome) => resolve(activationOf(outcome)));
      if (!ingress.accepted)
        resolve(Object.freeze({ kind: "unavailable", reason: ingress.reason }));
    });
  }

  /** Stops play after an infrastructure failure seen outside this writer's jobs. */
  pause(reason: InfrastructureReason): void {
    if (this.#status === "active" && this.#pausable()) this.#pause(reason);
  }

  /**
   * Refuses new work, lets the job in progress finish so its outcome is
   * settled before the writer lets go, and answers every waiting request
   * `temporarily_unavailable`.
   */
  async dispose(): Promise<void> {
    if (this.#status === "active") {
      this.#stopReason = "disposed";
      this.#status = "stopping";
      this.#deadline.disarm();
      this.#cancelStartWake();
      this.#cancelIdle();
      if (!this.#busy) this.#stop();
    }
    await this.#draining;
  }

  /**
   * The repository as this writer uses it. Every load records the sequence
   * it read, and a commit is only passed on when it builds on the sequence
   * this writer last published: one built on someone else's write is
   * refused as a concurrency conflict before it reaches the database.
   */
  #owned(inner: LiveGameRepository): LiveGameRepository {
    const owned: LiveGameRepository = {
      loadGame: async (gameId) => {
        const loaded = await inner.loadGame(gameId);
        if (loaded.ok) {
          this.#lastLoaded = loaded.value.state.sequence;
          this.#known = loaded.value.state;
        }
        return loaded;
      },
      createGame: (state, clockDomainId) => inner.createGame(state, clockDomainId),
      commitDecision: async (plan, clockDomainId) => {
        if (plan.expectedSequence !== this.#lastPublished) {
          return err({ kind: "concurrency_conflict", expectedSequence: plan.expectedSequence });
        }
        const committed = await inner.commitDecision(plan, clockDomainId);
        if (committed.ok) this.#known = knownAfter(this.#known, plan);
        return committed;
      },
    };
    return Object.freeze(owned);
  }

  /** The job in progress decided on a sequence this writer never published. */
  #foreignLoad(): boolean {
    return this.#lastLoaded !== this.#lastPublished;
  }

  /**
   * The command's lease is the actor's, and the actor's is the seat's lease
   * at the end of the queue. Only a writer that has loaded the game judges a
   * command here: before the first load every command is a lookup.
   */
  #admits(actor: AuthorizedGameActor, command: LiveGameCommand): boolean {
    if (command.controlLeaseId !== actor.controlLeaseId) return false;
    return this.#tailLease(actor.seat) === actor.controlLeaseId;
  }

  /** The seat's lease at the end of the queue: the stored one with every queued rotation applied. */
  #tailLease(seat: Seat): ControlLeaseId | undefined {
    return this.#queuedRotations.get(seat)?.lease ?? this.#known?.controlLeases[seat];
  }

  /** A mark counts while its lease is still the seat's lease and its connection is open. */
  #validMark(seat: Seat, lease: ControlLeaseId, presence: ReadyPresence): boolean {
    return presence.open && this.#tailLease(seat) === lease;
  }

  #dropMark(
    seat: Seat,
    stale: (lease: ControlLeaseId, presence: ReadyPresence) => boolean,
    cause: "connection_closed" | "control_changed",
  ): void {
    if (!this.#ready.clearIf(seat, stale)) return;
    this.#facts.record({ name: "game_player_unready", gameId: this.gameId, seat, cause });
    this.#readinessChanged();
    this.#considerRetiring();
  }

  #readinessChanged(): void {
    const readiness = this.readiness();
    this.#notify((subscriber) => subscriber.onReadinessChanged?.(this.gameId, readiness));
  }

  /**
   * Why `command` is looked up rather than received, or null when it may be
   * received: its id is bound in the game as this writer last loaded or
   * committed it, or it cannot be ruled out because the writer has not
   * loaded the game or a job that may still bind the id is waiting. With
   * neither, no job ahead can bind the id, so it is unbound at its turn.
   * The same rule as the job (`historicalReplay`), on memory; the job
   * decides again on a fresh load.
   */
  #lookupOf(actor: AuthorizedGameActor, command: LiveGameCommand): CommandLookup["lookup"] | null {
    const known = this.#known;
    if (known === null) return "unresolved";
    if (historicalReplay(known, participantOf(actor), command).kind !== "not_bound") return "bound";
    return this.#waiting.has(waitKey(actor.seat, command)) ? "unresolved" : null;
  }

  #wait(job: Job, delta: 1 | -1): void {
    if (job.kind !== "command" && job.kind !== "lookup") return;
    const key = waitKey(job.actor.seat, job.command);
    const count = (this.#waiting.get(key) ?? 0) + delta;
    if (count > 0) this.#waiting.set(key, count);
    else this.#waiting.delete(key);
  }

  #rotationLeft(seat: Seat): void {
    const queued = this.#queuedRotations.get(seat);
    if (queued === undefined) return;
    if (queued.count <= 1) this.#queuedRotations.delete(seat);
    else this.#queuedRotations.set(seat, { lease: queued.lease, count: queued.count - 1 });
  }

  #refusal(): IngressRefused | null {
    if (this.#status !== "active") return STOPPED;
    if (this.#requests >= this.#limits.maxQueuedRequests) {
      this.#facts.record({ name: "writer_queue_full", gameId: this.gameId });
      return QUEUE_FULL;
    }
    return null;
  }

  #enqueue(job: Job): void {
    if (!this.#queue.offer(job)) throw new Error("Writer runtime defect: reserved queue slot");
    if (job.kind === "deadline" || job.kind === "start_deadline") this.#deadlineQueued = true;
    else this.#requests += 1;
    this.#wait(job, 1);
    this.#cancelIdle();
    if (!this.#busy) {
      this.#busy = true;
      this.#draining = this.#drain();
    }
  }

  async #drain(): Promise<void> {
    try {
      for (let job = this.#queue.shift(); job !== undefined; job = this.#queue.shift()) {
        if (job.kind === "deadline" || job.kind === "start_deadline") this.#deadlineQueued = false;
        if (this.#status !== "active") {
          this.#release(job, true);
          continue;
        }
        this.#current = job;
        await this.#run(job);
        this.#current = null;
        this.#release(job, false);
      }
    } catch (error: unknown) {
      const job = this.#current;
      this.#current = null;
      this.#facts.record({ name: "writer_fault", gameId: this.gameId, job: job?.kind ?? "none" });
      if (this.#pausable()) this.#pause("WRITER_FAULT");
      if (job !== null) this.#release(job, true);
      this.#stopReason ??= "defect";
      this.#stop();
      this.#reportDefect(error);
    } finally {
      this.#busy = false;
    }
    if (this.#status === "stopping") this.#stop();
    else this.#considerRetiring();
  }

  /**
   * Bookkeeping when a job leaves the writer. `refuse` answers a command
   * `recovery_required` while play is paused, and anything else unavailable.
   */
  #release(job: Job, refuse: boolean): void {
    if (job.kind === "deadline" || job.kind === "start_deadline") return;
    this.#requests -= 1;
    this.#wait(job, -1);
    if (job.kind === "lease") this.#rotationLeft(job.seat);
    if (!refuse) return;
    const paused = this.#condition?.kind === "infrastructure_paused" ? this.#condition : null;
    if (paused !== null && job.kind !== "sync") {
      job.reply(this.#recoveryRequired(paused.reason));
      return;
    }
    job.reply(unavailable("temporarily_unavailable"));
  }

  async #run(job: Job): Promise<void> {
    if (job.kind === "sync") {
      await this.#refresh(job.reply);
      return;
    }
    const paused = this.#condition?.kind === "infrastructure_paused" ? this.#condition : null;
    if (paused !== null) {
      if (job.kind !== "deadline" && job.kind !== "start_deadline") {
        job.reply(this.#recoveryRequired(paused.reason));
      }
      return;
    }
    if (!this.#loaded && !(await this.#refresh(null))) {
      if (job.kind !== "deadline" && job.kind !== "start_deadline") {
        job.reply(this.#lastLoadFailure);
      }
      return;
    }
    switch (job.kind) {
      case "ready":
        await this.#runReady(job);
        return;
      case "start_deadline":
        await this.#refresh(null, "wake");
        return;
      case "command":
        await this.#runCommand(job);
        return;
      case "lookup":
        await this.#runLookup(job);
        return;
      case "lease":
        await this.#runLease(job);
        return;
      case "replay":
        await this.#runReplay(job);
        return;
      case "deadline":
        await this.#runDeadline(job.observedAt);
        return;
    }
  }

  /**
   * Loads the stored game, adopts it, and answers `reply` with its view.
   * Between its own jobs the stored sequence is the last one this writer
   * published: a bound rejection or a replay keeps it, and a failed commit
   * pauses play. So in play, any other stored sequence was written by
   * someone else, and a paused writer may only see its own commit whose
   * outcome the driver could not report land (one ahead, published).
   */
  async #refresh(
    reply: ((outcome: SyncOutcome) => void) | null,
    via: "load" | "wake" = "load",
  ): Promise<boolean> {
    const loaded = await loadForWriter(this.#writer, this.gameId);
    if (!loaded.ok) {
      this.#lastLoadFailure = this.#loadFailed(loaded.error);
      reply?.(this.#lastLoadFailure);
      return false;
    }
    const { state } = loaded.value;
    const paused = this.#condition?.kind === "infrastructure_paused";
    const moved = paused
      ? state.sequence < this.#lastPublished
      : state.sequence !== this.#lastPublished;
    if (this.#loaded && moved) {
      reply?.(this.#ownershipConflict("load"));
      return false;
    }
    const condition = effectiveCondition(
      loaded.value.condition,
      this.#pauses.reasonOf(this.gameId),
    );
    this.#observe(condition);
    const view = viewOf(state, condition, this.#clock.now());
    if (state.sequence > this.#lastPublished) {
      if (this.#loaded) this.#publish(state.sequence, view);
      else this.#lastPublished = state.sequence;
    }
    this.#loaded = true;
    const aborted =
      condition.kind === "awaiting_players"
        ? abortIfStartDeadlinePassed(state, this.#wallClock.now())
        : null;
    if (aborted !== null) {
      const settled = await this.#commitLifecycle(
        state,
        { kind: "aborted", nextState: aborted },
        via,
      );
      if (settled.kind !== "committed") {
        this.#lastLoadFailure = settled.failure;
        reply?.(settled.failure);
        return false;
      }
      reply?.(Object.freeze({ kind: "snapshot", view: settled.view }));
      return true;
    }
    reply?.(Object.freeze({ kind: "snapshot", view }));
    this.#arm(state, condition);
    return true;
  }

  /**
   * The writer's single linearization point of a start or an abort: the
   * decision was made on the state this job just loaded, and the commit is a
   * compare-and-set on its sequence. Committed, it clears every ready mark,
   * publishes the new sequence to subscribers, and arms the running clock's
   * deadline (a start) or nothing (an abort).
   */
  async #commitLifecycle(
    state: ActiveGameState,
    decision: LifecycleDecision,
    via: "load" | "wake" | "ready",
  ): Promise<
    | { readonly kind: "committed"; readonly view: GameView; readonly started: boolean }
    | { readonly kind: "failed"; readonly failure: RecoveryRequired | Unavailable }
  > {
    const committed = await commitLifecycle(this.#writer, state, decision);
    if (!committed.ok) return { kind: "failed", failure: this.#executionFailed(committed.error) };
    const next = committed.value;
    this.#ready.clear();
    const started = next.kind === "started";
    if (started) this.#facts.record({ name: "game_started", gameId: this.gameId });
    else this.#facts.record({ name: "game_start_aborted", gameId: this.gameId, via });
    this.#adopt(next.state);
    const condition = this.#condition ?? next.condition;
    return { kind: "committed", view: viewOf(next.state, condition, this.#clock.now()), started };
  }

  /**
   * The ready barrier, decided on a fresh load. A deadline already passed
   * aborts the game instead. Otherwise the mark needs the game awaiting, the
   * lease the seat's lease at the end of the queue, and the presence open;
   * when both seats then hold a valid mark this job starts the game, with
   * the first side's clock anchored at the monotonic reading taken here.
   */
  async #runReady(job: Extract<Job, { kind: "ready" }>): Promise<void> {
    const loaded = await loadForWriter(this.#writer, this.gameId);
    if (!loaded.ok) {
      job.reply(this.#loadFailed(loaded.error));
      return;
    }
    if (this.#foreignLoad()) {
      job.reply(this.#ownershipConflict("load"));
      return;
    }
    const { state, condition } = loaded.value;
    const refuse = (reason: ReadyRefusal, view: GameView | null): void => {
      this.#facts.record({ name: "game_ready_refused", gameId: this.gameId, reason });
      job.reply(Object.freeze({ kind: "refused", reason, view }));
    };
    if (condition.kind !== "awaiting_players") {
      refuse("game_not_awaiting", viewOf(state, condition, this.#clock.now()));
      return;
    }
    const aborted = abortIfStartDeadlinePassed(state, this.#wallClock.now());
    if (aborted !== null) {
      const settled = await this.#commitLifecycle(
        state,
        { kind: "aborted", nextState: aborted },
        "ready",
      );
      if (settled.kind === "committed") refuse("start_deadline_passed", settled.view);
      else job.reply(settled.failure);
      return;
    }
    const view = viewOf(state, condition, this.#clock.now());
    if (this.#tailLease(job.seat) !== job.lease) {
      refuse("control_not_held", view);
      return;
    }
    if (!job.presence.open) {
      refuse("connection_closed", view);
      return;
    }
    if (this.#ready.mark(job.seat, job.lease, job.presence)) {
      this.#facts.record({ name: "game_player_ready", gameId: this.gameId, seat: job.seat });
      this.#readinessChanged();
    }
    const readiness = this.readiness();
    if (!readiness.white || !readiness.black) {
      job.reply(Object.freeze({ kind: "ready", readiness, view }));
      return;
    }
    const decision = startAwaitingGame(state, this.#clock.now(), this.#wallClock.now());
    const settled = await this.#commitLifecycle(state, decision, "ready");
    if (settled.kind !== "committed") {
      job.reply(settled.failure);
      return;
    }
    if (settled.started) job.reply(Object.freeze({ kind: "started", view: settled.view }));
    else refuse("start_deadline_passed", settled.view);
  }

  #loadFailed(error: LoadError): Unavailable | RecoveryRequired {
    switch (error.kind) {
      case "persistence_failure":
        return this.#persistenceFailed("load");
      case "game_not_found":
        this.#stopAfterCurrent("game_not_found");
        return unavailable("game_not_found");
      case "corrupt_state":
        this.#stopAfterCurrent("corrupt_state");
        return unavailable("game_corrupt");
    }
  }

  /** The lease was judged at receipt; a load showing another one refuses before the core. */
  async #runCommand(job: Extract<Job, { kind: "command" }>): Promise<void> {
    if (this.#known?.controlLeases[job.actor.seat] !== job.actor.controlLeaseId) {
      this.#facts.record({ name: "command_refused_control", gameId: this.gameId });
      job.reply(NOT_HELD_OUTCOME);
      return;
    }
    const result = await executeCommand(this.#writer, job.actor, job.command, {
      receivedAtMonotonicMs: job.receivedAt,
    });
    if (!result.ok) {
      job.reply(this.#executionFailed(result.error));
      return;
    }
    if (this.#foreignLoad()) {
      job.reply(this.#ownershipConflict("load"));
      return;
    }
    const { nextState, response } = result.value.decision;
    job.reply(Object.freeze({ kind: "decided", response }));
    if (response.replayedResponse) {
      this.#facts.record({ name: "command_replayed", gameId: this.gameId });
    } else if (response.code === "Accepted") {
      this.#facts.record({ name: "command_accepted", gameId: this.gameId });
    } else {
      this.#facts.record({ name: "command_rejected", gameId: this.gameId, code: response.code });
    }
    this.#adopt(nextState);
  }

  async #runLease(job: Extract<Job, { kind: "lease" }>): Promise<void> {
    const result = await executeLeaseRotation(this.#writer, this.gameId, job.seat, job.lease);
    if (!result.ok) {
      job.reply(this.#rotationFailed(result.error));
      return;
    }
    if (this.#foreignLoad()) {
      job.reply(this.#ownershipConflict("load"));
      return;
    }
    if (result.value.changed) {
      this.#facts.record({ name: "control_lease_rotated", gameId: this.gameId, seat: job.seat });
    }
    job.reply(APPLIED);
  }

  /**
   * A rotation moves no sequence and no clock, so a commit whose outcome is
   * unknown does not pause play: the next load shows which lease is stored,
   * and the caller is told it may not rely on the new one.
   */
  #rotationFailed(error: LeaseRotationFailure): LeaseOutcome {
    switch (error.kind) {
      case "shared_control_lease":
        this.#reportDefect(new Error("Writer runtime defect: a rotation reused the other lease"));
        return unavailable("temporarily_unavailable");
      case "concurrency_conflict":
        return this.#ownershipConflict(this.#foreignLoad() ? "load" : "commit");
      case "persistence_failure":
        if (error.operation !== "commit") return this.#loadFailed(error);
        this.#facts.record({
          name: "persistence_failure",
          gameId: this.gameId,
          operation: "commit",
        });
        return unavailable("temporarily_unavailable");
      case "game_not_found":
      case "corrupt_state":
        return this.#loadFailed(error);
    }
  }

  /**
   * A command of the controlling session taken as a lookup. The stored
   * bindings answer first, with no clock reading, exactly as for a session
   * without control: a replay or an identity conflict, never a receipt. An
   * unbound id is a new command that was not received at ingress: it needs
   * the seat's lease now, and it is received now only if no clock runs in
   * this domain, so the load and the queue are never charged to a player
   * (`CommandOutcome`).
   */
  async #runLookup(job: Extract<Job, { kind: "lookup" }>): Promise<void> {
    const loaded = await loadForWriter(this.#writer, this.gameId);
    if (!loaded.ok) {
      job.reply(this.#loadFailed(loaded.error));
      return;
    }
    if (this.#foreignLoad()) {
      job.reply(this.#ownershipConflict("load"));
      return;
    }
    const { state, condition } = loaded.value;
    const replay = historicalReplay(state, participantOf(job.actor), job.command);
    switch (replay.kind) {
      case "replayed":
        this.#facts.record({ name: "command_replayed", gameId: this.gameId });
        job.reply(Object.freeze({ kind: "decided", response: replay.response }));
        return;
      case "identity_conflict":
        this.#facts.record({ name: "replay_identity_conflict", gameId: this.gameId });
        job.reply(IDENTITY_CONFLICT_OUTCOME);
        return;
      case "not_bound":
        break;
    }
    if (!this.#admits(job.actor, job.command)) {
      this.#facts.record({ name: "command_refused_control", gameId: this.gameId });
      job.reply(NOT_HELD_OUTCOME);
      return;
    }
    const lifecycle = notInPlayOf(state);
    if (lifecycle !== null) {
      this.#facts.record({ name: "command_refused_not_started", gameId: this.gameId });
      job.reply(Object.freeze({ kind: "not_in_play", lifecycle }));
      return;
    }
    if (condition.kind === "running") {
      this.#facts.record({ name: "command_not_received", gameId: this.gameId });
      job.reply(unavailable("temporarily_unavailable"));
      return;
    }
    const { actor, command, reply } = job;
    await this.#runCommand({
      kind: "command",
      actor,
      command,
      receivedAt: this.#clock.now(),
      reply,
    });
  }

  async #runReplay(job: Extract<Job, { kind: "replay" }>): Promise<void> {
    const loaded = await loadForWriter(this.#writer, this.gameId);
    if (!loaded.ok) {
      job.reply(this.#loadFailed(loaded.error));
      return;
    }
    if (this.#foreignLoad()) {
      job.reply(this.#ownershipConflict("load"));
      return;
    }
    const replay = historicalReplay(loaded.value.state, job.participant, job.command);
    switch (replay.kind) {
      case "not_bound":
        this.#facts.record({ name: "command_refused_control", gameId: this.gameId });
        job.reply(NOT_HELD_OUTCOME);
        return;
      case "identity_conflict":
        this.#facts.record({ name: "replay_identity_conflict", gameId: this.gameId });
        job.reply(IDENTITY_CONFLICT_OUTCOME);
        return;
      case "replayed":
        this.#facts.record({ name: "command_replayed", gameId: this.gameId });
        job.reply(Object.freeze({ kind: "decided", response: replay.response }));
        return;
    }
  }

  async #runDeadline(observedAt: MonotonicMs): Promise<void> {
    const result = await executeDeadline(this.#writer, this.gameId, observedAt);
    if (!result.ok) {
      this.#executionFailed(result.error);
      return;
    }
    if (this.#foreignLoad()) {
      this.#ownershipConflict("load");
      return;
    }
    const { decision } = result.value;
    if (decision.flagged) this.#facts.record({ name: "deadline_flagged", gameId: this.gameId });
    this.#adopt(decision.nextState);
  }

  /**
   * A state this writer just decided. Only a sequence step is a transition
   * this writer committed, in its own clock domain; a replay, a rejection, or
   * a bound rejection leaves the observed condition alone.
   */
  #adopt(state: ActiveGameState): void {
    if (state.sequence > this.#lastPublished) {
      const domain = this.#writer.clockDomainId;
      const condition = gameCondition({ state, clockDomainId: domain }, domain);
      this.#observe(condition);
      this.#publish(state.sequence, viewOf(state, condition, this.#clock.now()));
    }
    if (this.#condition !== null) this.#arm(state, this.#condition);
  }

  #executionFailed(error: ExecutionError | CommitError): RecoveryRequired | Unavailable {
    switch (error.kind) {
      case "recovery_paused":
        this.#observe(error);
        this.#deadline.disarm();
        return this.#recoveryRequired(error.reason);
      case "concurrency_conflict":
        return this.#ownershipConflict(this.#foreignLoad() ? "load" : "commit");
      case "persistence_failure":
        return this.#persistenceFailed(error.operation);
      case "game_not_found":
      case "corrupt_state":
        return this.#loadFailed(error);
    }
  }

  /**
   * LIVE-RETRY-RECEIPT-001: a failed load or commit decided nothing, and play
   * stops at the last durable state and balances. A game already known to be
   * stopped (finished, unresolved, or paused for its clock domain) has no
   * clock to protect and is only answered as unavailable.
   */
  #persistenceFailed(operation: "load" | "create" | "commit"): Unavailable | RecoveryRequired {
    this.#facts.record({ name: "persistence_failure", gameId: this.gameId, operation });
    if (!this.#pausable()) return unavailable("temporarily_unavailable");
    this.#pause("PERSISTENCE_UNAVAILABLE");
    return this.#recoveryRequired(this.#pauses.reasonOf(this.gameId) ?? "PERSISTENCE_UNAVAILABLE");
  }

  /**
   * LIVE-WRITER-OWNERSHIP-001: the stored sequence moved under this writer,
   * so another writer may own the game. Nothing is retried or overwritten and
   * nothing is charged: play stops at the stored state for every condition,
   * subscribers are told recovery is required and then to sync, and the
   * writer stops. Nothing replaces it by itself; a later request finds the
   * game paused until an approved ownership recovery
   * (LIVE-RECOVERY-RESUME-001).
   */
  #ownershipConflict(detectedBy: "commit" | "load"): RecoveryRequired {
    this.#facts.record({ name: "concurrency_conflict", gameId: this.gameId, detectedBy });
    this.#pause("CONCURRENCY_OWNERSHIP_UNCERTAIN");
    this.#stopAfterCurrent("concurrency_conflict");
    return this.#recoveryRequired("CONCURRENCY_OWNERSHIP_UNCERTAIN");
  }

  #pausable(): boolean {
    const kind = this.#condition?.kind;
    return (
      kind === undefined ||
      kind === "running" ||
      kind === "awaiting_players" ||
      kind === "infrastructure_paused"
    );
  }

  /**
   * Stops play: no deadline check runs, queued commands are answered
   * `recovery_required`, and subscribers are told once. Nothing is written.
   */
  #pause(reason: InfrastructureReason): void {
    const entered = this.#pauses.add(this.gameId, reason);
    this.#condition = infrastructurePaused(this.#pauses.reasonOf(this.gameId) ?? reason);
    this.#deadline.disarm();
    this.#cancelStartWake();
    this.#ready.clear();
    if (!entered) return;
    this.#facts.record({ name: "infrastructure_pause_entered", gameId: this.gameId, reason });
    this.#notify((subscriber) => subscriber.onRecoveryRequired(this.gameId, reason));
  }

  #recoveryRequired(reason: RecoveryReason): RecoveryRequired {
    return Object.freeze({ kind: "recovery_required", gameId: this.gameId, reason });
  }

  #observe(condition: WriterCondition): void {
    if (condition.kind === "recovery_paused" && this.#condition?.kind !== "recovery_paused") {
      this.#facts.record({ name: "recovery_pause_encountered", gameId: this.gameId });
    }
    this.#condition = condition;
  }

  #publish(sequence: number, view: GameView): void {
    this.#lastPublished = sequence;
    this.#notify((subscriber) => subscriber.onUpdate(view));
  }

  /** Calls every subscriber in order; one that throws is dropped and reported. */
  #notify(call: (subscriber: GameSubscriber) => void): void {
    for (const subscriber of [...this.#subscribers]) {
      try {
        call(subscriber);
      } catch (error: unknown) {
        this.#subscribers.delete(subscriber);
        this.#facts.record({ name: "subscriber_defect", gameId: this.gameId });
        this.#reportDefect(error);
      }
    }
  }

  /**
   * Only a running clock in play is watched. The wake only queues a deadline
   * check stamped with the clock reading at wake time; an early wake finds
   * the clock in time and arms again.
   */
  #arm(state: ActiveGameState, condition: WriterCondition): void {
    this.#armStart(state, condition);
    if (condition.kind !== "running" || !state.clock.running || this.#status !== "active") {
      this.#deadline.disarm();
      return;
    }
    if (!this.#deadlineQueued) this.#deadline.arm(lateInstant(state.clock));
  }

  #deadlineWake(): void {
    if (this.#status !== "active" || this.#deadlineQueued) return;
    if (this.#condition?.kind === "infrastructure_paused") return;
    this.#enqueue({ kind: "deadline", observedAt: this.#clock.now() });
  }

  /**
   * An awaiting game's start deadline is wall time. The wake only queues a
   * reload, which aborts the game if the wall clock then reads the deadline
   * or later; an early wake re-arms. Nothing else is armed while awaiting.
   */
  #armStart(state: ActiveGameState, condition: WriterCondition): void {
    const { status } = state;
    if (
      condition.kind !== "awaiting_players" ||
      status.kind !== "awaiting_players" ||
      this.#status !== "active"
    ) {
      this.#cancelStartWake();
      return;
    }
    if (this.#startWake !== null || this.#deadlineQueued) return;
    const delay = status.startDeadlineAtWallMs - this.#wallClock.now();
    this.#startWake = this.#scheduler.wakeAfter(Math.max(0, delay), () => {
      this.#startWake = null;
      if (this.#status !== "active" || this.#deadlineQueued) return;
      if (this.#condition?.kind !== "awaiting_players") return;
      this.#enqueue({ kind: "start_deadline" });
    });
  }

  #cancelStartWake(): void {
    this.#startWake?.cancel();
    this.#startWake = null;
  }

  #cancelIdle(): void {
    this.#idleTimer?.cancel();
    this.#idleTimer = null;
  }

  /** A running clock keeps its writer; otherwise an idle writer is retired later. */
  #considerRetiring(): void {
    if (!this.#retirable() || this.#idleTimer !== null) return;
    this.#idleTimer = this.#scheduler.wakeAfter(this.#limits.idleRetireMs, () => {
      this.#idleTimer = null;
      if (!this.#retirable()) return;
      this.#stopReason = "idle";
      this.#stop();
    });
  }

  #retirable(): boolean {
    return (
      this.#status === "active" &&
      !this.#busy &&
      this.#queue.size === 0 &&
      this.#subscribers.size === 0 &&
      this.#ready.size === 0 &&
      this.#condition?.kind !== "running"
    );
  }

  /** Stops once the job in progress has answered. */
  #stopAfterCurrent(reason: RetireReason): void {
    this.#stopReason ??= reason;
    if (this.#status === "active") this.#status = "stopping";
    this.#deadline.disarm();
    this.#cancelStartWake();
  }

  /**
   * Final: answers every waiting request, tells subscribers to sync again,
   * cancels every timer, and leaves the registry.
   */
  #stop(): void {
    if (this.#status === "stopped") return;
    this.#status = "stopped";
    this.#deadline.disarm();
    this.#cancelStartWake();
    this.#ready.clear();
    this.#cancelIdle();
    for (let job = this.#queue.shift(); job !== undefined; job = this.#queue.shift()) {
      this.#release(job, true);
    }
    this.#deadlineQueued = false;
    const subscribers = [...this.#subscribers];
    this.#subscribers.clear();
    for (const subscriber of subscribers) {
      try {
        subscriber.onWriterStopped(this.gameId);
      } catch (error: unknown) {
        this.#reportDefect(error);
      }
    }
    const reason = this.#stopReason ?? "defect";
    this.#facts.record({ name: "writer_retired", gameId: this.gameId, reason });
    this.#onRetired(this, reason);
  }
}
