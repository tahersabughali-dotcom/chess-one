import {
  CLAIM_DRAW_COMMAND_V1,
  type CommandName,
  type GameId,
  isGameId,
  type LiveGameCommand,
  OFFER_DRAW_COMMAND_V1,
  RESIGN_GAME_COMMAND_V1,
  RESPOND_DRAW_OFFER_COMMAND_V1,
  SUBMIT_MOVE_COMMAND_V1,
} from "@chess-one/live-game-runtime";
import {
  isJsonObject,
  type JsonError,
  type JsonLimits,
  type JsonObject,
  type JsonValue,
  parseStrictJson,
} from "./strict-json.ts";

/**
 * Wire protocol `chess_one.realtime.v1`. The version is fixed for the whole
 * connection: it is negotiated as the WebSocket subprotocol at upgrade and
 * confirmed by `hello`. Client messages are flat JSON objects with a `type`;
 * a game command nests exactly one command object. There are no arrays.
 */
export const REALTIME_PROTOCOL = "chess_one.realtime.v1";

/**
 * Structural bounds. The largest legal message is a `game_command` with every
 * optional field at its maximum length: under 1.5 KB of JSON. Depth 2 is the
 * envelope plus the command object.
 */
export const CLIENT_JSON_LIMITS: JsonLimits = Object.freeze({
  maxDepth: 2,
  maxStringLength: 128,
  maxObjectKeys: 16,
  maxArrayLength: 0,
});

const REQUEST_ID = /^[A-Za-z0-9._:-]{1,64}$/;
const ID_LENGTH = 128;
const SQUARE_LENGTH = 8;

export type ProtocolErrorCode =
  | "MALFORMED_JSON"
  | "DUPLICATE_FIELD"
  | "NESTING_TOO_DEEP"
  | "FIELD_TOO_LONG"
  | "TOO_MANY_FIELDS"
  | "ARRAY_NOT_ALLOWED"
  | "MALFORMED_UNICODE"
  | "NUMBER_OUT_OF_RANGE"
  | "NOT_AN_OBJECT"
  | "UNKNOWN_MESSAGE_TYPE"
  | "UNKNOWN_FIELD"
  | "MISSING_FIELD"
  | "INVALID_FIELD"
  | "UNKNOWN_COMMAND"
  | "UNSUPPORTED_PROTOCOL_VERSION"
  | "BINARY_NOT_SUPPORTED"
  | "HELLO_REQUIRED"
  | "HELLO_ALREADY_RECEIVED";

/** `field` is always a name from this schema, never text chosen by the client. */
export interface ProtocolViolation {
  readonly code: ProtocolErrorCode;
  readonly field: string | null;
}

export type ClientMessage =
  | { readonly type: "hello" }
  | { readonly type: "ping"; readonly nonce: string | null }
  | { readonly type: "sync_game"; readonly requestId: string | null; readonly gameId: GameId }
  | {
      readonly type: "game_command";
      readonly requestId: string | null;
      /** The command's own `gameId`, validated for routing. */
      readonly gameId: GameId;
      readonly command: LiveGameCommand;
    };

export type DecodeResult =
  | { readonly ok: true; readonly message: ClientMessage }
  | { readonly ok: false; readonly violation: ProtocolViolation };

class Violation extends Error {
  readonly violation: ProtocolViolation;

  constructor(code: ProtocolErrorCode, field: string | null = null) {
    super(code);
    this.violation = Object.freeze({ code, field });
  }
}

const JSON_ERRORS: Readonly<Record<JsonError, ProtocolErrorCode>> = {
  invalid_json: "MALFORMED_JSON",
  duplicate_key: "DUPLICATE_FIELD",
  too_deep: "NESTING_TOO_DEEP",
  string_too_long: "FIELD_TOO_LONG",
  too_many_keys: "TOO_MANY_FIELDS",
  array_too_long: "ARRAY_NOT_ALLOWED",
  malformed_unicode: "MALFORMED_UNICODE",
  number_out_of_range: "NUMBER_OUT_OF_RANGE",
};

