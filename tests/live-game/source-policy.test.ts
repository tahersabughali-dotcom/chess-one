import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SOURCE_DIRS = ["../../server/live-game/src/", "../../server/live-game-persistence/src/"].map(
  (path) => fileURLToPath(new URL(path, import.meta.url)),
);
const SOURCES = SOURCE_DIRS.flatMap((dir) =>
  readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".ts"))
    .map((name) => ({ name, text: readFileSync(`${dir}${name}`, "utf8") })),
);

describe("TST-LIVE source policy", () => {
  it("TST-LIVE-095 live-game never names the default ruleset literally; it uses the registry", () => {
    expect(SOURCES.length).toBeGreaterThan(0);
    expect(SOURCES.map(({ name }) => name.replaceAll("\\", "/"))).toEqual(
      expect.arrayContaining(["persistence/state-codec.ts", "repository.ts"]),
    );
    for (const { name, text } of SOURCES) {
      expect(text.includes("FIDE-E01-2023"), name).toBe(false);
    }
  });

  it("TST-LIVE-096 live-game has no suppression comments and no assertion casts", () => {
    for (const { name, text } of SOURCES) {
      expect(/@ts-(?:ignore|expect-error|nocheck)|biome-ignore/.test(text), name).toBe(false);
      expect(
        /\bas\s+(?!const\b)[A-Z_a-z{[]|<[A-Z]\w*>\s*\w/.test(
          text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""),
        ),
        name,
      ).toBe(false);
    }
  });
});
