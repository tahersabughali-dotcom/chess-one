import type {
  Color,
  CommandResponse,
  GameId,
  GameStatus,
  GameView,
  PlayerId,
  RecoveryReason,
  Seat,
} from "@chess-one/live-game-runtime";
import type { ProtocolViolation, REALTIME_PROTOCOL } from "./client-messages.ts";

/**
 * `game_snapshot.v1`: the client-visible state of one game, separate from the
 * stored `live_game_state.v1`. It has no monotonic anchor, binding,
 * fingerprint, control lease, player id, or clock domain. Balances are as of
 * the moment the snapshot was taken.
 */
export const SNAPSHOT_FORMAT = "game_snapshot.v1";

export type StatusWire =
  | { readonly kind: "active" }
  | {
      readonly kind: "finished";
      readonly resultCode: "white_win" | "black_win" | "draw";
      readonly terminationReason: string;
      readonly winner: Color | null;
      readonly drawRuleDetails: readonly string[];
    }
  | { readonly kind: "unresolved"; readonly reason: string; readonly side: Color | null };

export interface ClockWire {
  readonly whiteMs: number;
  readonly blackMs: number;
  readonly activeSide: Color;
  readonly running: boolean;
}

export interface SnapshotWire {
  readonly format: typeof SNAPSHOT_FORMAT;
  readonly gameId: string;
  readonly rulesetId: string;
  readonly sequence: number;
  readonly positionFen: string;
  readonly sideToMove: Color;
  /** The seat of this connection's trusted session (from the game's assignment). */
  readonly seat: Seat;
  /** Whether this session controls the seat now: its commands are admitted. */
  readonly controlHeld: boolean;
  /** Whether `claim_game_control` could take the seat now (not held, game active). */
  readonly canClaimControl: boolean;
  readonly status: StatusWire;
  /** False while the game is stopped, finished, unresolved, or paused. */
  readonly playable: boolean;
  readonly recoveryRequired: boolean;
  /** Why play waits for a recovery; null when it does not. */
  readonly recoveryReason: RecoveryReason | null;
  readonly clock: ClockWire;
  readonly pendingDrawOffer: {
    readonly offerId: number;
    readonly offeredBy: Seat;
    readonly offeredTo: Seat;
  } | null;
}

export interface CommandResponseWire {
  readonly gameId: string;
  readonly command: string;
  readonly clientCommandId: string | null;
  readonly code: string;
  readonly detail: string | null;
  readonly replayed: boolean;
  /** The authoritative sequence after the decision; a replay carries the original's. */
  readonly sequence: number;
  readonly san: string | null;
  readonly status: StatusWire;
  /** Balances as committed by the decision, without any monotonic anchor. */
  readonly clock: ClockWire;
}

/**
 * `GAME_ACCESS_DENIED` covers both a game of other players and a game that
 * does not exist. `CONTROL_NOT_HELD`: another session of the same player
 * controls the seat (or none does); the command was not received, queued,
 * stamped, or bound, and it is not one this seat already decided. Claim
 * control, then send it again. `INVALID_COMMAND_IDENTITY`: without control,
 * a command id this seat already bound was sent with a different command;
 * nothing was decided or returned.
 */
export type RequestFailure =
  | "GAME_ACCESS_DENIED"
  | "GAME_NOT_FOUND"
  | "GAME_UNAVAILABLE"
  | "TEMPORARILY_UNAVAILABLE"
  | "SUBSCRIPTION_LIMIT"
  | "CONTROL_NOT_HELD"
  | "INVALID_COMMAND_IDENTITY";

export type ControlDeniedCode =
  | "GAME_ACCESS_DENIED"
  | "GAME_CLOSED"
  | "SESSION_ENDED"
  | "RATE_LIMITED"
  | "CONFLICT"
  | "TEMPORARILY_UNAVAILABLE";

/** Why this connection's session lost control of a seat; never who took it. */
export type ControlRevokedCode = "CONTROL_TRANSFERRED" | "CONTROL_RELEASED";

export type BusyCode = "RATE_LIMITED" | "WRITER_QUEUE_FULL" | "WRITER_CAPACITY";

export interface ReadyLimits {
  readonly maxMessageBytes: number;
  readonly heartbeatIntervalMs: number;
  readonly inboundBurst: number;
  readonly inboundRefillPerSecond: number;
}

/**
 * Four separate failure families: `protocol_error` (the client sent
 * something invalid), `command_response` with a non-Accepted code (a domain
 * decision), `request_failed` / `server_busy` (the server could not serve it
 * now), and `recovery_required` (play is paused until an operator recovery:
 * the clock domain changed, or persistence failed or the writer faulted in
 * this process). A command answered `recovery_required` was not executed;
 * its `clientCommandId` stays unbound for a later attempt.
 */
