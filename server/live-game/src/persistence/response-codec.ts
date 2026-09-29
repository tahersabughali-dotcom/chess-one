import { formatFen, parseFen } from "@chess-one/chess-rules";
import { isGameSequence } from "@chess-one/game-values";
import type { CommandResponse, ResponseCode, ResponseDetail } from "../active-game.ts";
import { isMonotonicMs } from "../clock.ts";
import type { CommandName } from "../commands.ts";
import type { GameFinishedV1 } from "../events.ts";
import { isCommandId, isGameId } from "../ids.ts";
import {
  corrupt,
  field,
  literalGuard,
  readBoolean,
  readCount,
  readGuarded,
  readNullable,
  readObject,
  readString,
} from "./records.ts";
import {
  decodeClock,
  decodeStatus,
  encodeClock,
  encodeResult,
  encodeStatus,
} from "./value-codec.ts";

export const isCommandName = literalGuard<CommandName>({
  "SubmitMoveCommand.v1": true,
  "ClaimDrawCommand.v1": true,
  "ResignGameCommand.v1": true,
  "OfferDrawCommand.v1": true,
  "RespondDrawOfferCommand.v1": true,
});

const isResponseCode = literalGuard<ResponseCode>({
  Accepted: true,
  IncorrectClaim: true,
  IllegalMove: true,
  NotYourTurn: true,
  StaleSequence: true,
  Unauthorized: true,
  GameAlreadyFinished: true,
  InvalidState: true,
  InvalidCommandIdentity: true,
  MoveReceivedAfterDeadline: true,
  MatingPossibilityUnresolved: true,
  TerminalPrecedenceUnresolved: true,
  GameNotStarted: true,
  GameAbortedBeforeStart: true,
});

const isResponseDetail = literalGuard<ResponseDetail>({
  invalid_from_square: true,
  invalid_to_square: true,
  same_square: true,
  invalid_promotion_piece: true,
  unsupported_contract_version: true,
  malformed_game_id: true,
  malformed_command_id: true,
  malformed_control_lease_id: true,
  malformed_actor_id: true,
  malformed_expected_sequence: true,
  unknown_claim_kind: true,
  missing_intended_move: true,
  unexpected_intended_move: true,
  malformed_offer_id: true,
  unknown_draw_offer_decision: true,
  wrong_game: true,
  seat_player_mismatch: true,
  invalid_control_lease: true,
  actor_mismatch: true,
  draw_offer_not_allowed: true,
  draw_offer_already_pending: true,
  draw_offer_already_used_for_move: true,
  no_pending_draw_offer: true,
  not_draw_offer_recipient: true,
  draw_offer_id_mismatch: true,
  illegal_move: true,
  promotion_required: true,
  promotion_unexpected: true,
});

const RESPONSE_FIELDS = [
  "gameId",
  "command",
  "clientCommandId",
  "code",
  "detail",
  "replayedResponse",
  "receivedAtMonotonicMs",
  "sequence",
  "positionFen",
  "san",
  "clock",
  "status",
] as const;

export function encodeResponse(response: CommandResponse): unknown {
  return {
    gameId: response.gameId,
    command: response.command,
    clientCommandId: response.clientCommandId,
    code: response.code,
    detail: response.detail,
    replayedResponse: response.replayedResponse,
    receivedAtMonotonicMs: response.receivedAtMonotonicMs,
    sequence: response.sequence,
    positionFen: response.positionFen,
    san: response.san,
    clock: encodeClock(response.clock),
    status: encodeStatus(response.status),
  };
}

/** A canonical FEN: it parses, and formatting the parsed position gives the same text. */
export function readCanonicalFen(value: unknown, path: string): string {
  const fen = readString(value, path);
  const parsed = parseFen(fen);
  if (!parsed.ok) corrupt(path, `invalid FEN (${parsed.error.code})`);
  if (formatFen(parsed.value) !== fen) corrupt(path, "FEN is not canonical");
  return fen;
}

function readSan(value: unknown, path: string): string {
  const san = readString(value, path);
  return /^[KQRBNa-h1-8xO=+#-]{2,7}$/.test(san) ? san : corrupt(path, "not SAN");
}

export function decodeResponse(value: unknown, path: string): CommandResponse {
  const fields = readObject(value, path, RESPONSE_FIELDS);
  const at = (name: string): string => `${path}.${name}`;
  const receivedAt = readCount(field(fields, "receivedAtMonotonicMs"), at("receivedAtMonotonicMs"));
  if (!isMonotonicMs(receivedAt)) corrupt(at("receivedAtMonotonicMs"), "not a monotonic instant");
  const sequence = readCount(field(fields, "sequence"), at("sequence"));
  if (!isGameSequence(sequence)) corrupt(at("sequence"), "not a game sequence");
  const code = readGuarded(field(fields, "code"), at("code"), isResponseCode);
  if (code === "GameNotStarted" || code === "GameAbortedBeforeStart") {
    corrupt(at("code"), "a command before the start is never bound");
  }
  return Object.freeze({
    gameId: readGuarded(field(fields, "gameId"), at("gameId"), isGameId),
    command: readGuarded(field(fields, "command"), at("command"), isCommandName),
    clientCommandId: readNullable(field(fields, "clientCommandId"), at("clientCommandId"), (v, p) =>
      readGuarded(v, p, isCommandId),
    ),
    code,
    detail: readNullable(field(fields, "detail"), at("detail"), (v, p) =>
      readGuarded(v, p, isResponseDetail),
    ),
    replayedResponse: readBoolean(field(fields, "replayedResponse"), at("replayedResponse")),
    receivedAtMonotonicMs: receivedAt,
    sequence,
    positionFen: readCanonicalFen(field(fields, "positionFen"), at("positionFen")),
    san: readNullable(field(fields, "san"), at("san"), readSan),
    clock: decodeClock(field(fields, "clock"), at("clock")),
    status: decodeStatus(field(fields, "status"), at("status"), false),
  });
}

/**
 * The domain payload of `game.finished.v1`, as plain data. The durable outbox
 * envelope adds `event_id`; the payload itself is the domain event unchanged.
 * `finalClock.anchorMs` is the writer's monotonic instant and means nothing
 * outside that writer's clock domain.
 */
export function encodeGameFinished(event: GameFinishedV1): unknown {
  const { provenance } = event;
  return {
    eventName: event.eventName,
    eventVersion: event.eventVersion,
    producer: event.producer,
    gameId: event.gameId,
    gameSequence: event.gameSequence,
    rulesetId: event.rulesetId,
    playerIds: { white: event.playerIds.white, black: event.playerIds.black },
    result: encodeResult(event.result),
    finalPositionFen: event.finalPositionFen,
    finalClock: encodeClock(event.finalClock),
    occurredAtWallClockMs: event.occurredAtWallClockMs,
    provenance:
      "writerDeadline" in provenance
        ? { writerDeadline: true, flaggedSide: provenance.flaggedSide }
        : {
            command: provenance.command,
            seat: provenance.seat,
            clientCommandId: provenance.clientCommandId,
          },
  };
}
