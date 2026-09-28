import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const manifest: unknown = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
);

function scripts(): ReadonlyMap<string, unknown> {
  if (typeof manifest !== "object" || manifest === null)
    throw new Error("package.json is not an object");
  const entries: [string, unknown][] = Object.entries(manifest);
  const value = new Map(entries).get("scripts");
  if (typeof value !== "object" || value === null) throw new Error("package.json has no scripts");
  const scriptEntries: [string, unknown][] = Object.entries(value);
  return new Map(scriptEntries);
}

describe("TST-BOUNDARY root scripts", () => {
  it("TST-BOUNDARY-014 check chains every gate with && so any failure stops it", () => {
    const all = scripts();
    const steps = ["typecheck", "lint", "format:check", "check:boundaries", "test"].map((name) => {
      const command = all.get(name);
      if (typeof command !== "string") throw new Error(`missing script ${name}`);
      return command;
    });
    expect(all.get("check")).toBe(steps.join(" && "));
  });
});