export type ServerMessage =
  | {
      readonly type: "connection_ready";
      readonly protocol: typeof REALTIME_PROTOCOL;
      readonly actorId: PlayerId;
      readonly games: readonly { readonly gameId: GameId; readonly seat: Seat }[];
      readonly limits: ReadyLimits;
    }
  | {
      readonly type: "game_snapshot";
      readonly requestId: string | null;
      readonly snapshot: SnapshotWire;
    }
  | { readonly type: "game_update"; readonly snapshot: SnapshotWire }
  | {
      readonly type: "command_response";
      readonly requestId: string | null;
      readonly response: CommandResponseWire;
    }
  | {
      readonly type: "recovery_required";
      readonly requestId: string | null;
      readonly gameId: GameId;
      readonly reason: RecoveryReason;
      readonly clientCommandId: string | null;
    }
  | { readonly type: "sync_required"; readonly gameId: GameId; readonly reason: "WRITER_STOPPED" }
  /** This session controls the seat. `requestId` is null when another connection claimed it. */
  | {
      readonly type: "control_granted";
      readonly requestId: string | null;
      readonly gameId: GameId;
      readonly seat: Seat;
    }
  | {
      readonly type: "control_denied";
      readonly requestId: string | null;
      readonly gameId: GameId;
      readonly code: ControlDeniedCode;
      readonly retryable: boolean;
    }
  /**
   * A courtesy notice: the server refuses this session's commands for the
   * seat whether or not the notice arrives.
   */
  | {
      readonly type: "control_revoked";
      readonly gameId: GameId;
      readonly seat: Seat;
      readonly code: ControlRevokedCode;
    }
  | {
      readonly type: "request_failed";
      readonly requestId: string | null;
      readonly code: RequestFailure;
      readonly retryable: boolean;
      readonly clientCommandId: string | null;
    }
  | {
      readonly type: "server_busy";
      readonly requestId: string | null;
      readonly code: BusyCode;
      readonly retryable: true;
      readonly clientCommandId: string | null;
    }
  | {
      readonly type: "protocol_error";
      readonly code: ProtocolViolation["code"];
      readonly field: string | null;
    }
  | { readonly type: "pong"; readonly nonce: string | null };

export function encodeStatus(status: GameStatus): StatusWire {
  switch (status.kind) {
    case "active":
      return { kind: "active" };
    case "finished": {
      const { result } = status;
      return {
        kind: "finished",
        resultCode: result.resultCode,
        terminationReason: result.terminationReason,
        winner: result.resultCode === "draw" ? null : result.winner,
        drawRuleDetails:
          result.terminationReason === "draw_rule" ? [...result.drawRuleDetails] : [],
      };
    }
    case "unresolved": {
      const side =
        "flaggedSide" in status
          ? status.flaggedSide
          : "resigningSide" in status
            ? status.resigningSide
            : null;
      return { kind: "unresolved", reason: status.reason, side };
    }
  }
}

export function encodeSnapshot(view: GameView, seat: Seat, controlHeld: boolean): SnapshotWire {
  const offer = view.pendingDrawOffer;
  return {
    format: SNAPSHOT_FORMAT,
    gameId: view.gameId,
    rulesetId: view.rulesetId,
    sequence: view.sequence,
    positionFen: view.positionFen,
    sideToMove: view.sideToMove,
    seat,
    controlHeld,
    canClaimControl: !controlHeld && view.status.kind === "active",
    status: encodeStatus(view.status),
    playable: view.condition === "running",
    recoveryRequired: view.recoveryReason !== null,
    recoveryReason: view.recoveryReason,
    clock: {
      whiteMs: view.clock.remainingMs.white,
      blackMs: view.clock.remainingMs.black,
      activeSide: view.clock.activeSide,
      running: view.clock.running,
    },
    pendingDrawOffer:
      offer === null
        ? null
        : { offerId: offer.offerId, offeredBy: offer.offeredBy, offeredTo: offer.offeredTo },
  };
}

export function encodeCommandResponse(response: CommandResponse): CommandResponseWire {
  const { clock } = response;
  return {
    gameId: response.gameId,
    command: response.command,
    clientCommandId: response.clientCommandId,
    code: response.code,
    detail: response.detail,
    replayed: response.replayedResponse,
    sequence: response.sequence,
    san: response.san,
    status: encodeStatus(response.status),
    clock: {
      whiteMs: clock.remainingMs.white,
      blackMs: clock.remainingMs.black,
      activeSide: clock.activeSide,
      running: clock.running,
    },
  };
}

export function serializeServerMessage(message: ServerMessage): string {
  return JSON.stringify(message);
}
