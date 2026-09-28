import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findBoundaryViolations, type SourceFile } from "../../tooling/boundaries/rules.ts";
import { collectRepositoryFiles } from "../../tooling/check-boundaries.ts";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

function rulesFor(...files: SourceFile[]): string[] {
  return findBoundaryViolations(files).map((violation) => violation.rule);
}

const gv = (name: string, content: string): SourceFile => ({
  path: `domain/game-values/src/${name}`,
  content,
});
const cr = (name: string, content: string): SourceFile => ({
  path: `domain/chess-rules/src/${name}`,
  content,
});

describe("TST-BOUNDARY dependency boundaries", () => {
  it("TST-BOUNDARY-001 the repository has no violations", () => {
    expect(findBoundaryViolations(collectRepositoryFiles(REPO_ROOT))).toEqual([]);
  });

  it("TST-BOUNDARY-002 chess-rules may import only the public game-values entry", () => {
    expect(rulesFor(cr("a.ts", 'import { x } from "@chess-one/game-values";'))).toEqual([]);
    expect(rulesFor(cr("a.ts", 'import { readFileSync } from "node:fs";'))).toContain(
      "forbidden_import",
    );
    expect(rulesFor(cr("a.ts", 'import pg from "pg";'))).toContain("forbidden_import");
    expect(rulesFor(cr("a.ts", 'import x from "fastify";'))).toContain("forbidden_import");
    expect(rulesFor(cr("a.ts", 'export * from "../../../server/live-game/x.ts";'))).toContain(
      "relative_escape",
    );
    expect(rulesFor(cr("a.ts", 'const m = await import("node:net");'))).toContain(
      "forbidden_import",
    );
    expect(rulesFor(cr("a.ts", 'const ws = require("ws");'))).toContain("forbidden_import");
  });

  it("TST-BOUNDARY-003 game-values imports nothing outside itself", () => {
    expect(
      rulesFor(gv("a.ts", 'import { x } from "./b.ts";'), gv("b.ts", "export const x = 1;")),
    ).toEqual([]);
    expect(rulesFor(gv("a.ts", 'import { x } from "@chess-one/chess-rules";'))).toContain(
      "forbidden_import",
    );
    expect(rulesFor(gv("a.ts", 'import "node:fs";'))).toContain("forbidden_import");
    expect(rulesFor(gv("a.ts", 'import { x } from "../../chess-rules/src/fen.ts";'))).toContain(
      "relative_escape",
    );
  });

  it("TST-BOUNDARY-004 deep imports that bypass a public entry fail", () => {
    expect(
      rulesFor(cr("a.ts", 'import { s } from "@chess-one/game-values/src/square.ts";')),
    ).toContain("deep_import_bypass");
    const testFile: SourceFile = {
      path: "tests/rules/x.test.ts",
      content: 'import { parseFen } from "../../domain/chess-rules/src/fen.ts";',
    };
    expect(rulesFor(testFile)).toContain("deep_import_bypass");
  });

  it("TST-BOUNDARY-005 ambient I/O, clock, randomness, and environment are rejected in domain code", () => {
    for (const code of [
      "const e = process.env.X;",
      "const t = Date.now();",
      "const d = new Date();",
      "const r = Math.random();",
      "const p = performance.now();",
      'await fetch("https://x");',
      "setTimeout(() => {}, 1);",
      'console.log("x");',
    ]) {
      expect(rulesFor(gv("a.ts", code))).toContain("ambient_access");
    }
    expect(rulesFor(gv("a.ts", '// Date.now() in a comment\nconst s = "process.env";'))).toEqual(
      [],
    );
  });

  it("TST-BOUNDARY-006 test tools and test helpers never become production dependencies", () => {
    expect(rulesFor(cr("a.ts", 'import { it } from "vitest";'))).toContain(
      "test_dependency_in_production",
    );
    expect(rulesFor(cr("a.ts", 'import fc from "fast-check";'))).toContain(
      "test_dependency_in_production",
    );
    expect(
      rulesFor(cr("a.ts", 'import { h } from "../../../tests/rules/support/attack-oracle.ts";')),
    ).toContain("test_dependency_in_production");
    const manifest = (dependencies: Record<string, string>): SourceFile => ({
      path: "domain/chess-rules/package.json",
      content: JSON.stringify({ exports: { ".": "./src/index.ts" }, dependencies }),
    });
    expect(rulesFor(manifest({ "@chess-one/game-values": "workspace:*" }))).toEqual([]);
    expect(rulesFor(manifest({ vitest: "5.0.2" }))).toContain("test_dependency_in_production");
    expect(rulesFor(manifest({ "@chess-one/tests-rules": "workspace:*" }))).toContain(
      "test_dependency_in_production",
    );
    expect(rulesFor(manifest({ redis: "1.0.0" }))).toContain("forbidden_dependency");
    const root: SourceFile = {
      path: "package.json",
      content: JSON.stringify({ dependencies: { vitest: "5" } }),
    };
    expect(rulesFor(root)).toContain("test_dependency_in_production");
  });

  it("TST-BOUNDARY-007 domain packages expose exactly one public entry", () => {
    const manifest: SourceFile = {
      path: "domain/game-values/package.json",
      content: JSON.stringify({
        exports: { ".": "./src/index.ts", "./square": "./src/square.ts" },
      }),
    };
    expect(rulesFor(manifest)).toContain("public_entry");
  });

  it("TST-BOUNDARY-008 future contracts may not import server or client code", () => {
    const contract = (content: string): SourceFile => ({ path: "contracts/move.ts", content });
    expect(rulesFor(contract('import { a } from "../server/live-game/a.ts";'))).toContain(
      "contract_imports_runtime",
    );
    expect(rulesFor(contract('import { a } from "@chess-one/web-client";'))).toContain(
      "contract_imports_runtime",
    );
    expect(rulesFor(contract('import { v } from "@chess-one/game-values";'))).toEqual([]);
  });

  it("TST-BOUNDARY-009 import cycles and non-literal dynamic imports fail", () => {
    expect(
      rulesFor(
        gv("a.ts", 'import { b } from "./b.ts";'),
        gv("b.ts", 'import { a } from "./a.ts";'),
      ),
    ).toContain("import_cycle");
    expect(rulesFor(gv("a.ts", "const m = await import(name);"))).toContain(
      "non_literal_dynamic_import",
    );
  });

  it("TST-BOUNDARY-010 license-gated chess libraries are rejected anywhere", () => {
    const manifest: SourceFile = {
      path: "tests/rules/package.json",
      content: JSON.stringify({ dependencies: { "chess.js": "1.0.0" } }),
    };
    expect(rulesFor(manifest)).toContain("license_gated_package");
    const test: SourceFile = {
      path: "tests/rules/x.test.ts",
      content: 'import { Chess } from "chess.js";',
    };
    expect(rulesFor(test)).toContain("license_gated_package");
  });

  it("TST-BOUNDARY-012 non-TypeScript sources in domain code are rejected and still scanned", () => {
    const rules = rulesFor(cr("legacy.js", 'const fs = require("node:fs");'));
    expect(rules).toContain("unexpected_source_type");
    expect(rules).toContain("forbidden_import");
  });

  it("TST-BOUNDARY-013 import.meta, crypto, and Buffer are ambient access in domain code", () => {
    for (const code of ["const u = import.meta.url;", "crypto.randomUUID();", "Buffer.from([]);"]) {
      expect(rulesFor(gv("a.ts", code))).toContain("ambient_access");
    }
  });

  it("TST-BOUNDARY-011 regex literals and strings do not confuse the scanner", () => {
    const code = [
      "const quote = /[\"']/;",
      'const text = "import x from \\"node:fs\\"";',
      'const template = `require("ws")`;',
      'import { y } from "./b.ts";',
    ].join("\n");
    expect(rulesFor(gv("a.ts", code), gv("b.ts", "export const y = 1;"))).toEqual([]);
  });
});
