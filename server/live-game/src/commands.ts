import type { DrawClaim } from "@chess-one/chess-rules";
import {
  err,
  type GameSequence,
  isGameSequence,
  type MoveIntent,
  type MoveIntentError,
  ok,
  parseMoveIntent,
  type Result,
} from "@chess-one/game-values";
import {
  type CommandId,
  type ControlLeaseId,
  type GameId,
  isCommandId,
  isControlLeaseId,
  isGameId,
  isPlayerId,
  type PlayerId,
} from "./ids.ts";

/** Versioned command names (CONTRACT_CATALOG_V1 sections 2 and 10.1 to 10.4). */
export const SUBMIT_MOVE_COMMAND_V1 = "SubmitMoveCommand.v1";
export const CLAIM_DRAW_COMMAND_V1 = "ClaimDrawCommand.v1";
export const RESIGN_GAME_COMMAND_V1 = "ResignGameCommand.v1";
export const OFFER_DRAW_COMMAND_V1 = "OfferDrawCommand.v1";
export const RESPOND_DRAW_OFFER_COMMAND_V1 = "RespondDrawOfferCommand.v1";
export type CommandName =
  | typeof SUBMIT_MOVE_COMMAND_V1
  | typeof CLAIM_DRAW_COMMAND_V1
  | typeof RESIGN_GAME_COMMAND_V1
  | typeof OFFER_DRAW_COMMAND_V1
  | typeof RESPOND_DRAW_OFFER_COMMAND_V1;

const CONTRACT_VERSION = "1";

/**
 * Untrusted request fields shared by live-game commands. None of them proves
 * identity, seat, lease authority, or time: the authenticated session is
 * resolved by the trusted caller into an `AuthorizedGameActor`.
 */
interface CommandEnvelopeInput {
  readonly contractVersion: string;
  readonly gameId: string;
  readonly clientCommandId: string;
  readonly controlLeaseId: string;
  readonly expectedGameSequence: number;
  /** Optional echo that must match the resolved seat's player; never identity proof. */
  readonly actorId?: string;
  /** Informational only; never owns the clock. */
  readonly clientObservedAt?: number;
}

export interface SubmitMoveCommandV1 extends CommandEnvelopeInput {
  readonly command: typeof SUBMIT_MOVE_COMMAND_V1;
  readonly fromSquare: string;
  readonly toSquare: string;
  readonly promotionPiece?: string;
  /** Display hint only; the server never parses it as the move. */
  readonly clientSan?: string;
}

export interface ClaimDrawCommandV1 extends CommandEnvelopeInput {
  readonly command: typeof CLAIM_DRAW_COMMAND_V1;
  readonly claimKind: string;
  /** Required exactly when `claimKind` ends in `_intended`. */
  readonly fromSquare?: string;
  readonly toSquare?: string;
  readonly promotionPiece?: string;
}

/** CONTRACT_CATALOG_V1 10.4: no move fields. The server decides the outcome. */
export interface ResignGameCommandV1 extends CommandEnvelopeInput {
  readonly command: typeof RESIGN_GAME_COMMAND_V1;
}

/** CONTRACT_CATALOG_V1 10.2: no conditions and no free text. */
export interface OfferDrawCommandV1 extends CommandEnvelopeInput {
  readonly command: typeof OFFER_DRAW_COMMAND_V1;
}

/** CONTRACT_CATALOG_V1 10.3. */
export interface RespondDrawOfferCommandV1 extends CommandEnvelopeInput {
  readonly command: typeof RESPOND_DRAW_OFFER_COMMAND_V1;
  /** The pending offer's server id, its `createdAtSequence`. */
  readonly offerId: number;
  /** `accept` or `decline`. */
  readonly decision: string;
}

export type DrawOfferDecision = "accept" | "decline";

type WithoutLease<T> = T extends unknown ? Omit<T, "controlLeaseId"> : never;

export type LiveGameCommand =
  | SubmitMoveCommandV1
  | ClaimDrawCommandV1
  | ResignGameCommandV1
  | OfferDrawCommandV1
  | RespondDrawOfferCommandV1;

/**
 * A command without its control lease: what a client sends, and what a
 * historical replay is looked up with. The lease is always the server's.
 */
export type LeaselessCommand = WithoutLease<LiveGameCommand>;

