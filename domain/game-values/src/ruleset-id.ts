const RULESET_ID_SYNTAX = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/;

/**
 * Checks only the text shape of a ruleset id. Whether an id is known is decided
 * by the registry in the chess rules library.
 */
export function isWellFormedRulesetId(value: string): boolean {
  return RULESET_ID_SYNTAX.test(value);
}
