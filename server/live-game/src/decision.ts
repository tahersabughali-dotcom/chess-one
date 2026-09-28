import { formatFen } from "@chess-one/chess-rules";
import { nextGameSequence } from "@chess-one/game-values";
import type {
  ActiveGameState,
  CommandResponse,
  ResponseCode,
  ResponseDetail,
} from "./active-game.ts";
import type { MonotonicMs, WallClockMs } from "./clock.ts";
import { withBinding } from "./command-identity.ts";
import type { CommandName } from "./commands.ts";
import { type FinishProvenance, type GameFinishedV1, gameFinished } from "./events.ts";
import type { CommandId, ControlLeaseId, GameId, PlayerId, Seat } from "./ids.ts";

/**
 * Trusted invocation context: the server resolves it from the authenticated
 * session and the current control lease. No command field can establish it.
 */
export interface AuthorizedGameActor {
  readonly gameId: GameId;
  readonly playerId: PlayerId;
  readonly seat: Seat;
  readonly controlLeaseId: ControlLeaseId;
}

/** Trusted ingress facts stamped by the writer at receipt (DEC-061, DEC-063). */
export interface Ingress {
  readonly receivedAtMonotonicMs: MonotonicMs;
  /** Audit only; never decides acceptance, a deadline, or a flag. */
  readonly auditWallClockMs?: WallClockMs;
}

/** One atomic decision. The input state is never modified. */
export interface CommandDecision {
  readonly nextState: ActiveGameState;
  readonly response: CommandResponse;
  readonly events: readonly GameFinishedV1[];
}

export interface Attempt {
  readonly state: ActiveGameState;
  readonly actor: AuthorizedGameActor;
  readonly ingress: Ingress;
  readonly name: CommandName;
  readonly commandId: CommandId | null;
}

export interface JudgedAttempt extends Attempt {
  readonly commandId: CommandId;
  readonly fingerprint: string;
}

export type Changes = Pick<ActiveGameState, "clock" | "status"> &
  Partial<Pick<ActiveGameState, "position" | "history" | "pendingDrawOffer" | "lastDrawOfferMove">>;

export const NO_EVENTS: readonly GameFinishedV1[] = Object.freeze([]);

export function defect(message: string): never {
  throw new Error(`Live game defect: ${message}`);
}

export function respond(
  attempt: Attempt,
  state: ActiveGameState,
  code: ResponseCode,
  detail: ResponseDetail | null,
  san: string | null,
): CommandResponse {
  return Object.freeze({
    gameId: state.gameId,
    command: attempt.name,
    clientCommandId: attempt.commandId,
    code,
    detail,
    replayedResponse: false,
    receivedAtMonotonicMs: attempt.ingress.receivedAtMonotonicMs,
    sequence: state.sequence,
    positionFen: formatFen(state.position),
    san,
    clock: state.clock,
    status: state.status,
  });
}

/** A rejection that does not decide the command: the state is returned unchanged. */
export function reject(
  attempt: Attempt,
  code: ResponseCode,
  detail: ResponseDetail | null = null,
): CommandDecision {
  const response = respond(attempt, attempt.state, code, detail, null);
  return Object.freeze({ nextState: attempt.state, response, events: NO_EVENTS });
}

/** Stores `response` as the binding decision of this seat and command id. */
export function bound(
  attempt: JudgedAttempt,
  state: ActiveGameState,
  response: CommandResponse,
  events: readonly GameFinishedV1[],
): CommandDecision {
  const { seat } = attempt.actor;
  const nextState = withBinding(state, seat, attempt.commandId, attempt.fingerprint, response);
  return Object.freeze({ nextState, response, events });
}

/** A binding rejection: only the command binding is added. */
export function bindRejection(
  attempt: JudgedAttempt,
  code: ResponseCode,
  detail: ResponseDetail | null = null,
): CommandDecision {
  return bound(
    attempt,
    attempt.state,
    respond(attempt, attempt.state, code, detail, null),
    NO_EVENTS,
  );
}

/**
 * A committed transition advances the sequence by exactly one. A transition
 * that stops the game, finished or unresolved, also drops any pending draw
 * offer, so no offer can be accepted after a result, a flag, or a resignation.
 */
export function commit(state: ActiveGameState, changes: Changes): ActiveGameState {
  const sequence = nextGameSequence(state.sequence);
  if (!sequence.ok) defect("sequence overflow");
  const next = { ...state, ...changes, sequence: sequence.value };
  return Object.freeze(next.status.kind === "active" ? next : { ...next, pendingDrawOffer: null });
}

/**
 * The `game.finished.v1` of a committed state: exactly one when that
 * transition finished the game, none otherwise. Only the transition that
 * finishes a game calls this, and a finished state accepts no transition, so
 * a game has at most one such event.
 */
export function finishEvents(
  committed: ActiveGameState,
  provenance: FinishProvenance,
  occurredAt: WallClockMs | null,
): readonly GameFinishedV1[] {
  return committed.status.kind === "finished"
    ? Object.freeze([gameFinished(committed, committed.status.result, provenance, occurredAt)])
    : NO_EVENTS;
}

function commandProvenance(attempt: JudgedAttempt): FinishProvenance {
  return { command: attempt.name, seat: attempt.actor.seat, clientCommandId: attempt.commandId };
}

/** Binds `response` over an already committed state, with its finish event if any. */
export function boundCommitted(
  attempt: JudgedAttempt,
  committed: ActiveGameState,
  code: ResponseCode,
  detail: ResponseDetail | null,
  san: string | null,
): CommandDecision {
  const response = respond(attempt, committed, code, detail, san);
  const events = finishEvents(
    committed,
    commandProvenance(attempt),
    attempt.ingress.auditWallClockMs ?? null,
  );
  return bound(attempt, committed, response, events);
}

export function commitAndBind(
  attempt: JudgedAttempt,
  changes: Changes,
  code: ResponseCode,
  detail: ResponseDetail | null,
  san: string | null,
): CommandDecision {
  return boundCommitted(attempt, commit(attempt.state, changes), code, detail, san);
}
