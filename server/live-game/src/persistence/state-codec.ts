import {
  formatFen,
  isRulesetId,
  type Position,
  parseFen,
  type RepetitionKey,
  repetitionKey,
} from "@chess-one/chess-rules";
import { err, type GameSequence, isGameSequence, ok, type Result } from "@chess-one/game-values";
import type { ActiveGameState, CommandBinding, PendingDrawOffer } from "../active-game.ts";
import { isAwaitingClock } from "../clock.ts";
import { isCommandId, isControlLeaseId, isGameId, isPlayerId } from "../ids.ts";
import { positionFacts, statusFromFacts } from "../result.ts";
import {
  CorruptRecord,
  corrupt,
  field,
  readArray,
  readCount,
  readGuarded,
  readNullable,
  readObject,
  readString,
} from "./records.ts";
import { decodeResponse, encodeResponse, readCanonicalFen } from "./response-codec.ts";
import { decodeClock, decodeStatus, encodeClock, encodeStatus, isColor } from "./value-codec.ts";

/**
 * The persisted format every write uses. `live_game_state.v2` is v1 plus the
 * statuses of a game before its start (`awaiting_players`,
 * `aborted_before_start`) and their stopped, unanchored clock; every v1
 * state means the same in v2. A change needs a new version and a migration.
 */
export const LIVE_GAME_STATE_FORMAT = "live_game_state.v2";

/**
 * The historical format, still read with its original rules: an active,
 * finished, or unresolved game only. A game written before v2 keeps its v1
 * record until its next commit rewrites it, unchanged in meaning, as v2.
 */
export const LIVE_GAME_STATE_FORMAT_V1 = "live_game_state.v1";

export type LiveGameStateFormat = typeof LIVE_GAME_STATE_FORMAT | typeof LIVE_GAME_STATE_FORMAT_V1;

/**
 * The format of one stored command binding. A binding exists only for a
 * command decided in an active game, so its record did not change with the
 * state's v2 and keeps the v1 name.
 */
export const COMMAND_BINDING_RECORD_FORMAT = "live_game_state.v1";

export function isLiveGameStateFormat(value: unknown): value is LiveGameStateFormat {
  return value === LIVE_GAME_STATE_FORMAT || value === LIVE_GAME_STATE_FORMAT_V1;
}

/**
 * `live_game_state.v2` (and v1, with the same fields): the aggregate without
 * its command bindings, which are stored one record each. Plain data only.
 * `positionFen` restores the full current position (halfmove, fullmove, raw
 * en passant). `repetitionHistory` holds the canonical repetition-key text of
 * every committed position, from the start position to the current one; it
 * is never derived from a FEN.
 */
export interface LiveGameStateRecord {
  readonly format: typeof LIVE_GAME_STATE_FORMAT;
  readonly gameId: string;
  readonly rulesetId: string;
  readonly players: { readonly white: string; readonly black: string };
  readonly controlLeases: { readonly white: string; readonly black: string };
  readonly positionFen: string;
  readonly repetitionHistory: readonly string[];
  readonly sequence: number;
  readonly clock: unknown;
  readonly status: unknown;
  readonly pendingDrawOffer: unknown;
  readonly lastDrawOfferMove: number | null;
}

/** One stored binding decision; `ordinal` is its place in the game's binding order. */
export interface CommandBindingRecordV1 {
  readonly ordinal: number;
  readonly seat: string;
  readonly clientCommandId: string;
  readonly fingerprint: string;
  readonly boundAtSequence: number;
  readonly response: unknown;
}

export interface CorruptState {
  readonly kind: "corrupt_state";
  readonly path: string;
  readonly reason: string;
}

const STATE_FIELDS = [
  "format",
  "gameId",
  "rulesetId",
  "players",
  "controlLeases",
  "positionFen",
  "repetitionHistory",
  "sequence",
  "clock",
  "status",
  "pendingDrawOffer",
  "lastDrawOfferMove",
] as const;

const BINDING_FIELDS = [
  "ordinal",
  "seat",
  "clientCommandId",
  "fingerprint",
  "boundAtSequence",
  "response",
] as const;

