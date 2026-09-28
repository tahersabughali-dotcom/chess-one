import {
  applyLegalMove,
  type DrawClaim,
  type DrawClaimKind,
  evaluateDrawClaim,
  type Position,
  repetitionKey,
  toCanonicalSan,
} from "@chess-one/chess-rules";
import { type MoveIntent, oppositeColor, parseDurationMs } from "@chess-one/game-values";
import type { ActiveGameState, UnauthorizedDetail } from "./active-game.ts";
import { statusAfterFlag, statusAfterResignation } from "./adjudication.ts";
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
import { findBinding, fingerprintOf, replayedResponse } from "./command-identity.ts";
import { type LiveGameCommand, type ParsedCommand, parseCommand } from "./commands.ts";
import {
  type Attempt,
  type AuthorizedGameActor,
  bindRejection,
  boundCommitted,
  type Changes,
  type CommandDecision,
  commit,
  commitAndBind,
  defect,
  finishEvents,
  type Ingress,
  type JudgedAttempt,
  NO_EVENTS,
  reject,
} from "./decision.ts";
import { offerDraw, respondDrawOffer } from "./draw-offer.ts";
import type { GameFinishedV1 } from "./events.ts";
import {
  type DrawRuleDetail,
  drawResult,
  type GameStatus,
  positionFacts,
  statusFromFacts,
} from "./result.ts";

export interface DeadlineDecision {
  readonly nextState: ActiveGameState;
  readonly flagged: boolean;
  /** `game.finished.v1` exactly when the flag produced a result; empty otherwise. */
  readonly events: readonly GameFinishedV1[];
}

/**
 * Commits a legal move: history grows by one key, then terminal facts decide
 * the clock. The mover is the recipient of any pending draw offer, so the move
 * declines it in this same transition (CONTRACT_CATALOG_V1 10.2).
 */
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
  const changes: Changes = { position, history, clock, status, pendingDrawOffer: null };
  return commitAndBind(attempt, changes, code, null, san);
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
 * Article 5.1.2 via CONTRACT_CATALOG_V1 10.4 as corrected by LIVE-CONTRACT-001.
 * A seat may resign on either turn. The active side is charged to receipt and
 * the clock stops; the opponent's one-sided mating capability then decides the
 * status in the same transition: a win by resignation, a draw
 * `resign_no_mate_possible`, or MATING_POSSIBILITY_UNRESOLVED with no result.
 * The response is `Accepted` in every case: the resignation is committed, and
 * the status carries its outcome.
 */
function resignGame(attempt: JudgedAttempt): CommandDecision {
  const { state } = attempt;
  const charged = chargeToReceipt(state.clock, attempt.ingress.receivedAtMonotonicMs);
  const status = statusAfterResignation(state.position, attempt.actor.seat);
  return commitAndBind(attempt, { clock: stopClock(charged), status }, "Accepted", null, null);
}

/**
 * Article 6.9 via LIVE_GAME_EVENT_ORDERING_V1 section 3, as corrected by
 * LIVE-CONTRACT-001. The flagged balance is zero, the clock stops at `at`, and
 * the opponent's one-sided mating capability decides the status in the same
 * transition: a win on time, a draw `timeout_no_mate`, or
 * MATING_POSSIBILITY_UNRESOLVED with no result (DEC-064). Every flag path, a
 * late command or the writer's own deadline check, commits through here.
 */
function flagTransition(state: ActiveGameState, at: MonotonicMs): ActiveGameState {
  return commit(state, {
    clock: flagActive(state.clock, at),
    status: statusAfterFlag(state.position, state.clock.activeSide),
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
 * 5. a move or claim seat must be the side to move (`NotYourTurn`, bound); a
 *    resignation is accepted on either turn, and a draw offer or response
 *    checks its own seat rule in `draw-offer.ts`;
 * 6. `expected_game_sequence` must be current (`StaleSequence`, not bound);
 * 7. deadline at `received_at` for the active side: a late command is not
 *    applied and commits the flag transition (`MoveReceivedAfterDeadline`,
 *    bound). The flag fell before the command arrived, so a late resignation
 *    is decided as that flag (LIVE-RESIGN-001), and a late acceptance of a
 *    draw offer creates no draw;
 * 8. legality through chess-rules, then the move, claim, resignation, draw
 *    offer, or response.
 *
 * Every client command that reaches a committed transition (an accepted move,
 * a correct or incorrect claim, a resignation, a draw offer or response, or a
 * late command that commits the flag) is bound in the same returned state,
 * under the one lease-scoped
 * fingerprint, and a transition that finishes the game carries its one
 * `game.finished.v1`. Replay comes before the finished and unresolved guards,
 * so a stored decision is still replayed after the game stops, with no event.
 * A finished state is fully absorbing: every later command returns the same
 * state object, and no binding is added after the finish. A rejected command
 * changes no clock field: the server clock keeps running from the turn anchor,
 * so time before a rejection is still charged by the next committed
 * transition or flag. A pending draw offer is cleared only by a committed
 * move, a committed response, or a committed stop of the game; no rejection
 * clears it.
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
  const turnBound = parsedCommand.kind === "submit_move" || parsedCommand.kind === "claim_draw";
  if (turnBound && actor.seat !== state.position.sideToMove) {
    return bindRejection(judged, "NotYourTurn");
  }
  if (parsedCommand.expectedGameSequence !== state.sequence)
    return reject(attempt, "StaleSequence");

  const receivedAt = ingress.receivedAtMonotonicMs;
  if (!receiptTiming(state.clock, receivedAt).timely) {
    const flagged = flagTransition(state, receivedAt);
    return boundCommitted(judged, flagged, "MoveReceivedAfterDeadline", null, null);
  }
  switch (parsedCommand.kind) {
    case "submit_move":
      return submitMove(judged, parsedCommand.move);
    case "claim_draw":
      return claimDraw(judged, parsedCommand.claim);
    case "resign_game":
      return resignGame(judged);
    case "offer_draw":
      return offerDraw(judged);
    case "respond_draw_offer":
      return respondDrawOffer(judged, parsedCommand.offerId, parsedCommand.decision);
  }
}

/**
 * The writer's own deadline check at `observedAt`, a monotonic instant of its
 * clock domain, for a side that sends nothing. There is no client command, so
 * nothing is bound; a resolved flag carries one `game.finished.v1` with
 * deadline provenance, stamped with the optional trusted audit wall clock.
 * Before the deadline, or once the game has stopped, the state is returned
 * unchanged with no event.
 */
export function processDeadline(
  state: ActiveGameState,
  observedAt: MonotonicMs,
  auditWallClockMs: WallClockMs | null = null,
): DeadlineDecision {
  if (state.status.kind !== "active" || receiptTiming(state.clock, observedAt).timely) {
    return Object.freeze({ nextState: state, flagged: false, events: NO_EVENTS });
  }
  const flaggedSide = state.clock.activeSide;
  const nextState = flagTransition(state, observedAt);
  const events = finishEvents(nextState, { writerDeadline: true, flaggedSide }, auditWallClockMs);
  return Object.freeze({ nextState, flagged: true, events });
}
