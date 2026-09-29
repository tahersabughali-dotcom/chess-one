import { type Color, type DurationMs, err, ok, type Result } from "@chess-one/game-values";
import {
  type ActiveGameState,
  createActiveGame,
  type NewGame,
  type NewGameError,
} from "../active-game.ts";
import type { MonotonicMs, WallClockMs } from "../clock.ts";
import { findBinding } from "../command-identity.ts";
import { type LiveGameCommand, parseCommand } from "../commands.ts";
import { withControlLease } from "../control-lease.ts";
import type { AuthorizedGameActor, CommandDecision, Ingress } from "../decision.ts";
import type { ControlLeaseId, GameId, Seat } from "../ids.ts";
import { type DeadlineDecision, processCommand, processDeadline } from "../process-command.ts";
import {
  type ClockDomainId,
  type CommitError,
  type CreateError,
  type EventId,
  type LiveGameRepository,
  type LoadError,
  planCommit,
  planLeaseRotation,
  type StoredGame,
} from "./repository.ts";

/** One authoritative writer: its repository and the id of its monotonic clock domain. */
export interface LiveGameWriter {
  readonly repository: LiveGameRepository;
  readonly clockDomainId: ClockDomainId;
}

/**
 * LIVE-RECOVERY-CLOCK-001 (RESOLVED): pause on writer clock-domain loss;
 * preserve committed balances; no player is charged for server/process
 * downtime. A running clock stored by another clock domain is anchored at
 * another process's monotonic instant (DEC-063), so it is never compared with
 * this writer's clock, and wall clock never measures the downtime. The game
 * is paused at its last committed balances until the reconnect/resume
 * operation (LIVE-RECOVERY-RESUME-001, not implemented) re-anchors it. The
 * condition follows from the stored clock and clock domain, so recognising it
 * writes nothing.
 */
export interface RecoveryPaused {
  readonly kind: "recovery_paused";
  readonly reason: "RECOVERY_PAUSED_CLOCK_DOMAIN_CHANGED";
  /** The last committed balances, exactly as stored. */
  readonly remainingMs: Readonly<Record<Color, DurationMs>>;
  readonly activeSide: Color;
  readonly storedClockDomainId: ClockDomainId;
}

/**
 * A stored game as one writer sees it: an active game whose clock runs in this
 * writer's domain, a finished game, a game stopped on an unresolved rules
 * question, or an active game paused by the loss of the clock domain that
 * stored it. Only the pause is an infrastructure condition; it has no result.
 */
export type GameCondition =
  | { readonly kind: "running" }
  | { readonly kind: "finished" }
  | { readonly kind: "rules_unresolved" }
  | RecoveryPaused;

export interface LoadedGame extends StoredGame {
  readonly condition: GameCondition;
}

export type ExecutionError = LoadError | CommitError | RecoveryPaused;

export interface CommandExecution {
  readonly decision: CommandDecision;
  /** Durable ids of the outbox rows written with the decision, in event order. */
  readonly eventIds: readonly EventId[];
}

export interface DeadlineExecution {
  readonly decision: DeadlineDecision;
  readonly eventIds: readonly EventId[];
}

export interface SharedControlLease {
  readonly kind: "shared_control_lease";
}

export type LeaseRotationFailure = LoadError | CommitError | SharedControlLease;

export interface LeaseRotation {
  readonly state: ActiveGameState;
  /** False when the seat already had the lease: nothing was written. */
  readonly changed: boolean;
}

const RUNNING: GameCondition = Object.freeze({ kind: "running" });
const FINISHED: GameCondition = Object.freeze({ kind: "finished" });
const RULES_UNRESOLVED: GameCondition = Object.freeze({ kind: "rules_unresolved" });

const NO_EVENT_IDS: readonly EventId[] = Object.freeze([]);

function writerDefect(message: string): never {
  throw new Error(`Live game writer defect: ${message}`);
}

/**
 * The condition of `stored` for a writer in clock domain `current`. A stopped
 * clock is never read again; a running one only inside the domain that stored it.
 */
export function gameCondition(stored: StoredGame, current: ClockDomainId): GameCondition {
  const { state, clockDomainId } = stored;
  switch (state.status.kind) {
    case "finished":
      return FINISHED;
    case "unresolved":
      return RULES_UNRESOLVED;
    case "active":
      if (!state.clock.running) writerDefect("an active game has a stopped clock");
      if (clockDomainId === current) return RUNNING;
      return Object.freeze({
        kind: "recovery_paused",
        reason: "RECOVERY_PAUSED_CLOCK_DOMAIN_CHANGED",
        remainingMs: state.clock.remainingMs,
        activeSide: state.clock.activeSide,
        storedClockDomainId: clockDomainId,
      });
  }
}

/** Loads a stored game with its condition for `writer`. Loading never writes. */
export async function loadForWriter(
  writer: LiveGameWriter,
  gameId: GameId,
): Promise<Result<LoadedGame, LoadError>> {
  const loaded = await writer.repository.loadGame(gameId);
  if (!loaded.ok) return err(loaded.error);
  return ok({ ...loaded.value, condition: gameCondition(loaded.value, writer.clockDomainId) });
}

