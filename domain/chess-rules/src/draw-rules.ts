import { err, type MoveIntent, ok, type Result } from "@chess-one/game-values";
import { type LegalMoveError, resolveLegalMove } from "./legal-moves.ts";
import { applyPseudoLegalMove } from "./move-transition.ts";
import type { Position } from "./position.ts";
import {
  isCurrentHistory,
  type RepetitionKey,
  type RuleHistoryError,
  repetitionCount,
} from "./repetition.ts";
import { evaluateMoveExhaustion } from "./terminal.ts";

/**
 * Pure draw rules of the default ruleset over a supplied authoritative history. These are
 * rule facts, not a GameResult, game event, clock change, or command response;
 * the Live Game authority applies their consequences later.
 *
 * Threefold (9.2) and fifty-move (9.3) are claims by the side to move and never
 * end a game on their own. Fivefold (9.6.1) and seventy-five-move (9.6.2) are
 * automatic and need no claim.
 */

/** Article 9.5.3: an incorrect claim adds two minutes to the opponent. A rule fact only. */
export const INCORRECT_CLAIM_BONUS_MS = 120_000;

const THREEFOLD = 3;
const FIFTY_MOVES_IN_HALFMOVES = 100;
const FIVEFOLD = 5;
const SEVENTY_FIVE_MOVES_IN_HALFMOVES = 150;

export type DrawClaimKind =
  | "threefold_current"
  | "threefold_intended"
  | "fifty_move_current"
  | "fifty_move_intended";

export type DrawClaim =
  | { readonly kind: "threefold_current" }
  | { readonly kind: "fifty_move_current" }
  | { readonly kind: "threefold_intended"; readonly intended: MoveIntent }
  | { readonly kind: "fifty_move_intended"; readonly intended: MoveIntent };

/**
 * What a claim was judged on: the current position, or for an intended claim
 * the hypothetical position after the intended move, which is never applied
 * here. `repetitionCount` includes that position.
 */
export interface ClaimEvidence {
  readonly position: Position;
  readonly repetitionCount: number;
}

/**
 * The intended move of an `_intended` claim:
 * - `not_applied`: the claim is correct; the move proves it and the game is drawn without playing it.
 * - `must_apply`: the claim is incorrect and the move is legal, so it must then be played (9.5.3).
 * - `illegal`: the move is illegal and must not be applied.
 */
export type IntendedMoveDisposition =
  | { readonly disposition: "not_applied"; readonly move: MoveIntent }
  | {
      readonly disposition: "must_apply";
      readonly move: MoveIntent;
      readonly resultingPosition: Position;
    }
  | { readonly disposition: "illegal"; readonly error: LegalMoveError };

export type DrawClaimAssessment =
  | {
      readonly verdict: "correct";
      readonly kind: DrawClaimKind;
      readonly evidence: ClaimEvidence;
      readonly intendedMove: IntendedMoveDisposition | null;
    }
  | {
      readonly verdict: "incorrect";
      readonly kind: DrawClaimKind;
      readonly opponentBonusMs: typeof INCORRECT_CLAIM_BONUS_MS;
      readonly evidence: ClaimEvidence | null;
      readonly intendedMove: IntendedMoveDisposition | null;
    };

function isTrue(kind: DrawClaimKind, evidence: ClaimEvidence): boolean {
  return kind === "threefold_current" || kind === "threefold_intended"
    ? evidence.repetitionCount >= THREEFOLD
    : evidence.position.halfmoveClock >= FIFTY_MOVES_IN_HALFMOVES;
}

function assess(
  kind: DrawClaimKind,
  evidence: ClaimEvidence | null,
  correctMove: IntendedMoveDisposition | null,
  incorrectMove: IntendedMoveDisposition | null,
): DrawClaimAssessment {
  if (evidence !== null && isTrue(kind, evidence)) {
    return Object.freeze({ verdict: "correct", kind, evidence, intendedMove: correctMove });
  }
  return Object.freeze({
    verdict: "incorrect",
    kind,
    opponentBonusMs: INCORRECT_CLAIM_BONUS_MS,
    evidence,
    intendedMove: incorrectMove,
  });
}

/**
 * Judges a draw claim by the side to move. `history` follows the convention of
 * `repetitionCount` and must end with `position`. An intended move is resolved
 * through the legal-move authority and applied only hypothetically; neither
 * `position` nor `history` changes.
 */
export function evaluateDrawClaim(
  history: readonly RepetitionKey[],
  position: Position,
  claim: DrawClaim,
): Result<DrawClaimAssessment, RuleHistoryError> {
  if (!isCurrentHistory(history, position)) return err("history_not_current");
  if (claim.kind === "threefold_current" || claim.kind === "fifty_move_current") {
    const evidence = Object.freeze({
      position,
      repetitionCount: repetitionCount(history, position),
    });
    return ok(assess(claim.kind, evidence, null, null));
  }
  const resolved = resolveLegalMove(position, claim.intended);
  if (!resolved.ok) {
    const illegal: IntendedMoveDisposition = Object.freeze({
      disposition: "illegal",
      error: resolved.error,
    });
    return ok(assess(claim.kind, null, null, illegal));
  }
  const move = resolved.value;
  const next = applyPseudoLegalMove(position, move);
  const evidence = Object.freeze({
    position: next,
    repetitionCount: repetitionCount(history, next) + 1,
  });
  const notApplied: IntendedMoveDisposition = Object.freeze({ disposition: "not_applied", move });
  const mustApply: IntendedMoveDisposition = Object.freeze({
    disposition: "must_apply",
    move,
    resultingPosition: next,
  });
  return ok(assess(claim.kind, evidence, notApplied, mustApply));
}

/**
 * Automatic draw facts, reported separately rather than ranked. Fivefold: the
 * current identity has appeared at least five times (9.6.1). Seventy-five-move:
 * at least 150 halfmoves without a pawn move or capture, unless the position is
 * checkmate, which takes precedence (9.6.2). Event ordering is later work.
 */
export interface AutomaticDrawFacts {
  readonly fivefold: boolean;
  readonly seventyFiveMove: boolean;
}

export function evaluateAutomaticDraws(
  history: readonly RepetitionKey[],
  position: Position,
): Result<AutomaticDrawFacts, RuleHistoryError> {
  if (!isCurrentHistory(history, position)) return err("history_not_current");
  const seventyFiveMove =
    position.halfmoveClock >= SEVENTY_FIVE_MOVES_IN_HALFMOVES &&
    evaluateMoveExhaustion(position)?.kind !== "checkmate";
  return ok(
    Object.freeze({
      fivefold: repetitionCount(history, position) >= FIVEFOLD,
      seventyFiveMove,
    }),
  );
}