/** Reads one JSON object against a closed field list. */
class Fields {
  readonly #members: JsonObject;

  constructor(members: JsonObject, allowed: readonly string[]) {
    for (const key of members.keys()) {
      if (!allowed.includes(key)) throw new Violation("UNKNOWN_FIELD");
    }
    this.#members = members;
  }

  #get(name: string): JsonValue | undefined {
    return this.#members.get(name);
  }

  string(name: string, maxLength: number): string {
    const value = this.optionalString(name, maxLength);
    if (value === undefined) throw new Violation("MISSING_FIELD", name);
    return value;
  }

  optionalString(name: string, maxLength: number): string | undefined {
    const value = this.#get(name);
    if (value === undefined) return undefined;
    if (typeof value !== "string") throw new Violation("INVALID_FIELD", name);
    if (value.length > maxLength) throw new Violation("FIELD_TOO_LONG", name);
    return value;
  }

  number(name: string): number {
    const value = this.optionalNumber(name);
    if (value === undefined) throw new Violation("MISSING_FIELD", name);
    return value;
  }

  optionalNumber(name: string): number | undefined {
    const value = this.#get(name);
    if (value === undefined) return undefined;
    if (typeof value !== "number") throw new Violation("INVALID_FIELD", name);
    return value;
  }

  object(name: string): JsonObject {
    const value = this.#get(name);
    if (value === undefined) throw new Violation("MISSING_FIELD", name);
    if (value === null || !isJsonObject(value)) throw new Violation("INVALID_FIELD", name);
    return value;
  }

  requestId(): string | null {
    const value = this.optionalString("requestId", 64);
    if (value === undefined) return null;
    if (!REQUEST_ID.test(value)) throw new Violation("INVALID_FIELD", "requestId");
    return value;
  }

  gameId(name: string): GameId {
    const value = this.string(name, ID_LENGTH);
    if (!isGameId(value)) throw new Violation("INVALID_FIELD", name);
    return value;
  }
}

const ENVELOPE_FIELDS = [
  "command",
  "contractVersion",
  "gameId",
  "clientCommandId",
  "controlLeaseId",
  "expectedGameSequence",
  "actorId",
  "clientObservedAt",
];

const COMMAND_FIELDS: Readonly<Record<CommandName, readonly string[]>> = {
  [SUBMIT_MOVE_COMMAND_V1]: ["fromSquare", "toSquare", "promotionPiece", "clientSan"],
  [CLAIM_DRAW_COMMAND_V1]: ["claimKind", "fromSquare", "toSquare", "promotionPiece"],
  [RESIGN_GAME_COMMAND_V1]: [],
  [OFFER_DRAW_COMMAND_V1]: [],
  [RESPOND_DRAW_OFFER_COMMAND_V1]: ["offerId", "decision"],
};

function commandName(value: string): CommandName {
  switch (value) {
    case SUBMIT_MOVE_COMMAND_V1:
    case CLAIM_DRAW_COMMAND_V1:
    case RESIGN_GAME_COMMAND_V1:
    case OFFER_DRAW_COMMAND_V1:
    case RESPOND_DRAW_OFFER_COMMAND_V1:
      return value;
    default:
      throw new Violation("UNKNOWN_COMMAND", "command");
  }
}

function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  const out: { [P in K]?: V } = {};
  if (value !== undefined) out[key] = value;
  return out;
}

/**
 * Types, lengths, and the closed field set only. The live-game core still
 * decides everything a command means: square syntax, promotion, id syntax
 * beyond length, sequences, authorization, and identity. The game id is
 * checked here too because the transport routes on it.
 */