async function persist(
  writer: LiveGameWriter,
  previous: ActiveGameState,
  decision: CommandDecision,
): Promise<Result<CommandExecution, ExecutionError>> {
  const plan = planCommit(previous, decision.nextState, decision.events);
  if (plan === null) return ok({ decision, eventIds: NO_EVENT_IDS });
  const committed = await writer.repository.commitDecision(plan, writer.clockDomainId);
  return committed.ok ? ok({ decision, eventIds: committed.value.eventIds }) : err(committed.error);
}

/**
 * Creates and stores a new game. The clock starts in this writer's domain at
 * `game.startedAtMonotonicMs`.
 */
export async function startGame(
  writer: LiveGameWriter,
  game: NewGame,
): Promise<Result<ActiveGameState, NewGameError | CreateError>> {
  const created = createActiveGame(game);
  if (!created.ok) return created;
  const stored = await writer.repository.createGame(created.value, writer.clockDomainId);
  return stored.ok ? ok(created.value) : err(stored.error);
}

/**
 * Loads the game, decides the command with the pure `processCommand`, and
 * persists the decision's state, binding, and events in one transaction. A
 * decision that changes nothing writes nothing. The state is loaded for every
 * command, so rejections are decided on the stored state; nothing is cached.
 *
 * While the game is recovery-paused (LIVE-RECOVERY-CLOCK-001), only a
 * command with a stored binding is decided: identity is checked before any
 * clock field is read, so its stored response is replayed unchanged. Every
 * other command is refused with the pause and no write.
 *
 * A concurrency conflict is returned, not retried: the caller may reload and
 * submit again, and the stored binding then replays any decision that won.
 */
export async function executeCommand(
  writer: LiveGameWriter,
  actor: AuthorizedGameActor,
  command: LiveGameCommand,
  ingress: Ingress,
): Promise<Result<CommandExecution, ExecutionError>> {
  const loaded = await loadForWriter(writer, actor.gameId);
  if (!loaded.ok) return err(loaded.error);
  const { state, condition } = loaded.value;
  if (condition.kind === "recovery_paused") {
    const parsed = parseCommand(command);
    const stored = parsed.ok
      ? findBinding(state, actor.seat, parsed.value.clientCommandId)
      : undefined;
    if (stored === undefined) return err(condition);
    const decision = processCommand(state, actor, command, ingress);
    if (decision.nextState !== state) writerDefect("a stored binding produced a new state");
    return ok({ decision, eventIds: NO_EVENT_IDS });
  }
  return persist(writer, state, processCommand(state, actor, command, ingress));
}

/**
 * The writer's own deadline check for a stored game, at `observedAt` in this
 * writer's clock domain. A flag is persisted with its outbox event, if any.
 * A recovery-paused game has no running deadline: it is refused with the
 * pause, so downtime never flags a player.
 */
export async function executeDeadline(
  writer: LiveGameWriter,
  gameId: GameId,
  observedAt: MonotonicMs,
  auditWallClockMs: WallClockMs | null = null,
): Promise<Result<DeadlineExecution, ExecutionError>> {
  const loaded = await loadForWriter(writer, gameId);
  if (!loaded.ok) return err(loaded.error);
  const { state, condition } = loaded.value;
  if (condition.kind === "recovery_paused") return err(condition);
  const decision = processDeadline(state, observedAt, auditWallClockMs);
  const plan = planCommit(state, decision.nextState, decision.events);
  if (plan === null) return ok({ decision, eventIds: NO_EVENT_IDS });
  const committed = await writer.repository.commitDecision(plan, writer.clockDomainId);
  return committed.ok ? ok({ decision, eventIds: committed.value.eventIds }) : err(committed.error);
}

/**
 * Makes `lease` the stored control lease of `seat`, compare-and-set on the
 * stored sequence. It runs in every condition, a recovery pause and a
 * finished game included: the lease decides who may send commands, never
 * whether a command is played, and the rotation touches no clock field.
 * The same lease writes nothing.
 */
export async function executeLeaseRotation(
  writer: LiveGameWriter,
  gameId: GameId,
  seat: Seat,
  lease: ControlLeaseId,
): Promise<Result<LeaseRotation, LeaseRotationFailure>> {
  const loaded = await loadForWriter(writer, gameId);
  if (!loaded.ok) return err(loaded.error);
  const { state } = loaded.value;
  const rotated = withControlLease(state, seat, lease);
  if (!rotated.ok) return err({ kind: rotated.error });
  if (rotated.value === state) return ok({ state, changed: false });
  const plan = planLeaseRotation(state, rotated.value);
  const committed = await writer.repository.commitDecision(plan, writer.clockDomainId);
  return committed.ok ? ok({ state: rotated.value, changed: true }) : err(committed.error);
}
