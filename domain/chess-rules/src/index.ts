export { type FenError, type FenErrorCode, formatFen, parseFen } from "./fen.ts";
export { createInitialPosition } from "./initial-position.ts";
export { assessMatingPossibility, type MatingPossibility } from "./mating-possibility.ts";
export { type Board, type CastlingRights, type Position, pieceAt } from "./position.ts";
export { type ConsistencyIssue, checkPositionConsistency } from "./position-consistency.ts";
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