function decodeCommand(members: JsonObject, gameId: GameId): LiveGameCommand {
  const nameValue = members.get("command");
  if (nameValue === undefined) throw new Violation("MISSING_FIELD", "command");
  if (typeof nameValue !== "string") throw new Violation("INVALID_FIELD", "command");
  const name = commandName(nameValue);
  const fields = new Fields(members, [...ENVELOPE_FIELDS, ...COMMAND_FIELDS[name]]);
  const envelope = {
    contractVersion: fields.string("contractVersion", 8),
    gameId,
    clientCommandId: fields.string("clientCommandId", ID_LENGTH),
    controlLeaseId: fields.string("controlLeaseId", ID_LENGTH),
    expectedGameSequence: fields.number("expectedGameSequence"),
    ...optional("actorId", fields.optionalString("actorId", ID_LENGTH)),
    ...optional("clientObservedAt", fields.optionalNumber("clientObservedAt")),
  };
  const promotion = optional("promotionPiece", fields.optionalString("promotionPiece", 8));
  switch (name) {
    case SUBMIT_MOVE_COMMAND_V1:
      return {
        ...envelope,
        command: name,
        fromSquare: fields.string("fromSquare", SQUARE_LENGTH),
        toSquare: fields.string("toSquare", SQUARE_LENGTH),
        ...promotion,
        ...optional("clientSan", fields.optionalString("clientSan", 16)),
      };
    case CLAIM_DRAW_COMMAND_V1:
      return {
        ...envelope,
        command: name,
        claimKind: fields.string("claimKind", 32),
        ...optional("fromSquare", fields.optionalString("fromSquare", SQUARE_LENGTH)),
        ...optional("toSquare", fields.optionalString("toSquare", SQUARE_LENGTH)),
        ...promotion,
      };
    case RESIGN_GAME_COMMAND_V1:
      return { ...envelope, command: name };
    case OFFER_DRAW_COMMAND_V1:
      return { ...envelope, command: name };
    case RESPOND_DRAW_OFFER_COMMAND_V1:
      return {
        ...envelope,
        command: name,
        offerId: fields.number("offerId"),
        decision: fields.string("decision", 16),
      };
  }
}

function decodeMessage(members: JsonObject): ClientMessage {
  const type = members.get("type");
  if (type === undefined) throw new Violation("MISSING_FIELD", "type");
  switch (type) {
    case "hello": {
      const fields = new Fields(members, ["type", "protocol"]);
      if (fields.string("protocol", 64) !== REALTIME_PROTOCOL) {
        throw new Violation("UNSUPPORTED_PROTOCOL_VERSION", "protocol");
      }
      return { type };
    }
    case "ping": {
      const fields = new Fields(members, ["type", "nonce"]);
      const nonce = fields.optionalString("nonce", 64);
      if (nonce !== undefined && !REQUEST_ID.test(nonce)) {
        throw new Violation("INVALID_FIELD", "nonce");
      }
      return { type, nonce: nonce ?? null };
    }
    case "sync_game": {
      const fields = new Fields(members, ["type", "requestId", "gameId"]);
      return { type, requestId: fields.requestId(), gameId: fields.gameId("gameId") };
    }
    case "game_command": {
      const fields = new Fields(members, ["type", "requestId", "command"]);
      const requestId = fields.requestId();
      const command = fields.object("command");
      const gameId = new Fields(command, [...command.keys()]).gameId("gameId");
      return { type, requestId, gameId, command: decodeCommand(command, gameId) };
    }
    default:
      throw new Violation("UNKNOWN_MESSAGE_TYPE", "type");
  }
}

/** Parses and validates one text frame. Nothing invalid reaches the runtime. */
export function decodeClientMessage(text: string): DecodeResult {
  const parsed = parseStrictJson(text, CLIENT_JSON_LIMITS);
  if (!parsed.ok) return { ok: false, violation: { code: JSON_ERRORS[parsed.error], field: null } };
  const { value } = parsed;
  if (value === null || !isJsonObject(value)) {
    return { ok: false, violation: { code: "NOT_AN_OBJECT", field: null } };
  }
  try {
    return { ok: true, message: decodeMessage(value) };
  } catch (error: unknown) {
    if (error instanceof Violation) return { ok: false, violation: error.violation };
    throw error;
  }
}

export function violation(code: ProtocolErrorCode): ProtocolViolation {
  return Object.freeze({ code, field: null });
}
