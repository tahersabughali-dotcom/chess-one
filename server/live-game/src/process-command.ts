import {
  applyLegalMove,
  type DrawClaim,
  type DrawClaimKind,
  evaluateDrawClaim,
  formatFen,
  type Position,
  repetitionKey,
  toCanonicalSan,
} from "@chess-one/chess-rules";
import {
  type MoveIntent,
  nextGameSequence,
  oppositeColor,
  parseDurationMs,
} from "@chess-one/game-values";
import type {
  ActiveGameState,
  CommandResponse,
  ResponseCode,
  ResponseDetail,
  UnauthorizedDetail,
} from "./active-game.ts";
import {
  addTime,
  type ClockState,
  chargeToReceipt,
  flagActive,
  type MonotonicMs,
  passTurn,
  receiptTiming,
  stopClock,
  type WallClockMs,
} from "./clock.ts";
import { findBinding, fingerprintOf, replayedResponse, withBinding } from "./command-identity.ts";
import {
  type CommandName,
  type LiveGameCommand,
  type ParsedCommand,
  parseCommand,
} from "./commands.ts";
import { type GameFinishedV1, gameFinished } from "./events.ts";
import type { CommandId, ControlLeaseId, GameId, PlayerId, Seat } from "./ids.ts";
import {
  type DrawRuleDetail,
  drawResult,
  type GameStatus,
  positionFacts,
  statusFromFacts,
} from "./result.ts";

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

export interface DeadlineDecision {
  readonly nextState: ActiveGameState;
  readonly flagged: boolean;
}

interface Attempt {
  readonly state: ActiveGameState;
  readonly actor: AuthorizedGameActor;
  readonly ingress: Ingress;
  readonly name: CommandName;
  readonly commandId: CommandId | null;
}

interface JudgedAttempt extends Attempt {
  readonly commandId: CommandId;
  readonly fingerprint: string;
}

type Changes = Pick<ActiveGameState, "clock" | "status"> &
  Partial<Pick<ActiveGameState, "position" | "history">>;

const NO_EVENTS: readonly GameFinishedV1[] = Object.freeze([]);

function defect(message: string): never {
  throw new Error(`Live game defect: ${message}`);
}

