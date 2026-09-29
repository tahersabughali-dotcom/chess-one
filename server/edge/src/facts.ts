import type { GameId } from "@chess-one/live-game-runtime";
import type { ProtocolErrorCode } from "./protocol/client-messages.ts";
import type { BusyCode } from "./protocol/server-messages.ts";

export type UpgradeRejection =
  | "shutting_down"
  | "not_found"
  | "bad_upgrade"
  | "unsupported_protocol_version"
  | "origin_not_allowed"
  | "credential_too_large"
  | "unauthenticated"
  | "session_unavailable"
  | "server_busy";

export type CloseReason =
  | "client"
  | "server_shutdown"
  | "protocol_error"
  | "hello_timeout"
  | "rate_limited"
  | "slow_consumer"
  | "dead_connection"
  | "message_too_large"
  | "socket_error"
  | "session_ended"
  | "session_unverifiable";

export type AuthRefusal = "origin" | "fetch_site" | "media_type" | "malformed_cookie";

/** Transport facts: codes and ids only, never credentials, leases, or payloads. */
export type EdgeFact =
  | { readonly name: "connection_opened" }
  | { readonly name: "connection_closed"; readonly code: number; readonly reason: CloseReason }
  | {
      readonly name: "upgrade_rejected";
      readonly status: number;
      readonly reason: UpgradeRejection;
    }
  | { readonly name: "malformed_message"; readonly code: ProtocolErrorCode }
  | { readonly name: "rate_limited" }
  | { readonly name: "message_too_large" }
  | { readonly name: "slow_consumer" }
  | { readonly name: "dead_connection" }
  | { readonly name: "socket_error" }
  | { readonly name: "sync_served"; readonly gameId: GameId }
  | { readonly name: "recovery_required_sent"; readonly gameId: GameId }
  | { readonly name: "server_busy"; readonly code: BusyCode }
  /** Received by the writer: stamped at its ingress as a new command. */
  | { readonly name: "command_submitted"; readonly gameId: GameId }
  /** Taken by the writer for a lookup of the stored bindings: not received, not stamped. */
  | {
      readonly name: "command_lookup";
      readonly gameId: GameId;
      readonly lookup: "bound" | "unresolved";
    }
  /** Refused before the writer: this session does not hold the seat's control. */
  | { readonly name: "command_refused_control"; readonly gameId: GameId }
  | {
      readonly name: "control_claim";
      readonly gameId: GameId;
      readonly outcome: "granted" | "denied" | "unavailable";
    }
  | { readonly name: "control_revoked_sent"; readonly gameId: GameId }
  /** A `ready_game` answered; codes only. */
  | {
      readonly name: "ready_answered";
      readonly gameId: GameId;
      readonly outcome: "ready" | "started" | "refused" | "unavailable";
    }
  /** Refused before the writer received it: the game has not started or was aborted. */
  | { readonly name: "command_refused_not_started"; readonly gameId: GameId }
  | { readonly name: "sequence_regression_suppressed"; readonly gameId: GameId }
  | { readonly name: "auth_request_refused"; readonly reason: AuthRefusal }
  | { readonly name: "challenge_request_refused"; readonly reason: AuthRefusal };
