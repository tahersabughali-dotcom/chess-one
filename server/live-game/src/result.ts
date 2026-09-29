import {
  assessMatingPossibility,
  evaluateAutomaticDraws,
  evaluateMoveExhaustion,
  type Position,
  type RepetitionKey,
} from "@chess-one/chess-rules";
import type { Color } from "@chess-one/game-values";
import type { WallClockMs } from "./clock.ts";

/** Engineering draw details of the default ruleset (CONTRACT_CATALOG_V1 section 5). */
export type DrawRuleDetail =
  | "stalemate"
  | "dead_position"
  | "threefold_claim"
  | "fifty_move_claim"
  | "fivefold"
  | "seventy_five_move"
  | "timeout_no_mate"
  | "resign_no_mate_possible";

/**
 * Only outcomes that reviewed rules decide unambiguously. A time or
 * resignation result exists only when the opponent's one-sided mating
 * capability is proven (LIVE-CONTRACT-001): a win when it can mate, a draw
 * (`timeout_no_mate`, `resign_no_mate_possible`) when it cannot. An accepted
 * draw offer is `draw_agreed`, which has no draw-rule detail (section 5).
 * There is no result for abandonment yet. Coexisting draw facts are all
 * retained in listing order because no rule picks one detail.
 */
export type GameResult =
  | {
      readonly resultCode: "white_win" | "black_win";
      readonly terminationReason: "checkmate" | "time" | "resignation";
      readonly winner: Color;
    }
  | {
      readonly resultCode: "draw";
      readonly terminationReason: "draw_rule";
      readonly drawRuleDetails: readonly DrawRuleDetail[];
    }
  | { readonly resultCode: "draw"; readonly terminationReason: "draw_agreed" };

export const DRAW_AGREED: GameResult = Object.freeze({
  resultCode: "draw",
  terminationReason: "draw_agreed",
});

/** A rule fact about a position reached by a committed move. */
export type PositionFact =
  | { readonly kind: "checkmate"; readonly winner: Color }
  | { readonly kind: "stalemate" | "fivefold" | "seventy_five_move" | "dead_position" };

/**
 * `awaiting_players` is a created game before its start: no clock runs and no
 * command is accepted until both players are ready and the writer starts it.
 * `aborted_before_start` is a game that never started because its start
 * deadline passed: no result, no winner, no rating effect.
 * `active` accepts commands. `finished` holds an immutable committed result.
 * `unresolved` stops play without an official result:
 * - MATING_POSSIBILITY_UNRESOLVED: a flag or a resignation whose outcome
 *   depends on the opponent's mating capability, which is `UNKNOWN` for this
 *   position (DEC-064, GAP-MATE-004).
 * - TERMINAL_PRECEDENCE_UNRESOLVED: facts whose precedence is not approved.
 */
export type GameStatus =
  | { readonly kind: "awaiting_players"; readonly startDeadlineAtWallMs: WallClockMs }
  | {
      readonly kind: "aborted_before_start";
      readonly reason: "START_DEADLINE_PASSED";
      readonly startDeadlineAtWallMs: WallClockMs;
    }
  | { readonly kind: "active" }
  | { readonly kind: "finished"; readonly result: GameResult }
  | {
      readonly kind: "unresolved";
      readonly reason: "MATING_POSSIBILITY_UNRESOLVED";
      readonly flaggedSide: Color;
    }
  | {
      readonly kind: "unresolved";
      readonly reason: "MATING_POSSIBILITY_UNRESOLVED";
      readonly resigningSide: Color;
    }
  | {
      readonly kind: "unresolved";
      readonly reason: "TERMINAL_PRECEDENCE_UNRESOLVED";
      readonly facts: readonly PositionFact[];
    };

export const ACTIVE: GameStatus = Object.freeze({ kind: "active" });

/**
 * The coarse lifecycle a client sees. `in_progress` is the active game;
 * `ended` is a finished or unresolved one (play stopped after the start).
 */
export type GameLifecycle = "awaiting_players" | "in_progress" | "ended" | "aborted_before_start";

export function lifecycleOf(status: GameStatus): GameLifecycle {
  switch (status.kind) {
    case "awaiting_players":
    case "aborted_before_start":
      return status.kind;
    case "active":
      return "in_progress";
    case "finished":
    case "unresolved":
      return "ended";
  }
}

/** Existing chess-rules facts for `position`, the last entry of `history`, in a fixed order. */
export function positionFacts(
  history: readonly RepetitionKey[],
  position: Position,
): readonly PositionFact[] {
  const automatic = evaluateAutomaticDraws(history, position);
  if (!automatic.ok) throw new Error("Live game defect: history does not end at the position");
  const exhaustion = evaluateMoveExhaustion(position);
  const facts: PositionFact[] = [];
  if (exhaustion !== null) {
    facts.push(
      exhaustion.kind === "checkmate"
        ? { kind: "checkmate", winner: exhaustion.winner }
        : { kind: "stalemate" },
    );
  }
  if (automatic.value.fivefold) facts.push({ kind: "fivefold" });
  if (automatic.value.seventyFiveMove) facts.push({ kind: "seventy_five_move" });
  if (assessMatingPossibility(position) === "PROVEN_DEAD") facts.push({ kind: "dead_position" });
  return Object.freeze(facts.map((fact) => Object.freeze(fact)));
}

export function drawResult(details: readonly DrawRuleDetail[]): GameResult {
  return Object.freeze({
    resultCode: "draw",
    terminationReason: "draw_rule",
    drawRuleDetails: Object.freeze([...details]),
  });
}

/**
 * Status from position facts. Approved precedence only: checkmate outranks
 * the seventy-five-move rule (9.6.2), which chess-rules already suppresses.
 * Checkmate alone is a win and draw facts alone are a draw. Checkmate beside
 * any other fact has no approved precedence, so it is held unresolved.
 */
export function statusFromFacts(facts: readonly PositionFact[]): GameStatus {
  if (facts.length === 0) return ACTIVE;
  const [first] = facts;
  if (first?.kind === "checkmate" && facts.length === 1) {
    return Object.freeze({
      kind: "finished",
      result: Object.freeze({
        resultCode: first.winner === "white" ? "white_win" : "black_win",
        terminationReason: "checkmate",
        winner: first.winner,
      }),
    });
  }
  const draws: DrawRuleDetail[] = [];
  for (const fact of facts) {
    if (fact.kind === "checkmate") {
      return Object.freeze({
        kind: "unresolved",
        reason: "TERMINAL_PRECEDENCE_UNRESOLVED",
        facts: Object.freeze([...facts]),
      });
    }
    draws.push(fact.kind);
  }
  return Object.freeze({ kind: "finished", result: drawResult(draws) });
}
