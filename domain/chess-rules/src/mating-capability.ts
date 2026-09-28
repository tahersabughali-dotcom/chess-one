import { type Color, type MoveIntent, oppositeColor } from "@chess-one/game-values";
import { searchCooperativeMate, type WitnessShape } from "./mating-witness.ts";
import type { Position } from "./position.ts";

/**
 * One-sided mating capability (Articles 5.1.2 and 6.9, GAP-MATE-004): can
 * `matingColor` checkmate the other king by any possible series of legal
 * moves (Article 3.10.1) from this position? This asks about possibility,
 * with both sides' moves chosen cooperatively. It is not forced mate, best
 * play, an evaluation, or a probability, and it is a different predicate from
 * the whole-position `assessMatingPossibility`, which asks whether either side
 * can ever mate. It depends on the position alone: repetition history,
 * fivefold, the halfmove clock, and the seventy-five-move rule end an ongoing
 * game but do not change whether such a series exists.
 *
 * `UNKNOWN` is a required, safe answer, not a failure. Under DEC-064 it must
 * never be mapped to a win, loss, or draw.
 */
export type MatingCapability = "PROVEN_CAN_MATE" | "PROVEN_CANNOT_MATE" | "UNKNOWN";

/** Non-king material of `color`, sorted by kind name, e.g. "" or "knight knight". */
function materialOf(position: Position, color: Color): string {
  return position.board
    .flatMap((cell) =>
      cell !== null && cell.color === color && cell.kind !== "king" ? [cell.kind] : [],
    )
    .sort()
    .join(" ");
}

/** Material for which a cooperative mating line is searched, against a lone king only. */
const WITNESS_SHAPES: Readonly<Record<string, WitnessShape>> = Object.freeze({
  queen: "major_piece",
  rook: "major_piece",
  "knight knight": "two_knights",
});

/**
 * A verified cooperative mating line for `matingColor`, or `null`. Lines are
 * only searched for king and queen, king and rook, or king and two knights
 * against a lone king; `null` elsewhere, and `null` after a bounded search,
 * prove nothing.
 */
export function findMatingWitness(
  position: Position,
  matingColor: Color,
): readonly MoveIntent[] | null {
  if (materialOf(position, oppositeColor(matingColor)) !== "") return null;
  const shape = WITNESS_SHAPES[materialOf(position, matingColor)];
  return shape === undefined ? null : searchCooperativeMate(position, matingColor, shape);
}

/**
 * Only reviewed classes return a proven answer (MATING_POSSIBILITY_AND_DEAD_POSITION_RESEARCH_V1
 * section 9). Everything else is `UNKNOWN`.
 *
 * PROVEN_CANNOT_MATE, lone king: `matingColor` owns only its king. A mate
 * needs the mated king in check, and a king never gives check, because two
 * kings are never adjacent in a legal position. With no pawn, `matingColor`
 * can never gain material (promotion is the only way), so this holds in every
 * reachable position, whatever the opponent owns.
 *
 * PROVEN_CANNOT_MATE, king and one bishop or one knight against a lone king:
 * no pawn exists, so neither side can gain material, and every reachable
 * position is this material or king against king. In neither can the lone
 * king be mated. A mated lone king has at least three flight squares. On a
 * corner they are the two squares beside it, which share a colour, and the
 * diagonal square of the other colour. The attacking king cannot cover both
 * same-coloured squares, because the only square next to both is next to
 * the lone king. A bishop covers one colour. When it checks, it covers the
 * diagonal square and not the other two. A checking knight covers none of
 * them. On an edge or in the open there are more flight squares. An
 * exhaustive test over every placement confirms that no such checkmate exists
 * (TST-RULE-CAP-004, TST-RULE-CAP-005).
 *
 * PROVEN_CAN_MATE: only when `findMatingWitness` returns a line that the
 * public move and terminal functions have replayed to checkmate, with every
 * move legal and no checkmate or stalemate before the last. The line is the
 * proof, so there is no material assumption. For example, king and queen
 * against a king whose only legal move captures the queen has no line, and is
 * `UNKNOWN`.
 *
 * The answer never depends on whose turn it is beyond the legal moves
 * themselves, nor on the halfmove clock, and `position` is never modified.
 */
export function assessMatingCapability(position: Position, matingColor: Color): MatingCapability {
  const mating = materialOf(position, matingColor);
  if (mating === "") return "PROVEN_CANNOT_MATE";
  if (materialOf(position, oppositeColor(matingColor)) !== "") return "UNKNOWN";
  if (mating === "bishop" || mating === "knight") return "PROVEN_CANNOT_MATE";
  return findMatingWitness(position, matingColor) === null ? "UNKNOWN" : "PROVEN_CAN_MATE";
}