export function encodeGameState(state: ActiveGameState): LiveGameStateRecord {
  const offer = state.pendingDrawOffer;
  return {
    format: LIVE_GAME_STATE_FORMAT,
    gameId: state.gameId,
    rulesetId: state.rulesetId,
    players: { white: state.players.white, black: state.players.black },
    controlLeases: { white: state.controlLeases.white, black: state.controlLeases.black },
    positionFen: formatFen(state.position),
    repetitionHistory: state.history.map((key) => key.text),
    sequence: state.sequence,
    clock: encodeClock(state.clock),
    status: encodeStatus(state.status),
    pendingDrawOffer:
      offer === null
        ? null
        : {
            offeredBy: offer.offeredBy,
            offeredTo: offer.offeredTo,
            createdAtSequence: offer.createdAtSequence,
          },
    lastDrawOfferMove: state.lastDrawOfferMove,
  };
}

export function encodeBinding(binding: CommandBinding, ordinal: number): CommandBindingRecordV1 {
  return {
    ordinal,
    seat: binding.seat,
    clientCommandId: binding.clientCommandId,
    fingerprint: binding.fingerprint,
    boundAtSequence: binding.response.sequence,
    response: encodeResponse(binding.response),
  };
}

function readSequence(value: unknown, path: string): GameSequence {
  const count = readCount(value, path);
  return isGameSequence(count) ? count : corrupt(path, "not a game sequence");
}

/** Repetition-key text back to the FEN of a position with exactly that identity. */
function fenOfKey(text: string, path: string): string {
  const match = /^([PNBRQKpnbrqk.]{64}) ([wb]) ([K-][Q-][k-][q-]) (-|[a-h][36])$/.exec(text);
  if (match === null) corrupt(path, "not a repetition key");
  const [, board = "", side = "", castling = "", enPassant = ""] = match;
  const ranks: string[] = [];
  for (let rank = 7; rank >= 0; rank -= 1) {
    const row = board.slice(rank * 8, rank * 8 + 8).replace(/\.+/g, (run) => String(run.length));
    ranks.push(row);
  }
  const rights = castling.replaceAll("-", "");
  return `${ranks.join("/")} ${side} ${rights === "" ? "-" : rights} ${enPassant} 0 1`;
}

/**
 * A stored key is accepted only if it is the identity of a canonical position:
 * its text rebuilds a position that `parseFen` accepts, and `repetitionKey` of
 * that position has the same text. The key object then comes from
 * `repetitionKey`, its only constructor.
 */
function restoreKey(value: unknown, path: string): RepetitionKey {
  const text = readString(value, path);
  const parsed = parseFen(fenOfKey(text, path));
  if (!parsed.ok) corrupt(path, `repetition key is not a legal position (${parsed.error.code})`);
  const key = repetitionKey(parsed.value);
  return key.text === text ? key : corrupt(path, "repetition key is not canonical");
}

function decodeHistory(value: unknown, position: Position): readonly RepetitionKey[] {
  const path = "state.repetitionHistory";
  const keys = readArray(value, path).map((item, index) => restoreKey(item, `${path}[${index}]`));
  if (keys.length === 0) corrupt(path, "empty history");
  keys.forEach((key, index) => {
    const previous = keys[index - 1];
    if (previous !== undefined && previous.text.split(" ")[1] === key.text.split(" ")[1]) {
      corrupt(`${path}[${index}]`, "consecutive entries have the same side to move");
    }
  });
  if (keys.at(-1)?.equals(repetitionKey(position)) !== true) {
    corrupt(path, "last entry is not the current position");
  }
  return Object.freeze(keys);
}

function decodeOffer(value: unknown, path: string): PendingDrawOffer {
  const fields = readObject(value, path, ["offeredBy", "offeredTo", "createdAtSequence"]);
  return Object.freeze({
    offeredBy: readGuarded(field(fields, "offeredBy"), `${path}.offeredBy`, isColor),
    offeredTo: readGuarded(field(fields, "offeredTo"), `${path}.offeredTo`, isColor),
    createdAtSequence: readSequence(
      field(fields, "createdAtSequence"),
      `${path}.createdAtSequence`,
    ),
  });
}

