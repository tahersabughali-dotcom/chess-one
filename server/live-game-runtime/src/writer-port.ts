import type {
  AuthorizedGameActor,
  CommandResponse,
  ControlLeaseId,
  GameId,
  GameParticipant,
  LeaselessCommand,
  LiveGameCommand,
  MonotonicMs,
  Seat,
} from "@chess-one/live-game";
import type { GameView } from "./game-view.ts";
import type { InfrastructureReason, RecoveryReason } from "./writer-recovery.ts";

export interface WriterLimits {
  /** Commands and sync requests held by one writer, including the one in progress. */
  readonly maxQueuedRequests: number;
  readonly maxSubscribers: number;
  /** A writer that no running clock needs is retired after this long with no work. */
  readonly idleRetireMs: number;
}

/**
 * Authoritative receipt (DEC-063): a command is received only when the writer
 * accepts it into its bounded queue, and `receivedAt` is the writer's
 * monotonic reading at that moment. A refused command was never received.
 *
 * Admission (Batch 11): the lease check is part of receipt. A command whose
 * lease is not the seat's lease as of the end of the queue (the stored lease
 * with every queued rotation applied) is refused `control_not_held` before
 * it is stamped. So a rotation is the linearization point of a control
 * change: every command admitted before it ran under the old lease, and
 * none is admitted under that lease after it.
 *
 * Historical replay (Batch 11.3): a command id the seat already bound is
 * never received. Before any clock reading the writer looks the id up in the
 * game as it last loaded or committed it; a bound id, or one it cannot rule
 * out, is taken as a `CommandLookup` instead, whoever controls the seat.
 */
export type CommandIngress =
  | { readonly accepted: true; readonly receivedAt: MonotonicMs }
  | CommandLookup
  | IngressRefused
  | ControlNotHeld;

/**
 * Taken for a lookup of the stored bindings, not received: the writer read
 * no clock for it, and it has no `receivedAt` and no place among received
 * commands. The lease is not checked first: a bound id is answered from its
 * binding whoever controls the seat.
 * - `bound`: the seat bound the command id, as of the writer's last load or
 *   commit; the job answers from the stored binding, a replay or an
 *   identity conflict.
 * - `unresolved`: the writer cannot rule a binding out, because it has not
 *   loaded the game yet or the same id already waits in its queue. The job
 *   answers from the stored binding if there is one; otherwise see
 *   `CommandOutcome` for when the command is received.
 */
export interface CommandLookup {
  readonly accepted: true;
  readonly receivedAt: null;
  readonly lookup: "bound" | "unresolved";
}

export type SyncIngress = { readonly accepted: true } | IngressRefused;

/** `infrastructure_paused`: play is stopped; the command was not received and may be sent again after a recovery. */
export type IngressRefused =
  | { readonly accepted: false; readonly reason: "queue_full" | "writer_stopped" }
  | {
      readonly accepted: false;
      readonly reason: "infrastructure_paused";
      readonly recovery: InfrastructureReason;
    };

/** The actor's lease is not the seat's lease: nothing was received, queued, stamped, or bound. */
export interface ControlNotHeld {
  readonly accepted: false;
  readonly reason: "control_not_held";
}

/**
 * - `temporarily_unavailable`: nothing was decided durably; the same command
 *   id may be sent again and the stored binding replays any decision that won;
 * - `game_not_found`, `game_corrupt`: this writer cannot serve the game.
 */
export type UnavailableReason = "temporarily_unavailable" | "game_not_found" | "game_corrupt";

export interface Unavailable {
  readonly kind: "unavailable";
  readonly reason: UnavailableReason;
}

/** Play is stopped until an operator recovery; the request decided nothing. */
export interface RecoveryRequired {
  readonly kind: "recovery_required";
  readonly gameId: GameId;
  readonly reason: RecoveryReason;
}

/**
 * The answer to a received command or to a `CommandLookup`. A lookup whose
 * command id turns out to be unbound was not received at ingress, so it is
 * judged as a new command at its turn in the queue: under the seat's lease
 * at the end of the queue (else `control_not_held`), and then:
 * - while the game's clock runs in this writer's clock domain it is not
 *   received at all, since a receipt taken now would charge the player for
 *   the load and the queue: `unavailable` / `temporarily_unavailable`, and
 *   the same command id may be sent again;
 * - otherwise no clock is charged in this domain (finished, rules-unresolved,
 *   or recovery-paused), so it is received now and decided as usual.
 */
