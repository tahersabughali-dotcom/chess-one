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

  it("TST-BOUNDARY-024 typecheck, lint, and format cover every source package", () => {
    const typecheck = script("typecheck");
    const biome: unknown = JSON.parse(
      readFileSync(fileURLToPath(new URL("../../biome.json", import.meta.url)), "utf8"),
    );
    const text = JSON.stringify(biome);
    for (const project of [
      "domain/game-values",
      "domain/chess-rules",
      "domain/identity",
      "server/live-game",
      "server/live-game-persistence",
      "server/live-game-runtime",
      "server/accounts",
      "server/accounts-persistence",
      "server/edge",
    ]) {
      expect(typecheck, project).toContain(`tsc -p ${project}`);
    }
    for (const root of ["domain/**", "server/**", "tests/**", "tooling/**"]) {
      expect(text, root).toContain(`"${root}"`);
    }
  });
});

describe("TST-BOUNDARY database integration wiring", () => {
  it("TST-BOUNDARY-028 PostgreSQL tests run only through test:db and cannot skip", () => {
    expect(script("test:db")).toBe("vitest run --config vitest.db.config.ts");
    expect(script("check")).not.toContain("test:db");
    const suite = readFileSync(
      fileURLToPath(new URL("../live-game-persistence/postgres.db.test.ts", import.meta.url)),
      "utf8",
    );
    expect(suite).not.toMatch(/\.(skip|todo|only)\b|skipIf|runIf/);
    expect(suite).toContain("BLOCKED by environment");
  });

  it("TST-BOUNDARY-033 realtime tests run in test (local) and test:realtime (with PostgreSQL); none can skip", () => {
    expect(script("test:realtime")).toBe("vitest run --config vitest.realtime.config.ts");
    expect(script("check")).not.toContain("test:realtime");
    const read = (path: string): string =>
      readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
    expect(read("../../vitest.realtime.config.ts")).toContain(
      'include: ["tests/realtime/**/*.test.ts"]',
    );
    expect(read("../../vitest.db.config.ts")).toContain('"tests/realtime/**/*.db.test.ts"');
    for (const suite of [
      "../realtime/realtime.db.test.ts",
      "../realtime/edge.test.ts",
      "../realtime/edge-config.test.ts",
      "../realtime/protocol.test.ts",
      "../realtime/writer-runtime.test.ts",
    ]) {
      expect(read(suite), suite).not.toMatch(/\.(skip|todo|only)\b|skipIf|runIf/);
    }
    expect(read("../realtime/realtime.db.test.ts")).toContain("withDisposableSchema");
    expect(read("../live-game-persistence/support/disposable-schema.ts")).toContain(
      "BLOCKED by environment",
    );
  });

  it("TST-BOUNDARY-041 auth tests run in test (local), test:db (PostgreSQL), and test:auth (all); none can skip", () => {
    expect(script("test:auth")).toBe("vitest run --config vitest.auth.config.ts");
    expect(script("check")).not.toContain("test:auth");
    const read = (path: string): string =>
      readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
    expect(read("../../vitest.auth.config.ts")).toContain(
      'include: ["tests/accounts/**/*.test.ts"]',
    );
    expect(read("../../vitest.db.config.ts")).toContain('"tests/accounts/**/*.db.test.ts"');
    for (const suite of [
      "../accounts/identity.test.ts",
      "../accounts/primitives.test.ts",
      "../accounts/accounts.test.ts",
      "../accounts/cookie.test.ts",
      "../accounts/http.test.ts",
      "../accounts/websocket-auth.test.ts",
      "../accounts/accounts.db.test.ts",
      "../accounts/websocket-auth.db.test.ts",
    ]) {
      expect(read(suite), suite).not.toMatch(/\.(skip|todo|only)\b|skipIf|runIf/);
    }
    expect(read("../accounts/support/db.ts")).toContain("testDatabaseUrl");
  });
});

function script(name: string): string {
  const command = scripts().get(name);
  if (typeof command !== "string") throw new Error(`missing script ${name}`);
  return command;
}
