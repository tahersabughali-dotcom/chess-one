import type {
  AuthorizedGameActor,
  CommandResponse,
  GameId,
  LiveGameCommand,
  MonotonicMs,
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
 */
export type CommandIngress =
  | { readonly accepted: true; readonly receivedAt: MonotonicMs }
  | IngressRefused;

export type SyncIngress = { readonly accepted: true } | IngressRefused;

/** `infrastructure_paused`: play is stopped; the command was not received and may be sent again after a recovery. */
export type IngressRefused =
  | { readonly accepted: false; readonly reason: "queue_full" | "writer_stopped" }
  | {
      readonly accepted: false;
      readonly reason: "infrastructure_paused";
      readonly recovery: InfrastructureReason;
    };

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

export type CommandOutcome =
  /** A durable decision: committed, or deciding nothing that needed a write. */
  { readonly kind: "decided"; readonly response: CommandResponse } | RecoveryRequired | Unavailable;

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
}
