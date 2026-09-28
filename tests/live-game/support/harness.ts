import { formatFen, type Position } from "@chess-one/chess-rules";
import { type DurationMs, parseDurationMs } from "@chess-one/game-values";
import {
  type ActiveGameState,
  type AuthorizedGameActor,
  CLAIM_DRAW_COMMAND_V1,
  type ClaimDrawCommandV1,
  type CommandDecision,
  type CommandId,
  type ControlLeaseId,
  createActiveGame,
  type GameId,
  type Ingress,
  isCommandId,
  isControlLeaseId,
  isGameId,
  isMonotonicMs,
  isPlayerId,
  type LiveGameCommand,
  type MonotonicMs,
  OFFER_DRAW_COMMAND_V1,
  type OfferDrawCommandV1,
  type PlayerId,
  processCommand,
  RESIGN_GAME_COMMAND_V1,
  RESPOND_DRAW_OFFER_COMMAND_V1,
  type ResignGameCommandV1,
  type RespondDrawOfferCommandV1,
  type Seat,
  SUBMIT_MOVE_COMMAND_V1,
  type SubmitMoveCommandV1,
} from "@chess-one/live-game";

/**
 * Test-only harness for the live-game authority. Time is a fake writer
 * timeline: every instant is passed explicitly, so no test reads a real clock.
 */
export const START_MS = 1_000;
export const INITIAL_MS = 300_000;
export const PENALTY_MS = 120_000;

function valid<T extends string>(value: string, guard: (value: string) => value is T): T {
  if (!guard(value)) throw new Error(`invalid test id ${value}`);
  return value;
}

export function ms(value: number): MonotonicMs {
  if (!isMonotonicMs(value)) throw new Error(`invalid monotonic instant ${value}`);
  return value;
}

export function duration(value: number): DurationMs {
  const parsed = parseDurationMs(value);
  if (parsed === undefined) throw new Error(`invalid duration ${value}`);
  return parsed;
}

export const GAME_ID: GameId = valid("game-1", isGameId);
export const OTHER_GAME_ID: GameId = valid("game-2", isGameId);
export const PLAYERS: Readonly<Record<Seat, PlayerId>> = {
  white: valid("player-alice", isPlayerId),
  black: valid("player-bob", isPlayerId),
};
export const STRANGER: PlayerId = valid("player-mallory", isPlayerId);
export const LEASES: Readonly<Record<Seat, ControlLeaseId>> = {
  white: valid("lease-white-1", isControlLeaseId),
  black: valid("lease-black-1", isControlLeaseId),
};
export const REPLACED_LEASE: ControlLeaseId = valid("lease-white-0", isControlLeaseId);
export const ROTATED_WHITE_LEASE: ControlLeaseId = valid("lease-white-2", isControlLeaseId);

/**
 * Test-only seam: the state a future, legitimate lease replacement would
 * produce for `seat`. No production takeover API exists.
 */
export function withRotatedLease(
  state: ActiveGameState,
  seat: Seat,
  lease: ControlLeaseId,
): ActiveGameState {
  return Object.freeze({
    ...state,
    controlLeases: Object.freeze({ ...state.controlLeases, [seat]: lease }),
  });
}

export function commandId(value: string): CommandId {
  return valid(value, isCommandId);
}

export interface GameOptions {
  readonly startPosition?: Position;
  readonly initialMs?: number;
  readonly startedAt?: number;
}

export function newGame(options: GameOptions = {}): ActiveGameState {
  const created = createActiveGame({
    gameId: GAME_ID,
    players: PLAYERS,
    controlLeases: LEASES,
    timeControl: { kind: "sudden_death", initialMs: duration(options.initialMs ?? INITIAL_MS) },
    startedAtMonotonicMs: ms(options.startedAt ?? START_MS),
    ...(options.startPosition === undefined ? {} : { startPosition: options.startPosition }),
  });
  if (!created.ok) throw new Error(`game not created: ${created.error}`);
  return created.value;
}

export function actorFor(state: ActiveGameState, seat: Seat): AuthorizedGameActor {
  return {
    gameId: state.gameId,
    playerId: state.players[seat],
    seat,
    controlLeaseId: state.controlLeases[seat],
  };
}

export function at(time: number): Ingress {
  return { receivedAtMonotonicMs: ms(time) };
}

function squares(
  uci: string,
): Pick<SubmitMoveCommandV1, "fromSquare" | "toSquare" | "promotionPiece"> {
  const promotion = uci.slice(4);
  return {
    fromSquare: uci.slice(0, 2),
    toSquare: uci.slice(2, 4),
    ...(promotion === "" ? {} : { promotionPiece: promotion }),
  };
}

