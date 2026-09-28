import type { Piece } from "@chess-one/game-values";
import type { Position } from "./position.ts";

/**
 * Result of the whole-position mating-possibility check (Article 5.2.2,
 * DEC-062). `UNKNOWN` is not a game result: under DEC-064 it must never be
 * mapped to a win, loss, or draw.
 */
export type MatingPossibility = "PROVEN_DEAD" | "NOT_DEAD" | "UNKNOWN";

/**
 * Only the hand-proven set in MATING_POSSIBILITY_AND_DEAD_POSITION_RESEARCH_V1
 * section 4 returns `PROVEN_DEAD`: king versus king, and king plus one bishop or
 * one knight versus a lone king, for either colour. Every other position returns
 * `UNKNOWN`; this batch has no reviewed `NOT_DEAD` proof to apply. Widening the
 * proven set requires a written proof in that document first.
 */
export function assessMatingPossibility(position: Position): MatingPossibility {
  const pieces = position.board.filter((cell): cell is Piece => cell !== null);
  const kings = pieces.filter((piece) => piece.kind === "king");
  const whiteKings = kings.filter((piece) => piece.color === "white").length;
  if (kings.length !== 2 || whiteKings !== 1) return "UNKNOWN";

  const others = pieces.filter((piece) => piece.kind !== "king");
  if (others.length === 0) return "PROVEN_DEAD";
  const [only] = others;
  if (others.length === 1 && (only?.kind === "bishop" || only?.kind === "knight")) {
    return "PROVEN_DEAD";
  }
  return "UNKNOWN";
}