function respond(
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
function reject(
  attempt: Attempt,
  code: ResponseCode,
  detail: ResponseDetail | null = null,
): CommandDecision {
  const response = respond(attempt, attempt.state, code, detail, null);
  return Object.freeze({ nextState: attempt.state, response, events: NO_EVENTS });
}

/** Stores `response` as the binding decision of this seat and command id. */
function bound(
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
function bindRejection(
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

/** A committed transition advances the sequence by exactly one. */
function commit(state: ActiveGameState, changes: Changes): ActiveGameState {
  const sequence = nextGameSequence(state.sequence);
  if (!sequence.ok) defect("sequence overflow");
  return Object.freeze({ ...state, ...changes, sequence: sequence.value });
}

function commitAndBind(
  attempt: JudgedAttempt,
  changes: Changes,
  code: ResponseCode,
  detail: ResponseDetail | null,
  san: string | null,
): CommandDecision {
  const committed = commit(attempt.state, changes);
  const response = respond(attempt, committed, code, detail, san);
  const events =
    committed.status.kind === "finished"
      ? Object.freeze([
          gameFinished(
            committed,
            committed.status.result,
            { command: attempt.name, seat: attempt.actor.seat, clientCommandId: attempt.commandId },
            attempt.ingress.auditWallClockMs ?? null,
          ),
        ])
      : NO_EVENTS;
  return bound(attempt, committed, response, events);
}

/** Commits a legal move: history grows by one key, then terminal facts decide the clock. */
function playMove(
  attempt: JudgedAttempt,
  charged: ClockState,
  position: Position,
  san: string,
  code: "Accepted" | "IncorrectClaim",
): CommandDecision {
  const { state } = attempt;
  if (state.history.at(-1)?.equals(repetitionKey(state.position)) !== true) {
    defect("history does not end at the position");
  }
  const history = Object.freeze([...state.history, repetitionKey(position)]);
  const status = statusFromFacts(positionFacts(history, position));
  const clock = status.kind === "active" ? passTurn(charged) : stopClock(charged);
  return commitAndBind(attempt, { position, history, clock, status }, code, null, san);
}

function sanOf(position: Position, move: MoveIntent): string {
  const san = toCanonicalSan(position, move);
  return san.ok ? san.value : defect("a legal move has no canonical SAN");
}

function submitMove(attempt: JudgedAttempt, move: MoveIntent): CommandDecision {
  const { state } = attempt;
  const next = applyLegalMove(state.position, move);
  if (!next.ok) {
    return bindRejection(
      attempt,
      next.error === "illegal_move" ? "IllegalMove" : "InvalidState",
      next.error,
    );
  }
  const charged = chargeToReceipt(state.clock, attempt.ingress.receivedAtMonotonicMs);
  return playMove(attempt, charged, next.value, sanOf(state.position, move), "Accepted");
}

function claimDetail(kind: DrawClaimKind): DrawRuleDetail {
  return kind === "threefold_current" || kind === "threefold_intended"
    ? "threefold_claim"
    : "fifty_move_claim";
}

/**
 * CONTRACT_CATALOG_V1 10.1 and LIVE_GAME_EVENT_ORDERING_V1 section 5, over
 * the pure `evaluateDrawClaim`. The claimant is charged to receipt in every
 * committed outcome, and each outcome is one transition:
 * - correct: drawn at once; an intended move is not applied;
 * - incorrect: +120000 ms to the opponent; a legal intended move is then
 *   applied in the same transition;
 * - illegal intended move: the penalty applies, the move is not applied, and
 *   the response is `IllegalMove`.
 * A missing or unexpected promotion is an unusable shape (`InvalidState`), as
 * for a move command, and changes nothing but the binding.
 */
function claimDraw(attempt: JudgedAttempt, claim: DrawClaim): CommandDecision {
  const { state } = attempt;
  const assessed = evaluateDrawClaim(state.history, state.position, claim);
  if (!assessed.ok) defect("history does not end at the position");
  const assessment = assessed.value;
  const intended = assessment.intendedMove;
  if (intended?.disposition === "illegal" && intended.error !== "illegal_move") {
    return bindRejection(attempt, "InvalidState", intended.error);
  }
  const charged = chargeToReceipt(state.clock, attempt.ingress.receivedAtMonotonicMs);
  if (assessment.verdict === "correct") {
    const status: GameStatus = Object.freeze({
      kind: "finished",
      result: drawResult([claimDetail(assessment.kind)]),
    });
    return commitAndBind(attempt, { clock: stopClock(charged), status }, "Accepted", null, null);
  }
  const bonus = parseDurationMs(assessment.opponentBonusMs) ?? defect("penalty is not a duration");
  const penalized = addTime(charged, oppositeColor(attempt.actor.seat), bonus);
  if (intended?.disposition === "must_apply") {
    const san = sanOf(state.position, intended.move);
    return playMove(attempt, penalized, intended.resultingPosition, san, "IncorrectClaim");
  }
  const changes: Changes = { clock: penalized, status: state.status };
  return intended?.disposition === "illegal"
    ? commitAndBind(attempt, changes, "IllegalMove", "illegal_move", null)
    : commitAndBind(attempt, changes, "IncorrectClaim", null, null);
}

/**
 * Article 6.9 via LIVE_GAME_EVENT_ORDERING_V1 section 3. The flagged side
 * loses unless its opponent cannot checkmate by any series of legal moves.
 * That is a one-sided question (GAP-MATE-004) that no reviewed function
 * answers: `assessMatingPossibility` judges the whole position and cannot
 * prove that this opponent can mate. Every flag is therefore
 * MATING_POSSIBILITY_UNRESOLVED, with no win, loss, draw, or game.finished.v1
 * (DEC-064). The flagged balance is zero and the clock stops.
 */
function flagTransition(state: ActiveGameState, at: MonotonicMs): ActiveGameState {
  return commit(state, {
    clock: flagActive(state.clock, at),
    status: Object.freeze({
      kind: "unresolved",
      reason: "MATING_POSSIBILITY_UNRESOLVED",
      flaggedSide: state.clock.activeSide,
    }),
  });
}

function authorizationFailure(
  state: ActiveGameState,
  actor: AuthorizedGameActor,
  command: ParsedCommand,
): UnauthorizedDetail | null {
  if (actor.gameId !== state.gameId || command.gameId !== state.gameId) return "wrong_game";
  if (state.players[actor.seat] !== actor.playerId) return "seat_player_mismatch";
  const lease = state.controlLeases[actor.seat];
  if (actor.controlLeaseId !== lease || command.controlLeaseId !== lease) {
    return "invalid_control_lease";
  }
  if (command.actorId !== null && command.actorId !== actor.playerId) return "actor_mismatch";
  return null;
}

/**
 * Processes one command against one state, in CONTRACT_CATALOG_V1 2.3 order:
 *
 * 1. shape (`InvalidState`, not bound);
 * 2. game, player, seat, control lease, and `actor_id` echo from the trusted
 *    actor (`Unauthorized`, not bound);
 * 3. command identity: a stored binding with the same fingerprint is replayed
 *    unchanged; a different fingerprint is `InvalidCommandIdentity`;
 * 4. a finished game is `GameAlreadyFinished` (not bound); an unresolved game
 *    is rejected with its reason (not bound);
 * 5. the seat must be the side to move (`NotYourTurn`, bound);
 * 6. `expected_game_sequence` must be current (`StaleSequence`, not bound);
 * 7. deadline at `received_at`: a late command is not applied and commits the
 *    flag transition (`MoveReceivedAfterDeadline`, bound);
 * 8. legality through chess-rules, then the move or claim transition.
 *
 * Every client command that reaches a committed transition (an accepted move,
 * a correct or incorrect claim, or a late command that commits the flag) is
 * bound in the same returned state, under the one lease-scoped fingerprint.
 * Replay comes before the finished and unresolved guards, so a stored decision
 * is still replayed after the game stops. A finished state is fully absorbing:
 * every later command returns the same state object, and no binding is added
 * after the finish. A rejected command changes no clock field: the server
 * clock keeps running from the turn anchor, so time before a rejection is
 * still charged by the next committed transition or flag.
 */
export function processCommand(
  state: ActiveGameState,
  actor: AuthorizedGameActor,
  command: LiveGameCommand,
  ingress: Ingress,
): CommandDecision {
  const parsed = parseCommand(command);
  const attempt: Attempt = {
    state,
    actor,
    ingress,
    name: command.command,
    commandId: parsed.ok ? parsed.value.clientCommandId : null,
  };
  if (!parsed.ok) return reject(attempt, "InvalidState", parsed.error);
  const parsedCommand = parsed.value;
  const unauthorized = authorizationFailure(state, actor, parsedCommand);
  if (unauthorized !== null) return reject(attempt, "Unauthorized", unauthorized);

  const fingerprint = fingerprintOf(parsedCommand);
  const previous = findBinding(state, actor.seat, parsedCommand.clientCommandId);
  if (previous !== undefined) {
    return previous.fingerprint === fingerprint
      ? Object.freeze({ nextState: state, response: replayedResponse(previous), events: NO_EVENTS })
      : reject(attempt, "InvalidCommandIdentity");
  }
  const judged: JudgedAttempt = {
    ...attempt,
    commandId: parsedCommand.clientCommandId,
    fingerprint,
  };

  if (state.status.kind === "finished") return reject(attempt, "GameAlreadyFinished");
  if (state.status.kind === "unresolved") {
    return reject(
      attempt,
      state.status.reason === "MATING_POSSIBILITY_UNRESOLVED"
        ? "MatingPossibilityUnresolved"
        : "TerminalPrecedenceUnresolved",
    );
  }
  if (actor.seat !== state.position.sideToMove) return bindRejection(judged, "NotYourTurn");
  if (parsedCommand.expectedGameSequence !== state.sequence)
    return reject(attempt, "StaleSequence");

  const receivedAt = ingress.receivedAtMonotonicMs;
  if (!receiptTiming(state.clock, receivedAt).timely) {
    const flagged = flagTransition(state, receivedAt);
    const response = respond(judged, flagged, "MoveReceivedAfterDeadline", null, null);
    return bound(judged, flagged, response, NO_EVENTS);
  }
  return parsedCommand.kind === "submit_move"
    ? submitMove(judged, parsedCommand.move)
    : claimDraw(judged, parsedCommand.claim);
}

/**
 * The writer's own deadline check at `observedAt`, a monotonic instant of its
 * clock domain, for a side that sends nothing. There is no client command, so
 * nothing is bound. Before the deadline, or once the game has stopped, the
 * state is returned unchanged.
 */
export function processDeadline(state: ActiveGameState, observedAt: MonotonicMs): DeadlineDecision {
  if (state.status.kind !== "active" || receiptTiming(state.clock, observedAt).timely) {
    return Object.freeze({ nextState: state, flagged: false });
  }
  return Object.freeze({ nextState: flagTransition(state, observedAt), flagged: true });
}
