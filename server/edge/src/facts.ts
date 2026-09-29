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
  | "socket_error";

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
  | { readonly name: "command_submitted"; readonly gameId: GameId }
  | { readonly name: "sequence_regression_suppressed"; readonly gameId: GameId };
