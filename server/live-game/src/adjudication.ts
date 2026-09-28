import { assessMatingCapability, type Position } from "@chess-one/chess-rules";
import { type Color, oppositeColor } from "@chess-one/game-values";
import { drawResult, type GameStatus } from "./result.ts";

type Ending =
  | { readonly by: "flag"; readonly side: Color }
  | { readonly by: "resignation"; readonly side: Color };

/**
 * The one timeout and resignation authority (Articles 6.9 and 5.1.2,
 * LIVE-CONTRACT-001). Both ask one-sided questions: can the opponent of the
 * flagging or resigning side checkmate by any possible series of legal moves
 * from the current position? The game's repetition history and halfmove
 * clock do not take part.
 *
 * - PROVEN_CAN_MATE: the opponent wins, on `time` or by `resignation`.
 * - PROVEN_CANNOT_MATE: draw, `timeout_no_mate` or `resign_no_mate_possible`.
 * - UNKNOWN: MATING_POSSIBILITY_UNRESOLVED, with no result (DEC-064).
 *
 * Whole-position `NOT_DEAD` is never consulted: it does not say which side can mate.
 */
function statusAfter(position: Position, ending: Ending): GameStatus {
  const opponent = oppositeColor(ending.side);
  const capability = assessMatingCapability(position, opponent);
  if (capability === "PROVEN_CAN_MATE") {
    return Object.freeze({
      kind: "finished",
      result: Object.freeze({
        resultCode: opponent === "white" ? "white_win" : "black_win",
        terminationReason: ending.by === "flag" ? "time" : "resignation",
        winner: opponent,
      }),
    });
  }
  if (capability === "PROVEN_CANNOT_MATE") {
    return Object.freeze({
      kind: "finished",
      result: drawResult([ending.by === "flag" ? "timeout_no_mate" : "resign_no_mate_possible"]),
    });
  }
  return ending.by === "flag"
    ? Object.freeze({
        kind: "unresolved",
        reason: "MATING_POSSIBILITY_UNRESOLVED",
        flaggedSide: ending.side,
      })
    : Object.freeze({
        kind: "unresolved",
        reason: "MATING_POSSIBILITY_UNRESOLVED",
        resigningSide: ending.side,
      });
}

/** The status after `flaggedSide`'s time runs out, used by every flag path. */
export function statusAfterFlag(position: Position, flaggedSide: Color): GameStatus {
  return statusAfter(position, { by: "flag", side: flaggedSide });
}

/** The status after `resigningSide` resigns. */
export function statusAfterResignation(position: Position, resigningSide: Color): GameStatus {
  return statusAfter(position, { by: "resignation", side: resigningSide });
}
