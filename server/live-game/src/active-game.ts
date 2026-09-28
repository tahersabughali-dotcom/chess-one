import {
  createInitialPosition,
  DEFAULT_RULESET_ID,
  type Position,
  type RepetitionKey,
  type RulesetId,
  repetitionKey,
} from "@chess-one/chess-rules";
import { err, type GameSequence, ok, parseGameSequence, type Result } from "@chess-one/game-values";
import { type ClockState, type MonotonicMs, startClock, type TimeControl } from "./clock.ts";
import type { CommandName, CommandShapeError } from "./commands.ts";
import type { CommandId, ControlLeaseId, GameId, PlayerId, Seat } from "./ids.ts";
import { ACTIVE, type GameStatus, positionFacts, statusFromFacts } from "./result.ts";

/**
 * Response codes of CONTRACT_CATALOG_V1 sections 2.5 and 10.1, plus the flag
 * and unresolved-state codes that the catalog does not name yet.
 */
export type ResponseCode =
  | "Accepted"
  | "IncorrectClaim"
  | "IllegalMove"
  | "NotYourTurn"
  | "StaleSequence"
  | "Unauthorized"
  | "GameAlreadyFinished"
  | "InvalidState"
  | "InvalidCommandIdentity"
  | "MoveReceivedAfterDeadline"
  | "MatingPossibilityUnresolved"
  | "TerminalPrecedenceUnresolved";

export type UnauthorizedDetail =
  | "wrong_game"
  | "seat_player_mismatch"
  | "invalid_control_lease"
  | "actor_mismatch";

export type ResponseDetail =
  | CommandShapeError
  | UnauthorizedDetail
  | "illegal_move"
  | "promotion_required"
  | "promotion_unexpected";

/**
 * Domain output for one command, not a transport schema. `sequence`,
 * `positionFen`, `clock`, and `status` describe the authoritative state after
 * the decision; a replay returns the stored original with `replayedResponse`.
 */
export interface CommandResponse {
  readonly gameId: GameId;
  readonly command: CommandName;
  readonly clientCommandId: CommandId | null;
  readonly code: ResponseCode;
  readonly detail: ResponseDetail | null;
  readonly replayedResponse: boolean;
  readonly receivedAtMonotonicMs: MonotonicMs;
  readonly sequence: GameSequence;
  readonly positionFen: string;
  readonly san: string | null;
  readonly clock: ClockState;
  readonly status: GameStatus;
}

/**
 * A binding decision (CONTRACT_CATALOG_V1 2.6), keyed by seat and client
 * command id within this game. Bindings live as long as this in-memory state;
 * production retention, pruning, and persistence are not decided.
 */
export interface CommandBinding {
  readonly seat: Seat;
  readonly clientCommandId: CommandId;
  readonly fingerprint: string;
  readonly response: CommandResponse;
}

/**
 * The authoritative state of one live game (DEC-045). It is frozen; only
 * `createActiveGame`, `processCommand`, and `processDeadline` produce valid
 * states, and a reconnect snapshot can later be read from it directly.
 * Game fields change only through a committed transition, which also advances
 * `sequence` by one. A binding rejection adds a command binding and nothing else.
 */
export interface ActiveGameState {
  readonly gameId: GameId;
  readonly rulesetId: RulesetId;
  readonly players: Readonly<Record<Seat, PlayerId>>;
  readonly controlLeases: Readonly<Record<Seat, ControlLeaseId>>;
  readonly position: Position;
  /** Repetition keys of every committed position, from the start position to the current one. */
  readonly history: readonly RepetitionKey[];
  readonly sequence: GameSequence;
  readonly clock: ClockState;
  readonly status: GameStatus;
  readonly commandBindings: readonly CommandBinding[];
}

export interface NewGame {
  readonly gameId: GameId;
  readonly rulesetId?: RulesetId;
  readonly players: Readonly<Record<Seat, PlayerId>>;
  readonly controlLeases: Readonly<Record<Seat, ControlLeaseId>>;
  readonly timeControl: TimeControl;
  /** Writer-domain monotonic instant at which the trusted caller starts the clocks. */
  readonly startedAtMonotonicMs: MonotonicMs;
  /**
   * Trusted server seam; defaults to the ruleset's initial position. A client
   * never supplies it, and no product flow starts from another position yet.
   */
  readonly startPosition?: Position;
}

export type NewGameError =
  | "same_player_on_both_seats"
  | "shared_control_lease"
  | "empty_time_control"
  | "start_position_not_active";

function defect(message: string): never {
  throw new Error(`Live game defect: ${message}`);
}

const INITIAL_SEQUENCE: GameSequence = parseGameSequence(0) ?? defect("sequence 0 is invalid");

/**
 * Sequence 0 is the created, running game. Each committed transition adds one.
 * The side to move of the start position has the running clock.
 */
export function createActiveGame(game: NewGame): Result<ActiveGameState, NewGameError> {
  const rulesetId = game.rulesetId ?? DEFAULT_RULESET_ID;
  const position = game.startPosition ?? createInitialPosition(rulesetId);
  const { players, controlLeases, timeControl } = game;
  if (players.white === players.black) return err("same_player_on_both_seats");
  if (controlLeases.white === controlLeases.black) return err("shared_control_lease");
  if (timeControl.initialMs === 0) return err("empty_time_control");
  const history = Object.freeze([repetitionKey(position)]);
  if (statusFromFacts(positionFacts(history, position)).kind !== "active") {
    return err("start_position_not_active");
  }
  const clock = startClock(timeControl, game.startedAtMonotonicMs, position.sideToMove);
  return ok(
    Object.freeze({
      gameId: game.gameId,
      rulesetId,
      players: Object.freeze({ ...players }),
      controlLeases: Object.freeze({ ...controlLeases }),
      position,
      history,
      sequence: INITIAL_SEQUENCE,
      clock,
      status: ACTIVE,
      commandBindings: Object.freeze([]),
    }),
  );
}