function decodeBinding(value: unknown, path: string, expectedOrdinal: number): CommandBinding {
  const fields = readObject(value, path, BINDING_FIELDS);
  if (readCount(field(fields, "ordinal"), `${path}.ordinal`) !== expectedOrdinal) {
    corrupt(`${path}.ordinal`, "bindings are not contiguous");
  }
  const seat = readGuarded(field(fields, "seat"), `${path}.seat`, isColor);
  const clientCommandId = readGuarded(
    field(fields, "clientCommandId"),
    `${path}.clientCommandId`,
    isCommandId,
  );
  const fingerprint = readString(field(fields, "fingerprint"), `${path}.fingerprint`);
  if (fingerprint === "") corrupt(`${path}.fingerprint`, "empty fingerprint");
  const response = decodeResponse(field(fields, "response"), `${path}.response`);
  if (response.clientCommandId !== clientCommandId) {
    corrupt(`${path}.response.clientCommandId`, "does not match the binding");
  }
  if (response.replayedResponse)
    corrupt(`${path}.response.replayedResponse`, "a stored decision is never a replay");
  if (
    readSequence(field(fields, "boundAtSequence"), `${path}.boundAtSequence`) !== response.sequence
  ) {
    corrupt(`${path}.boundAtSequence`, "does not match the stored response");
  }
  return Object.freeze({ seat, clientCommandId, fingerprint, response });
}

/**
 * A game before its start (awaiting, sequence 0) or one aborted instead of
 * starting (sequence 1): the start position, the full balances on a stopped
 * clock with no anchor, the first side to move marked active, and nothing
 * decided: no binding, no offer.
 */
function checkPreGame(state: ActiveGameState, sequence: number): void {
  const { clock, position } = state;
  if (state.sequence !== sequence) corrupt("state.sequence", "not the pre-game sequence");
  if (state.history.length !== 1) corrupt("state.repetitionHistory", "moves before the start");
  if (!isAwaitingClock(clock)) corrupt("state.clock", "not the clock of an unstarted game");
  if (clock.activeSide !== position.sideToMove) {
    corrupt("state.clock.activeSide", "the first side to move is marked active");
  }
  if (state.lastDrawOfferMove !== null) corrupt("state.lastDrawOfferMove", "offer before start");
  if (state.commandBindings.length > 0) corrupt("bindings", "a command bound before the start");
}

/** Cross-field invariants that every state produced by the live-game core satisfies. */
function checkInvariants(state: ActiveGameState): void {
  const { status, clock, position, pendingDrawOffer: offer } = state;
  const moves = state.history.length - 1;
  if (state.players.white === state.players.black) corrupt("state.players", "same player twice");
  if (state.controlLeases.white === state.controlLeases.black) {
    corrupt("state.controlLeases", "shared control lease");
  }
  if (status.kind === "awaiting_players" || status.kind === "aborted_before_start") {
    checkPreGame(state, status.kind === "awaiting_players" ? 0 : 1);
  }
  if (status.kind === "active") {
    if (!clock.running) corrupt("state.clock.running", "an active game has a running clock");
    if (clock.activeSide !== position.sideToMove) {
      corrupt("state.clock.activeSide", "the side to move owns the running clock");
    }
    if (statusFromFacts(positionFacts(state.history, position)).kind !== "active") {
      corrupt("state.status", "active, but the position has terminal facts");
    }
  } else if (clock.running) {
    corrupt("state.clock.running", "a stopped game has a running clock");
  }
  if (status.kind === "finished" && status.result.terminationReason === "checkmate") {
    const { winner } = status.result;
    const facts = positionFacts(state.history, position);
    if (!facts.some((fact) => fact.kind === "checkmate" && fact.winner === winner)) {
      corrupt("state.status.result", "checkmate, but the position is not mate");
    }
  }
  if (state.lastDrawOfferMove !== null && state.lastDrawOfferMove > moves) {
    corrupt("state.lastDrawOfferMove", "beyond the committed moves");
  }
  if (offer !== null) {
    const path = "state.pendingDrawOffer";
    if (status.kind !== "active") corrupt(path, "an offer on a stopped game");
    if (offer.offeredTo !== position.sideToMove || offer.offeredBy === offer.offeredTo) {
      corrupt(path, "the recipient must be the side to move");
    }
    if (offer.createdAtSequence > state.sequence)
      corrupt(path, "created after the current sequence");
    if (moves < 2 || state.lastDrawOfferMove !== moves) {
      corrupt(path, "not made on the current committed move");
    }
  }
  const seen = new Set<string>();
  state.commandBindings.forEach((binding, index) => {
    const path = `bindings[${index}]`;
    const key = `${binding.seat} ${binding.clientCommandId}`;
    if (seen.has(key)) corrupt(path, "duplicate seat and command id");
    seen.add(key);
    if (binding.response.gameId !== state.gameId) corrupt(`${path}.response.gameId`, "other game");
    if (binding.response.sequence > state.sequence) {
      corrupt(`${path}.response.sequence`, "after the current sequence");
    }
  });
}

