import type { GameId, ResponseCode, Seat } from "@chess-one/live-game";
import type { InfrastructureReason } from "./writer-recovery.ts";

/**
 * Vendor-free operational facts. They carry codes and ids only: never a
 * session credential, a control lease, a database URL, or a payload.
 */
export interface FactSink<F> {
  record(fact: F): void;
}

export type RuntimeFact =
  | { readonly name: "writer_created"; readonly gameId: GameId }
  | { readonly name: "writer_retired"; readonly gameId: GameId; readonly reason: RetireReason }
  | { readonly name: "writer_capacity_reached" }
  | { readonly name: "writer_queue_full"; readonly gameId: GameId }
  | { readonly name: "command_accepted"; readonly gameId: GameId }
  | { readonly name: "command_replayed"; readonly gameId: GameId }
  | { readonly name: "command_rejected"; readonly gameId: GameId; readonly code: ResponseCode }
  | {
      readonly name: "persistence_failure";
      readonly gameId: GameId;
      readonly operation: "load" | "create" | "commit";
    }
  | {
      readonly name: "concurrency_conflict";
      readonly gameId: GameId;
      /** A commit the repository refused, or a load showing a sequence this writer never published. */
      readonly detectedBy: "commit" | "load";
    }
  | {
      /** The durable outcome of a create reported failed, settled by a fresh read. */
      readonly name: "create_reconciled";
      readonly gameId: GameId;
      readonly outcome: "stored" | "not_stored" | "unknown";
    }
  | { readonly name: "recovery_pause_encountered"; readonly gameId: GameId }
  | {
      readonly name: "infrastructure_pause_entered";
      readonly gameId: GameId;
      readonly reason: InfrastructureReason;
    }
  | { readonly name: "command_refused_paused"; readonly gameId: GameId }
  /** A command under a lease that is not the seat's: refused before receipt or, cold, before the core. */
  | { readonly name: "command_refused_control"; readonly gameId: GameId }
  | { readonly name: "control_lease_rotated"; readonly gameId: GameId; readonly seat: Seat }
  /** A historical replay whose command id is bound to a different command: nothing returned. */
  | { readonly name: "replay_identity_conflict"; readonly gameId: GameId }
  | { readonly name: "deadline_flagged"; readonly gameId: GameId }
  | {
      /** An unexpected exception inside the writer; the error itself goes to `reportDefect` only. */
      readonly name: "writer_fault";
      readonly gameId: GameId;
      readonly job: "command" | "sync" | "deadline" | "lease" | "replay" | "none";
    }
  | { readonly name: "subscriber_defect"; readonly gameId: GameId };

export type RetireReason =
  | "idle"
  | "game_not_found"
  | "corrupt_state"
  | "concurrency_conflict"
  | "defect"
  | "disposed";