/** A well-formed move command for the side to move; the default id is unique per move. */
export function moveCommand(
  state: ActiveGameState,
  uci: string,
  fields: Partial<SubmitMoveCommandV1> = {},
): SubmitMoveCommandV1 {
  const seat = state.position.sideToMove;
  return {
    command: SUBMIT_MOVE_COMMAND_V1,
    contractVersion: "1",
    gameId: state.gameId,
    clientCommandId: `${seat}-${state.sequence}-${uci}`,
    controlLeaseId: state.controlLeases[seat],
    expectedGameSequence: state.sequence,
    ...squares(uci),
    ...fields,
  };
}

export function claimCommand(
  state: ActiveGameState,
  claimKind: string,
  intended?: string,
  fields: Partial<ClaimDrawCommandV1> = {},
): ClaimDrawCommandV1 {
  const seat = state.position.sideToMove;
  return {
    command: CLAIM_DRAW_COMMAND_V1,
    contractVersion: "1",
    gameId: state.gameId,
    clientCommandId: `${seat}-${state.sequence}-claim-${claimKind}-${intended ?? "none"}`,
    controlLeaseId: state.controlLeases[seat],
    expectedGameSequence: state.sequence,
    claimKind,
    ...(intended === undefined ? {} : squares(intended)),
    ...fields,
  };
}

/** A well-formed resignation by `seat`, on either turn. */
export function resignCommand(
  state: ActiveGameState,
  seat: Seat,
  fields: Partial<ResignGameCommandV1> = {},
): ResignGameCommandV1 {
  return {
    command: RESIGN_GAME_COMMAND_V1,
    contractVersion: "1",
    gameId: state.gameId,
    clientCommandId: `${seat}-${state.sequence}-resign`,
    controlLeaseId: state.controlLeases[seat],
    expectedGameSequence: state.sequence,
    ...fields,
  };
}

/** A well-formed draw offer by `seat`. */
export function offerCommand(
  state: ActiveGameState,
  seat: Seat,
  fields: Partial<OfferDrawCommandV1> = {},
): OfferDrawCommandV1 {
  return {
    command: OFFER_DRAW_COMMAND_V1,
    contractVersion: "1",
    gameId: state.gameId,
    clientCommandId: `${seat}-${state.sequence}-offer`,
    controlLeaseId: state.controlLeases[seat],
    expectedGameSequence: state.sequence,
    ...fields,
  };
}

/** A well-formed response by `seat` to the pending offer (offer id 0 when none is pending). */
export function respondCommand(
  state: ActiveGameState,
  seat: Seat,
  decision: string,
  fields: Partial<RespondDrawOfferCommandV1> = {},
): RespondDrawOfferCommandV1 {
  return {
    command: RESPOND_DRAW_OFFER_COMMAND_V1,
    contractVersion: "1",
    gameId: state.gameId,
    clientCommandId: `${seat}-${state.sequence}-respond-${decision}`,
    controlLeaseId: state.controlLeases[seat],
    expectedGameSequence: state.sequence,
    offerId: state.pendingDrawOffer?.createdAtSequence ?? 0,
    decision,
    ...fields,
  };
}

/** Submits `command` as `seat` (default: the side to move) received at `time`. */
export function submit(
  state: ActiveGameState,
  command: LiveGameCommand,
  time: number,
  seat: Seat = state.position.sideToMove,
): CommandDecision {
  return processCommand(state, actorFor(state, seat), command, at(time));
}

export interface Played {
  readonly state: ActiveGameState;
  readonly time: number;
}

/** Plays accepted moves `stepMs` apart, starting after `time`. */
export function playMoves(
  state: ActiveGameState,
  plies: readonly string[],
  time = START_MS,
  stepMs = 10,
): Played {
  let current = state;
  let now = time;
  for (const uci of plies) {
    now += stepMs;
    const decision = submit(current, moveCommand(current, uci), now);
    if (decision.response.code !== "Accepted") {
      throw new Error(`${uci} was ${decision.response.code} at sequence ${current.sequence}`);
    }
    current = decision.nextState;
  }
  return { state: current, time: now };
}

/** Plain data that captures every observable field of a state. */
export function snapshot(state: ActiveGameState): unknown {
  return {
    gameId: state.gameId,
    rulesetId: state.rulesetId,
    players: { ...state.players },
    controlLeases: { ...state.controlLeases },
    fen: formatFen(state.position),
    history: [...state.history],
    sequence: state.sequence,
    clock: {
      ...state.clock,
      timeControl: { ...state.clock.timeControl },
      remainingMs: { ...state.clock.remainingMs },
    },
    status: JSON.parse(JSON.stringify(state.status)),
    pendingDrawOffer: state.pendingDrawOffer === null ? null : { ...state.pendingDrawOffer },
    lastDrawOfferMove: state.lastDrawOfferMove,
    commandBindings: state.commandBindings.map((binding) => ({
      seat: binding.seat,
      clientCommandId: binding.clientCommandId,
      fingerprint: binding.fingerprint,
      code: binding.response.code,
      sequence: binding.response.sequence,
    })),
  };
}
