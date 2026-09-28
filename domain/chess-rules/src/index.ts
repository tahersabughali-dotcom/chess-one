export { findKing, isInCheck, isSquareAttacked } from "./attacks.ts";
export {
  type AutomaticDrawFacts,
  type ClaimEvidence,
  type DrawClaim,
  type DrawClaimAssessment,
  type DrawClaimKind,
  evaluateAutomaticDraws,
  evaluateDrawClaim,
  INCORRECT_CLAIM_BONUS_MS,
  type IntendedMoveDisposition,
} from "./draw-rules.ts";
export { type FenError, type FenErrorCode, formatFen, parseFen } from "./fen.ts";
export { createInitialPosition } from "./initial-position.ts";
export { applyLegalMove, generateLegalMoves, type LegalMoveError } from "./legal-moves.ts";
export { assessMatingPossibility, type MatingPossibility } from "./mating-possibility.ts";
export {
  type Board,
  type CastlingRights,
  createPosition,
  isCanonicalPosition,
  type Position,
  type PositionFields,
  type PositionInvariantCode,
  type PositionInvariantError,
  pieceAt,
} from "./position.ts";
export { type ConsistencyIssue, checkPositionConsistency } from "./position-consistency.ts";
export {
  type RepetitionKey,
  type RuleHistoryError,
  repetitionCount,
  repetitionKey,
  samePositionForRepetition,
} from "./repetition.ts";
export {
  DEFAULT_RULESET_ID,
  FIDE_E01_2023,
  getRuleset,
  isRulesetId,
  listRulesetIds,
  type RulesetDefinition,
  type RulesetId,
  resolveRuleset,
} from "./ruleset-registry.ts";
export { toCanonicalSan } from "./san.ts";
export { evaluateMoveExhaustion, type MoveExhaustionFact } from "./terminal.ts";
