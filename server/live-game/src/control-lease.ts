import { err, ok, type Result } from "@chess-one/game-values";
import type { ActiveGameState, CommandResponse } from "./active-game.ts";
import { boundLease, findBinding, matchesBinding, replayedResponse } from "./command-identity.ts";
import { type LeaselessCommand, parseCommand } from "./commands.ts";
import { type ControlLeaseId, type GameId, isCommandId, type PlayerId, type Seat } from "./ids.ts";

export type LeaseRotationError = "shared_control_lease";

/**
 * The state with `lease` as the control lease of `seat`, and nothing else
 * changed: no sequence step, clock, position, repetition history, status,
 * draw offer, or binding. The same lease returns the same state object. A
 * lease the other seat holds is refused, so the two seats never share one.
 */
export function withControlLease(
  state: ActiveGameState,
  seat: Seat,
  lease: ControlLeaseId,
): Result<ActiveGameState, LeaseRotationError> {
  const { white, black } = state.controlLeases;
  if (state.controlLeases[seat] === lease) return ok(state);
  if ((seat === "white" ? black : white) === lease) return err("shared_control_lease");
  const controlLeases = Object.freeze(
    seat === "white" ? { white: lease, black } : { white, black: lease },
  );
  return ok(Object.freeze({ ...state, controlLeases }));
}

/** A player of the game, by seat, with no claim to its control lease. */
export interface GameParticipant {
  readonly gameId: GameId;
  readonly playerId: PlayerId;
  readonly seat: Seat;
}

/**
 * - `replayed`: the stored decision, marked `replayedResponse`;
 * - `not_bound`: this seat never bound the command id (or the request is not
 *   this participant's): nothing to replay, and no authority to decide it;
 * - `identity_conflict`: the id is bound to a different command.
 */
export type HistoricalReplay =
  | { readonly kind: "replayed"; readonly response: CommandResponse }
  | { readonly kind: "not_bound" }
  | { readonly kind: "identity_conflict" };

const NOT_BOUND: HistoricalReplay = Object.freeze({ kind: "not_bound" });
const IDENTITY_CONFLICT: HistoricalReplay = Object.freeze({ kind: "identity_conflict" });

/**
 * Read-only retrieval of a decision already bound to the participant's seat,
 * for a session whose command is not admitted under the seat's current
 * lease. The lease is never taken from the caller: the command is recognized
 * by `matchesBinding`, the same rule `processCommand` applies to the
 * controller (CONTRACT_CATALOG_V1 2.6.2 as amended by GACC-016). It decides
 * nothing and returns no state: no sequence, clock, binding, or event.
 */
export function historicalReplay(
  state: ActiveGameState,
  participant: GameParticipant,
  command: LeaselessCommand,
): HistoricalReplay {
  if (participant.gameId !== state.gameId || command.gameId !== state.gameId) return NOT_BOUND;
  if (state.players[participant.seat] !== participant.playerId) return NOT_BOUND;
  if (!isCommandId(command.clientCommandId)) return NOT_BOUND;
  const binding = findBinding(state, participant.seat, command.clientCommandId);
  if (binding === undefined) return NOT_BOUND;
  const lease = boundLease(binding.fingerprint);
  if (lease === null) return IDENTITY_CONFLICT;
  const parsed = parseCommand({ ...command, controlLeaseId: lease });
  if (!parsed.ok) return IDENTITY_CONFLICT;
  const { actorId } = parsed.value;
  if (actorId !== null && actorId !== participant.playerId) return NOT_BOUND;
  if (!matchesBinding(binding, parsed.value)) return IDENTITY_CONFLICT;
  return Object.freeze({ kind: "replayed", response: replayedResponse(binding) });
}