export type CommandOutcome =
  /** A durable decision: committed, or deciding nothing that needed a write. */
  | { readonly kind: "decided"; readonly response: CommandResponse }
  /** The lease is not the seat's lease: nothing is received, decided, or bound. */
  | { readonly kind: "control_not_held" }
  /** A lookup found the id bound to a different command: nothing is received or returned. */
  | { readonly kind: "identity_conflict" }
  | RecoveryRequired
  | Unavailable;

/**
 * A control-lease rotation: `applied` once the lease is stored (or already
 * was). The seat's previous lease admits no command after the rotation was
 * accepted into the queue.
 */
export type LeaseOutcome = { readonly kind: "applied" } | RecoveryRequired | Unavailable;

/**
 * A historical replay, read from the stored bindings; it never decides a
 * command. `control_not_held`: the seat never bound the command id, so there
 * is nothing to replay and the caller has no authority to decide it.
 * `identity_conflict`: the id is bound to a different command.
 */
export type ReplayOutcome =
  | { readonly kind: "decided"; readonly response: CommandResponse }
  | { readonly kind: "control_not_held" }
  | { readonly kind: "identity_conflict" }
  | RecoveryRequired
  | Unavailable;

/** `recovery_required` answers a sync whose load failed and paused the game. */
export type SyncOutcome =
  | { readonly kind: "snapshot"; readonly view: GameView }
  | RecoveryRequired
  | Unavailable;

/**
 * LIVE-WRITER-ACTIVATION-001: what activating a writer established.
 * - `watching`: the game runs and its deadline wake-up is armed;
 * - `stopped`: finished or unresolved; no timer;
 * - `recovery_required`: paused; no competitive timer;
 * - `unavailable`: the writer could not load the game or take the request.
 */
export type Activation =
  | { readonly kind: "watching"; readonly view: GameView }
  | { readonly kind: "stopped"; readonly view: GameView }
  | { readonly kind: "recovery_required"; readonly reason: RecoveryReason }
  | {
      readonly kind: "unavailable";
      readonly reason: UnavailableReason | IngressRefused["reason"] | "writer_capacity";
    };

export function activationOf(outcome: SyncOutcome): Activation {
  if (outcome.kind === "unavailable") return outcome;
  if (outcome.kind === "recovery_required") {
    return Object.freeze({ kind: "recovery_required", reason: outcome.reason });
  }
  const { view } = outcome;
  if (view.recoveryReason !== null) {
    return Object.freeze({ kind: "recovery_required", reason: view.recoveryReason });
  }
  return Object.freeze({ kind: view.condition === "running" ? "watching" : "stopped", view });
}

/**
 * A live listener for one game, called synchronously in publication order. It
 * must not throw; a subscriber that throws is removed and reported.
 */
export interface GameSubscriber {
  onUpdate(view: GameView): void;
  /** Play stopped for an infrastructure failure; the subscriber stays subscribed. */
  onRecoveryRequired(gameId: GameId, reason: RecoveryReason): void;
  /** The writer stopped; the subscriber is dropped and must sync again. */
  onWriterStopped(gameId: GameId): void;
}

export type SubscribeResult =
  | "subscribed"
  | "already_subscribed"
  | "limit_reached"
  | "writer_stopped";

/** What a transport may do with one game's writer. */
export interface GameWriterPort {
  readonly gameId: GameId;
  subscribe(subscriber: GameSubscriber): SubscribeResult;
  unsubscribe(subscriber: GameSubscriber): void;
  submitCommand(
    actor: AuthorizedGameActor,
    command: LiveGameCommand,
    reply: (outcome: CommandOutcome) => void,
  ): CommandIngress;
  requestSync(reply: (outcome: SyncOutcome) => void): SyncIngress;
  /**
   * Looks up the stored decision of a command the participant's seat already
   * bound, for a session without the seat's control. No lease is taken: the
   * binding's own lease is used. Read-only: nothing is received or stamped,
   * exactly as for a `CommandLookup` of the controlling session.
   */
  replayCommand(
    participant: GameParticipant,
    command: LeaselessCommand,
    reply: (outcome: ReplayOutcome) => void,
  ): SyncIngress;
}

/**
 * What the game-access layer may ask of a writer beyond a transport: make a
 * lease the seat's lease. It may answer before returning when the lease is
 * already the seat's lease with no rotation queued.
 */
export interface GameControlPort extends GameWriterPort {
  applyControlLease(
    seat: Seat,
    lease: ControlLeaseId,
    reply: (outcome: LeaseOutcome) => void,
  ): SyncIngress;
}
