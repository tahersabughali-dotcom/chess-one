import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_RULESET_ID,
  FIDE_E01_2023,
  getRuleset,
  isRulesetId,
  listRulesetIds,
  resolveRuleset,
} from "@chess-one/chess-rules";
import { isWellFormedRulesetId } from "@chess-one/game-values";
import { describe, expect, it } from "vitest";

const DOMAIN_ROOT = fileURLToPath(new URL("../../domain", import.meta.url));

function productionSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : productionSources(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("TST-FOUND-RULESET ruleset registry", () => {
  it("TST-FOUND-RULESET-001 the only registered ruleset is FIDE-E01-2023, and it is the default", () => {
    expect(FIDE_E01_2023).toBe("FIDE-E01-2023");
    expect(listRulesetIds()).toEqual([FIDE_E01_2023]);
    expect(DEFAULT_RULESET_ID).toBe(FIDE_E01_2023);
    expect(isWellFormedRulesetId(FIDE_E01_2023)).toBe(true);
  });

  it("TST-FOUND-RULESET-002 metadata matches DEC-051", () => {
    const ruleset = getRuleset(FIDE_E01_2023);
    expect(ruleset.authority).toBe("FIDE");
    expect(ruleset.sourceUrl).toBe("https://handbook.fide.com/chapter/e012023");
    expect(ruleset.approvedOn).toBe("2022-08-07");
    expect(ruleset.effectiveFrom).toBe("2023-01-01");
    expect(Object.isFrozen(ruleset)).toBe(true);
  });

  it("TST-FOUND-RULESET-003 unknown ids are rejected, not defaulted", () => {
    for (const text of [
      "",
      "FIDE-E01-2018",
      "fide-e01-2023",
      "FIDE-E01-2023 ",
      "toString",
      "__proto__",
    ]) {
      expect(isRulesetId(text)).toBe(false);
      expect(resolveRuleset(text)).toEqual({ ok: false, error: "unknown_ruleset" });
    }
    expect(resolveRuleset("FIDE-E01-2023")).toEqual({ ok: true, value: getRuleset(FIDE_E01_2023) });
  });

  it("TST-FOUND-RULESET-004 the id text has a single source in production code", () => {
    const holders = productionSources(DOMAIN_ROOT)
      .filter((path) => readFileSync(path, "utf8").includes("FIDE-E01-2023"))
      .map((path) => path.replaceAll("\\", "/").split("/domain/")[1]);
    expect(holders).toEqual(["chess-rules/src/ruleset-registry.ts"]);
  });
});