function decode(record: unknown, bindings: readonly unknown[]): ActiveGameState {
  const fields = readObject(record, "state", STATE_FIELDS);
  const format = field(fields, "format");
  if (!isLiveGameStateFormat(format)) corrupt("state.format", "unknown serialization format");
  const players = readObject(field(fields, "players"), "state.players", ["white", "black"]);
  const leases = readObject(field(fields, "controlLeases"), "state.controlLeases", [
    "white",
    "black",
  ]);
  const fen = readCanonicalFen(field(fields, "positionFen"), "state.positionFen");
  const parsed = parseFen(fen);
  if (!parsed.ok) corrupt("state.positionFen", "invalid FEN");
  const position = parsed.value;
  const state: ActiveGameState = Object.freeze({
    gameId: readGuarded(field(fields, "gameId"), "state.gameId", isGameId),
    rulesetId: readGuarded(field(fields, "rulesetId"), "state.rulesetId", isRulesetId),
    players: Object.freeze({
      white: readGuarded(field(players, "white"), "state.players.white", isPlayerId),
      black: readGuarded(field(players, "black"), "state.players.black", isPlayerId),
    }),
    controlLeases: Object.freeze({
      white: readGuarded(field(leases, "white"), "state.controlLeases.white", isControlLeaseId),
      black: readGuarded(field(leases, "black"), "state.controlLeases.black", isControlLeaseId),
    }),
    position,
    history: decodeHistory(field(fields, "repetitionHistory"), position),
    sequence: readSequence(field(fields, "sequence"), "state.sequence"),
    clock: decodeClock(field(fields, "clock"), "state.clock"),
    status: decodeStatus(
      field(fields, "status"),
      "state.status",
      format === LIVE_GAME_STATE_FORMAT,
    ),
    pendingDrawOffer: readNullable(
      field(fields, "pendingDrawOffer"),
      "state.pendingDrawOffer",
      decodeOffer,
    ),
    lastDrawOfferMove: readNullable(
      field(fields, "lastDrawOfferMove"),
      "state.lastDrawOfferMove",
      readCount,
    ),
    commandBindings: Object.freeze(
      bindings.map((binding, index) => decodeBinding(binding, `bindings[${index}]`, index)),
    ),
  });
  checkInvariants(state);
  return state;
}

/**
 * Rebuilds a validated `ActiveGameState` from its persisted records, or
 * reports corruption. Invalid data fails closed: nothing is repaired.
 */
export function decodeGameState(
  record: unknown,
  bindings: readonly unknown[],
): Result<ActiveGameState, CorruptState> {
  try {
    return ok(decode(record, bindings));
  } catch (error: unknown) {
    if (error instanceof CorruptRecord) {
      return err({ kind: "corrupt_state", path: error.path, reason: error.reason });
    }
    throw error;
  }
}
