import { err, ok, type Result } from "@chess-one/game-values";

/** The only place the FIDE-E01-2023 id text may appear in production code (DEC-051). */
export const FIDE_E01_2023 = "FIDE-E01-2023";

export type RulesetId = typeof FIDE_E01_2023;

export interface RulesetDefinition {
  readonly id: RulesetId;
  readonly authority: "FIDE";
  readonly title: string;
  readonly sourceUrl: string;
  readonly approvedOn: string;
  readonly effectiveFrom: string;
  readonly initialPositionFen: string;
}

const DEFINITIONS: Readonly<Record<RulesetId, RulesetDefinition>> = Object.freeze({
  [FIDE_E01_2023]: Object.freeze({
    id: FIDE_E01_2023,
    authority: "FIDE",
    title: "FIDE Laws of Chess taking effect from 1 January 2023",
    sourceUrl: "https://handbook.fide.com/chapter/e012023",
    approvedOn: "2022-08-07",
    effectiveFrom: "2023-01-01",
    initialPositionFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  }),
});

/** Ruleset for newly created games. Existing games keep the id they were played under. */
export const DEFAULT_RULESET_ID: RulesetId = FIDE_E01_2023;

export function isRulesetId(value: string): value is RulesetId {
  return Object.hasOwn(DEFINITIONS, value);
}

export function getRuleset(id: RulesetId): RulesetDefinition {
  return DEFINITIONS[id];
}

export function resolveRuleset(value: string): Result<RulesetDefinition, "unknown_ruleset"> {
  return isRulesetId(value) ? ok(DEFINITIONS[value]) : err("unknown_ruleset");
}

export function listRulesetIds(): readonly RulesetId[] {
  return Object.freeze(Object.values(DEFINITIONS).map((definition) => definition.id));
}
