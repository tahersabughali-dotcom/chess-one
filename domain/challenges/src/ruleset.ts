import { DEFAULT_RULESET_ID, isRulesetId, type RulesetId } from "@chess-one/chess-rules";

/**
 * Rulesets a challenge may name: those the live game plays today. A ruleset
 * joins this list only once the live game supports it.
 */
export const CHALLENGE_RULESET_IDS: readonly RulesetId[] = Object.freeze([DEFAULT_RULESET_ID]);

export const DEFAULT_CHALLENGE_RULESET_ID: RulesetId = DEFAULT_RULESET_ID;

export function parseChallengeRuleset(value: string): RulesetId | null {
  return isRulesetId(value) && CHALLENGE_RULESET_IDS.includes(value) ? value : null;
}
