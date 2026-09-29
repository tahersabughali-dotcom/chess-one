import type { MoveIntent } from "@chess-one/game-values";
import type { ActiveGameState, CommandBinding, CommandResponse } from "./active-game.ts";
import type { ParsedCommand } from "./commands.ts";
import { type CommandId, type ControlLeaseId, isControlLeaseId, type Seat } from "./ids.ts";

function moveText(move: MoveIntent | undefined): string {
  return move === undefined ? "- - -" : `${move.from} ${move.to} ${move.promotion ?? "-"}`;
}

/**
 * CONTRACT_CATALOG_V1 2.6 and 10: the semantic payload after normalization,
 * as canonical text rather than a hash, so equality is exact. It binds the
 * command name and version, `game_id`, the control lease, and the move,
 * claim, or draw-offer response fields (`offer_id` and the decision); a
 * resignation and a draw offer have no further fields. A new command is
 * bound under the seat's current lease; a bound command is recognized under
 * the lease stored in its fingerprint (`matchesBinding`). It
 * never includes client time, client SAN, `actor_id`,
 * `expected_game_sequence`, or `client_command_id`, which is the lookup key
 * together with the seat.
 */
export function fingerprintOf(command: ParsedCommand): string {
  const envelope = `${command.name} ${command.gameId} ${command.controlLeaseId}`;
  switch (command.kind) {
    case "resign_game":
    case "offer_draw":
      return envelope;
    case "respond_draw_offer":
      return `${envelope} ${command.offerId} ${command.decision}`;
    case "submit_move":
      return `${envelope} ${moveText(command.move)}`;
    case "claim_draw": {
      const intended = "intended" in command.claim ? command.claim.intended : undefined;
      return `${envelope} ${command.claim.kind} ${moveText(intended)}`;
    }
  }
}

/**
 * The control lease a stored fingerprint was bound under: its third field.
 * No field of the envelope (command name, game id, lease) can contain a
 * space, so the field is unambiguous. It only chooses the lease to rebuild
 * the fingerprint with; the rebuilt text must still equal the stored one.
 */
export function boundLease(fingerprint: string): ControlLeaseId | null {
  const lease = fingerprint.split(" ")[2];
  return lease !== undefined && isControlLeaseId(lease) ? lease : null;
}

/**
 * LIVE-CONTRACT-005 as amended by GACC-016: `command` is the command bound
 * in `binding` when its fingerprint, rebuilt under the lease the binding was
 * stored with, equals the stored text exactly. The caller's current lease
 * governs new commands only; it is never evidence about a bound one.
 */
export function matchesBinding(binding: CommandBinding, command: ParsedCommand): boolean {
  const lease = boundLease(binding.fingerprint);
  if (lease === null) return false;
  return fingerprintOf({ ...command, controlLeaseId: lease }) === binding.fingerprint;
}

/** The binding decision stored for this seat and client command id, if any. */
export function findBinding(
  state: ActiveGameState,
  seat: Seat,
  clientCommandId: CommandId,
): CommandBinding | undefined {
  return state.commandBindings.find(
    (binding) => binding.seat === seat && binding.clientCommandId === clientCommandId,
  );
}

/**
 * Stores `response` as the binding decision. Bindings are kept for the life of
 * this state; retention and pruning policy for production is not decided.
 */
export function withBinding(
  state: ActiveGameState,
  seat: Seat,
  clientCommandId: CommandId,
  fingerprint: string,
  response: CommandResponse,
): ActiveGameState {
  const binding: CommandBinding = Object.freeze({ seat, clientCommandId, fingerprint, response });
  return Object.freeze({
    ...state,
    commandBindings: Object.freeze([...state.commandBindings, binding]),
  });
}

/** The stored original, never recomputed; only `replayedResponse` differs. */
export function replayedResponse(binding: CommandBinding): CommandResponse {
  return Object.freeze({ ...binding.response, replayedResponse: true });
}
