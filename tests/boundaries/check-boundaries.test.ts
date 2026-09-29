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
const lg = (name: string, content: string): SourceFile => ({
  path: `server/live-game/src/${name}`,
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

  it("TST-BOUNDARY-015 computed or aliased member access cannot hide ambient access", () => {
    for (const code of [
      'const t = Date["now"]();',
      'const r = Math["random"]();',
      "const m = Math;\nconst r = m.random();",
      'const e = process["env"];',
    ]) {
      expect(rulesFor(gv("a.ts", code)), code).toContain("ambient_access");
    }
  });

  it("TST-BOUNDARY-016 imports inside template interpolations and template specifiers are found", () => {
    for (const code of [
      // biome-ignore lint/suspicious/noTemplateCurlyInString: source text under test
      'const s = `${await import("node:fs")}`;',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: source text under test
      'const s = `${require("node:fs")}`;',
      "const m = await import(`node:fs`);",
    ]) {
      expect(rulesFor(cr("a.ts", code)), code).toContain("forbidden_import");
    }
  });

  it("TST-BOUNDARY-017 aliased or indirect loaders and evaluation are rejected", () => {
    for (const [code, rule] of [
      ['const r = require;\nr("node:fs");', "ambient_access"],
      ['const load = module.require;\nload("node:fs");', "ambient_access"],
      ['const e = eval;\ne("1");', "dynamic_code"],
      ['(0, eval)("1");', "dynamic_code"],
    ] as const) {
      expect(rulesFor(gv("a.ts", code)), code).toContain(rule);
    }
  });

  it("TST-BOUNDARY-018 eval and the Function constructor are rejected in domain code", () => {
    for (const code of [
      'eval("1");',
      'const f = new Function("return 1");',
      'const v = Function("return 1")();',
      'const v = (() => 0).constructor("return 1")();',
      'const v = []["constructor"]["constructor"]("return 1")();',
    ]) {
      expect(rulesFor(gv("a.ts", code)), code).toContain("dynamic_code");
    }
  });

  it("TST-BOUNDARY-019 strings, comments, regex literals, and property names are not code", () => {
    const code = [
      "const s = \"eval(x) Date.now() require('node:fs')\";",
      '// const m = await import("node:fs");',
      "/* new Function() process.env */",
      'const r = /import\\("node:fs"\\)|Date\\.now\\(\\)/;',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: source text under test
      "const t = `eval ${s.length} Date.now()`;",
      "const o = { eval: 1, Date: 2, constructorName: 3 };",
      "const v = o.eval + o.Date + Math.abs(-1);",
    ].join("\n");
    expect(rulesFor(gv("a.ts", code))).toEqual([]);
  });

  it("TST-BOUNDARY-020 live-game may import only the public game-values and chess-rules entries", () => {
    expect(
      rulesFor(
        lg("a.ts", 'import { x } from "@chess-one/game-values";'),
        lg("b.ts", 'import { y } from "@chess-one/chess-rules";\nimport { a } from "./a.ts";'),
      ),
    ).toEqual([]);
    for (const code of [
      'import pg from "pg";',
      'import { Kysely } from "kysely";',
      'import Fastify from "fastify";',
      'import { WebSocket } from "ws";',
      'import Redis from "ioredis";',
      'import { readFileSync } from "node:fs";',
      'import { ai } from "@chess-one/ai";',
      'import { wallet } from "@chess-one/economy";',
      'import { review } from "@chess-one/analysis";',
      'import { notify } from "@chess-one/notifications";',
      'import { App } from "@chess-one/web-client";',
    ]) {
      expect(rulesFor(lg("a.ts", code)), code).toContain("forbidden_import");
    }
    expect(
      rulesFor(lg("a.ts", 'import { p } from "@chess-one/chess-rules/src/fen.ts";')),
    ).toContain("deep_import_bypass");
    expect(
      rulesFor(lg("a.ts", 'import { p } from "../../../domain/chess-rules/src/fen.ts";')),
    ).toContain("relative_escape");
    expect(
      rulesFor(lg("a.ts", 'import { h } from "../../../tests/rules/support/positions.ts";')),
    ).toContain("test_dependency_in_production");
  });

  it("TST-BOUNDARY-021 live-game code has no ambient clock, randomness, I/O, or evaluation", () => {
    for (const code of [
      "const t = Date.now();",
      "const p = performance.now();",
      "const r = Math.random();",
      "const id = crypto.randomUUID();",
      "const e = process.env.X;",
      "setTimeout(() => {}, 1);",
    ]) {
      expect(rulesFor(lg("a.ts", code)), code).toContain("ambient_access");
    }
    expect(rulesFor(lg("a.ts", 'const f = new Function("return 1");'))).toContain("dynamic_code");
    expect(
      rulesFor(
        lg("a.ts", 'import { b } from "./b.ts";'),
        lg("b.ts", 'import { a } from "./a.ts";'),
      ),
    ).toContain("import_cycle");
  });

  it("TST-BOUNDARY-022 rules never depend on live-game, and nothing reaches its internals", () => {
    expect(
      rulesFor(cr("a.ts", 'import { processCommand } from "@chess-one/live-game";')),
    ).toContain("forbidden_import");
    expect(
      rulesFor(gv("a.ts", 'import { processCommand } from "@chess-one/live-game";')),
    ).toContain("forbidden_import");
    const testFile: SourceFile = {
      path: "tests/live-game/x.test.ts",
      content: 'import { startClock } from "../../server/live-game/src/clock.ts";',
    };
    expect(rulesFor(testFile)).toContain("deep_import_bypass");
    expect(
      rulesFor({
        path: "tests/live-game/y.test.ts",
        content: 'import { c } from "@chess-one/live-game/src/clock.ts";',
      }),
    ).toContain("deep_import_bypass");
  });

  it("TST-BOUNDARY-023 the live-game manifest allows only game-values and chess-rules", () => {
    const manifest = (
      dependencies: Record<string, string>,
      exports: Record<string, string> = { ".": "./src/index.ts" },
    ): SourceFile => ({
      path: "server/live-game/package.json",
      content: JSON.stringify({ exports, dependencies }),
    });
    expect(
      rulesFor(
        manifest({
          "@chess-one/chess-rules": "workspace:*",
          "@chess-one/game-values": "workspace:*",
        }),
      ),
    ).toEqual([]);
    for (const name of ["redis", "pg", "fastify", "ws", "kysely", "uuid"]) {
      expect(rulesFor(manifest({ [name]: "1.0.0" })), name).toContain("forbidden_dependency");
    }
    expect(rulesFor(manifest({ vitest: "5.0.2" }))).toContain("test_dependency_in_production");
    expect(
      rulesFor(manifest({}, { ".": "./src/index.ts", "./clock": "./src/clock.ts" })),
    ).toContain("public_entry");
  });

  it("TST-BOUNDARY-025 domain and the live-game core never reach persistence, Kysely, or pg", () => {
    for (const code of [
      'import { PostgresLiveGameRepository } from "@chess-one/live-game-persistence";',
      'import { Kysely } from "kysely";',
      'import { Migrator } from "kysely/migration";',
      'import pg from "pg";',
      'import { Pool } from "pg-pool";',
    ]) {
      expect(rulesFor(lg("persistence/a.ts", code)), code).toContain("forbidden_import");
      expect(rulesFor(cr("a.ts", code)), code).toContain("forbidden_import");
      expect(rulesFor(gv("a.ts", code)), code).toContain("forbidden_import");
    }
    expect(
      rulesFor(
        lg("persistence/a.ts", 'import { r } from "../../../live-game-persistence/src/x.ts";'),
      ),
    ).toContain("relative_escape");
  });

  it("TST-BOUNDARY-026 the persistence adapter imports only live-game, the domain, Kysely, pg, and file paths", () => {
    const lp = (name: string, content: string): SourceFile => ({
      path: `server/live-game-persistence/src/${name}`,
      content,
    });
    expect(
      rulesFor(
        lp(
          "a.ts",
          [
            'import { planCommit } from "@chess-one/live-game";',
            'import { ok } from "@chess-one/game-values";',
            'import { formatFen } from "@chess-one/chess-rules";',
            'import { Kysely } from "kysely";',
            'import { Migrator } from "kysely/migration";',
            'import pg from "pg";',
            'import { readFile } from "node:fs/promises";',
            'import { join } from "node:path";',
          ].join("\n"),
        ),
      ),
    ).toEqual([]);
    for (const code of [
      'import Fastify from "fastify";',
      'import { WebSocket } from "ws";',
      'import Redis from "ioredis";',
      'import { Kafka } from "kafkajs";',
      'import pino from "pino";',
      'import { createServer } from "node:http";',
      'import { exec } from "node:child_process";',
      'import { c } from "@chess-one/live-game/src/clock.ts";',
    ]) {
      expect(rulesFor(lp("a.ts", code)), code).toContain("forbidden_import");
    }
    for (const code of [
      "const url = process.env.DATABASE_URL;",
      "const t = Date.now();",
      "console.log(1);",
    ]) {
      expect(rulesFor(lp("a.ts", code)), code).toContain("ambient_access");
    }
    expect(
      rulesFor(lp("a.ts", 'import { s } from "../../live-game/src/persistence/state-codec.ts";')),
    ).toContain("relative_escape");
    const manifest = (dependencies: Record<string, string>): SourceFile => ({
      path: "server/live-game-persistence/package.json",
      content: JSON.stringify({ exports: { ".": "./src/index.ts" }, dependencies }),
    });
    expect(
      rulesFor(
        manifest({
          "@chess-one/game-values": "workspace:*",
          "@chess-one/live-game": "workspace:*",
          kysely: "0.29.6",
          pg: "8.23.0",
        }),
      ),
    ).toEqual([]);
    for (const name of ["prisma", "drizzle-orm", "typeorm", "redis", "kafkajs", "pino"]) {
      expect(rulesFor(manifest({ [name]: "1.0.0" })), name).toContain("forbidden_dependency");
    }
  });

  it("TST-BOUNDARY-027 clients never import persistence or database drivers", () => {
    const client = (content: string): SourceFile => ({ path: "clients/web/src/a.ts", content });
    for (const code of [
      'import { PostgresLiveGameRepository } from "@chess-one/live-game-persistence";',
      'import { Kysely } from "kysely";',
      'import { Migrator } from "kysely/migration";',
      'import pg from "pg";',
      'import { parse } from "pg-connection-string";',
    ]) {
      expect(rulesFor(client(code)), code).toContain("client_imports_persistence");
    }
    expect(rulesFor(client('import { x } from "@chess-one/game-values";'))).toEqual([]);
    expect(
      rulesFor({
        path: "clients/web/package.json",
        content: JSON.stringify({ dependencies: { pg: "8.23.0", kysely: "0.29.6" } }),
      }),
    ).toEqual(["client_imports_persistence", "client_imports_persistence"]);
  });
});