/** Shape failures, answered as `InvalidState` before any authority or identity check. */
export type CommandShapeError =
  | MoveIntentError
  | "unsupported_contract_version"
  | "malformed_game_id"
  | "malformed_command_id"
  | "malformed_control_lease_id"
  | "malformed_actor_id"
  | "malformed_expected_sequence"
  | "unknown_claim_kind"
  | "missing_intended_move"
  | "unexpected_intended_move"
  | "malformed_offer_id"
  | "unknown_draw_offer_decision";

interface ParsedEnvelope {
  readonly name: CommandName;
  readonly gameId: GameId;
  readonly clientCommandId: CommandId;
  readonly controlLeaseId: ControlLeaseId;
  readonly expectedGameSequence: GameSequence;
  readonly actorId: PlayerId | null;
}

export type ParsedCommand =
  | (ParsedEnvelope & { readonly kind: "submit_move"; readonly move: MoveIntent })
  | (ParsedEnvelope & { readonly kind: "claim_draw"; readonly claim: DrawClaim })
  | (ParsedEnvelope & { readonly kind: "resign_game" })
  | (ParsedEnvelope & { readonly kind: "offer_draw" })
  | (ParsedEnvelope & {
      readonly kind: "respond_draw_offer";
      readonly offerId: GameSequence;
      readonly decision: DrawOfferDecision;
    });

/** Case and surrounding whitespace are normalized; an empty promotion is the same as none. */
function parseIntent(
  from: string,
  to: string,
  promotion: string | undefined,
): Result<MoveIntent, MoveIntentError> {
  const piece = promotion?.trim().toLowerCase();
  return parseMoveIntent({
    from: from.trim().toLowerCase(),
    to: to.trim().toLowerCase(),
    promotion: piece === "" ? undefined : piece,
  });
}

function parseEnvelope(command: LiveGameCommand): Result<ParsedEnvelope, CommandShapeError> {
  if (command.contractVersion !== CONTRACT_VERSION) return err("unsupported_contract_version");
  const { gameId, clientCommandId, controlLeaseId, expectedGameSequence, actorId } = command;
  if (!isGameId(gameId)) return err("malformed_game_id");
  if (!isCommandId(clientCommandId)) return err("malformed_command_id");
  if (!isControlLeaseId(controlLeaseId)) return err("malformed_control_lease_id");
  if (!isGameSequence(expectedGameSequence)) return err("malformed_expected_sequence");
  if (actorId !== undefined && !isPlayerId(actorId)) return err("malformed_actor_id");
  return ok({
    name: command.command,
    gameId,
    clientCommandId,
    controlLeaseId,
    expectedGameSequence,
    actorId: actorId ?? null,
  });
}

function parseClaim(command: ClaimDrawCommandV1): Result<DrawClaim, CommandShapeError> {
  const { claimKind: kind, fromSquare, toSquare, promotionPiece } = command;
  const named = fromSquare !== undefined || toSquare !== undefined || promotionPiece !== undefined;
  if (kind === "threefold_current" || kind === "fifty_move_current") {
    return named ? err("unexpected_intended_move") : ok({ kind });
  }
  if (kind !== "threefold_intended" && kind !== "fifty_move_intended") {
    return err("unknown_claim_kind");
  }
  if (fromSquare === undefined || toSquare === undefined) return err("missing_intended_move");
  const intended = parseIntent(fromSquare, toSquare, promotionPiece);
  return intended.ok ? ok({ kind, intended: intended.value }) : intended;
}

export function parseCommand(command: LiveGameCommand): Result<ParsedCommand, CommandShapeError> {
  const envelope = parseEnvelope(command);
  if (!envelope.ok) return envelope;
  if (command.command === SUBMIT_MOVE_COMMAND_V1) {
    const move = parseIntent(command.fromSquare, command.toSquare, command.promotionPiece);
    return move.ok ? ok({ ...envelope.value, kind: "submit_move", move: move.value }) : move;
  }
  if (command.command === RESIGN_GAME_COMMAND_V1) {
    return ok({ ...envelope.value, kind: "resign_game" });
  }
  if (command.command === OFFER_DRAW_COMMAND_V1) {
    return ok({ ...envelope.value, kind: "offer_draw" });
  }
  if (command.command === RESPOND_DRAW_OFFER_COMMAND_V1) {
    const { offerId, decision } = command;
    if (!isGameSequence(offerId)) return err("malformed_offer_id");
    if (decision !== "accept" && decision !== "decline") return err("unknown_draw_offer_decision");
    return ok({ ...envelope.value, kind: "respond_draw_offer", offerId, decision });
  }
  const claim = parseClaim(command);
  return claim.ok ? ok({ ...envelope.value, kind: "claim_draw", claim: claim.value }) : claim;
}
