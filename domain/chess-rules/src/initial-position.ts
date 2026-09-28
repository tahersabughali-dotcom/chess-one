import { parseFen } from "./fen.ts";
import type { Position } from "./position.ts";
import { DEFAULT_RULESET_ID, getRuleset, type RulesetId } from "./ruleset-registry.ts";

export function createInitialPosition(rulesetId: RulesetId = DEFAULT_RULESET_ID): Position {
  const ruleset = getRuleset(rulesetId);
  const parsed = parseFen(ruleset.initialPositionFen);
  if (!parsed.ok) {
    throw new Error(
      `Ruleset ${ruleset.id} has an invalid initial position: ${parsed.error.message}`,
    );
  }
  return parsed.value;
}