const rt = (name: string, content: string): SourceFile => ({
  path: `server/live-game-runtime/src/${name}`,
  content,
});
const edge = (name: string, content: string): SourceFile => ({
  path: `server/edge/src/${name}`,
  content,
});

describe("TST-BOUNDARY realtime layers", () => {
  it("TST-BOUNDARY-029 no transport stack below the edge: rules, values, core, persistence, and runtime", () => {
    const persistence = (name: string, content: string): SourceFile => ({
      path: `server/live-game-persistence/src/${name}`,
      content,
    });
    const layers = [gv, cr, lg, rt, persistence];
    for (const layer of layers) {
      for (const code of [
        'import Fastify from "fastify";',
        'import websocket from "@fastify/websocket";',
        'import { WebSocketServer } from "ws";',
        'import { createServer } from "node:http";',
        'import { Socket } from "node:net";',
        'import { createRealtimeEdge } from "@chess-one/edge";',
      ]) {
        const rules = rulesFor(layer("a.ts", code));
        expect(rules, `${layer("a.ts", "").path} ${code}`).toContain("transport_in_core");
        expect(rules).toContain("forbidden_import");
      }
    }
  });

  it("TST-BOUNDARY-030 the runtime sees only core packages; its clock and timers live in system.ts alone", () => {
    expect(rulesFor(rt("a.ts", 'import { executeCommand } from "@chess-one/live-game";'))).toEqual(
      [],
    );
    for (const code of [
      'import { PostgresLiveGameRepository } from "@chess-one/live-game-persistence";',
      'import { Kysely } from "kysely";',
      'import Redis from "ioredis";',
      'import { readFile } from "node:fs/promises";',
    ]) {
      expect(rulesFor(rt("a.ts", code)), code).toContain("forbidden_import");
    }
    for (const code of [
      "const t = process.hrtime.bigint();",
      "const id = crypto.randomUUID();",
      "setTimeout(() => undefined, 1);",
      "const t = Date.now();",
      "const t = performance.now();",
    ]) {
      expect(rulesFor(rt("writer-runtime.ts", code)), code).toContain("ambient_access");
    }
    expect(
      rulesFor(
        rt(
          "system.ts",
          "const t = process.hrtime.bigint(); const id = crypto.randomUUID(); clearTimeout(setTimeout(() => undefined, 1));",
        ),
      ),
    ).toEqual([]);
    for (const code of [
      "const t = Date.now();",
      "const e = process.env.X;",
      "const r = Math.random();",
    ]) {
      expect(rulesFor(rt("system.ts", code)), code).toContain("ambient_access");
    }
  });

  it("TST-BOUNDARY-031 the edge reaches the game only through the runtime and has no clock, environment, or randomness", () => {
    for (const code of [
      'import Fastify from "fastify";',
      'import { WebSocketServer } from "ws";',
      'import type { IncomingMessage } from "node:http";',
      'import type { Duplex } from "node:stream";',
      'import { GameWriterRegistry } from "@chess-one/live-game-runtime";',
    ]) {
      expect(rulesFor(edge("a.ts", code)), code).toEqual([]);
    }
    for (const code of [
      'import { processCommand } from "@chess-one/live-game";',
      'import { PostgresLiveGameRepository } from "@chess-one/live-game-persistence";',
      'import pg from "pg";',
      'import Redis from "ioredis";',
      'import { readFile } from "node:fs/promises";',
      'import websocket from "@fastify/websocket";',
    ]) {
      expect(rulesFor(edge("a.ts", code)), code).toContain("forbidden_import");
    }
    expect(rulesFor(edge("a.ts", "clearTimeout(setTimeout(() => undefined, 1));"))).toEqual([]);
    for (const code of [
      "const t = Date.now();",
      "const t = process.hrtime.bigint();",
      "const e = process.env.ORIGINS;",
      "const r = Math.random();",
      'console.log("x");',
    ]) {
      expect(rulesFor(edge("a.ts", code)), code).toContain("ambient_access");
    }
    const manifest = (dependencies: Record<string, string>): SourceFile => ({
      path: "server/edge/package.json",
      content: JSON.stringify({ exports: { ".": "./src/index.ts" }, dependencies }),
    });
    expect(
      rulesFor(
        manifest({
          "@chess-one/live-game-runtime": "workspace:*",
          fastify: "5.12.5",
          ws: "8.22.0",
        }),
      ),
    ).toEqual([]);
    for (const name of [
      "@chess-one/live-game",
      "@fastify/websocket",
      "socket.io",
      "ioredis",
      "pg",
    ]) {
      expect(rulesFor(manifest({ [name]: "1.0.0" })), name).not.toEqual([]);
    }
  });

  it("TST-BOUNDARY-032 clients talk to the server over the wire only: no server package, runtime, edge, or Fastify", () => {
    const client = (content: string): SourceFile => ({ path: "clients/web/src/a.ts", content });
    for (const code of [
      'import { processCommand } from "@chess-one/live-game";',
      'import { GameWriterRegistry } from "@chess-one/live-game-runtime";',
      'import { createRealtimeEdge } from "@chess-one/edge";',
      'import Fastify from "fastify";',
      'import { x } from "../../../server/edge/src/index.ts";',
    ]) {
      expect(rulesFor(client(code)), code).toContain("client_imports_server");
    }
    expect(
      rulesFor({
        path: "clients/web/package.json",
        content: JSON.stringify({ dependencies: { "@chess-one/edge": "workspace:*" } }),
      }),
    ).toContain("client_imports_server");
  });

  it("TST-BOUNDARY-034 no server code but the runtime and the store adapter reaches the core, so no game plays without an activated writer", () => {
    const server = (path: string, content: string): SourceFile => ({ path, content });
    const core = 'import { startGame, executeCommand } from "@chess-one/live-game";';
    for (const path of [
      "server/matchmaking/src/pairing.ts",
      "server/admin/src/start.ts",
      "server/edge/src/a.ts",
    ]) {
      expect(rulesFor(server(path, core)), path).toContain("writer_bypass");
    }
    for (const path of [
      "server/live-game-runtime/src/registry.ts",
      "server/live-game-persistence/src/repository.ts",
      "server/live-game/src/persistence/writer.ts",
    ]) {
      expect(rulesFor(server(path, core)), path).not.toContain("writer_bypass");
    }
    expect(
      rulesFor(
        server(
          "server/matchmaking/src/pairing.ts",
          'import { GameWriterRegistry } from "@chess-one/live-game-runtime";',
        ),
      ),
    ).toEqual([]);
  });
});
