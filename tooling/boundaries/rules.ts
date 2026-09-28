import { analyzeSources, type SourceFacts } from "./syntax.ts";

export interface SourceFile {
  /** Repository-relative path with forward slashes. */
  readonly path: string;
  readonly content: string;
}

export interface Violation {
  readonly rule: string;
  readonly path: string;
  readonly line: number;
  readonly detail: string;
}

interface PackageManifest {
  readonly dependencyNames: readonly string[];
  readonly exportKeys: readonly string[];
}

interface DomainPolicy {
  readonly srcRoot: string;
  readonly allowedPackages: readonly string[];
  readonly allowedDependencies: readonly string[];
}

/**
 * Source roots with a closed import set and the ambient-access ban. The
 * persistence adapter is included: it gets its pool and file paths from the
 * host, so it needs no environment, clock, or global I/O either.
 */
const DOMAIN_POLICIES: readonly DomainPolicy[] = [
  { srcRoot: "domain/game-values/src/", allowedPackages: [], allowedDependencies: [] },
  {
    srcRoot: "domain/chess-rules/src/",
    allowedPackages: ["@chess-one/game-values"],
    allowedDependencies: ["@chess-one/game-values"],
  },
  {
    srcRoot: "server/live-game/src/",
    allowedPackages: ["@chess-one/game-values", "@chess-one/chess-rules"],
    allowedDependencies: ["@chess-one/game-values", "@chess-one/chess-rules"],
  },
  {
    srcRoot: "server/live-game-persistence/src/",
    allowedPackages: [
      "@chess-one/game-values",
      "@chess-one/chess-rules",
      "@chess-one/live-game",
      "kysely",
      "kysely/migration",
      "pg",
      "node:fs/promises",
      "node:path",
    ],
    allowedDependencies: [
      "@chess-one/game-values",
      "@chess-one/chess-rules",
      "@chess-one/live-game",
      "kysely",
      "pg",
    ],
  },
];

/** Database access stays on the server: clients never reach the store or its drivers. */
const CLIENT_FORBIDDEN_PACKAGES = ["kysely", "pg", "pg-", "@chess-one/live-game-persistence"];

const PRODUCTION_ROOTS = ["domain/", "contracts/", "server/", "clients/"];

const TEST_ONLY_PACKAGES = [
  "vitest",
  "fast-check",
  "@vitest/",
  "@biomejs/biome",
  "typescript",
  "@types/",
  "@chess-one/tests-",
];

const LICENSE_GATED_PACKAGES = [
  "chess.js",
  "chessops",
  "stockfish",
  "stockfish.js",
  "stockfish.wasm",
  "python-chess",
];

/**
 * Globals that give domain code I/O, time, environment, or module loading. Any
 * reference is rejected, so aliases and computed members are covered too.
 */
const AMBIENT_GLOBALS = new Set([
  "require",
  "module",
  "exports",
  "process",
  "globalThis",
  "global",
  "window",
  "self",
  "Date",
  "performance",
  "fetch",
  "setTimeout",
  "setInterval",
  "setImmediate",
  "queueMicrotask",
  "crypto",
  "Buffer",
  "console",
]);

/** Code evaluation; `.constructor` reaches the Function constructor from any function. */
const DYNAMIC_CODE_GLOBALS = new Set(["eval", "Function"]);
const DYNAMIC_CODE_MEMBERS = new Set(["constructor"]);

/** `Math` is pure except `random`; only direct `Math.<name>` reads are allowed. */
function isImpureMath(member: string | undefined): boolean {
  return member === undefined || member === "random";
}

export const SOURCE_EXTENSIONS = [".ts", ".mts", ".cts", ".tsx", ".js", ".mjs", ".cjs", ".jsx"];

function isSource(path: string): boolean {
  return SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension));
}

function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function resolveRelative(fromPath: string, specifier: string): string {
  const dir = fromPath.slice(0, fromPath.lastIndexOf("/") + 1);
  return normalize(dir + specifier);
}

function isRelative(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

function packageRoot(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
}

/** Entries ending in "/" or "-" are prefixes; others match the package name exactly. */
function matchesPackageList(name: string, list: readonly string[]): boolean {
  return list.some((entry) =>
    entry.endsWith("/") || entry.endsWith("-") ? name.startsWith(entry) : name === entry,
  );
}

function domainPolicyFor(path: string): DomainPolicy | undefined {
  return DOMAIN_POLICIES.find((policy) => path.startsWith(policy.srcRoot));
}

function checkDomainCode(file: SourceFile, scan: SourceFacts, violations: Violation[]): void {
  const add = (rule: string, line: number, detail: string): void => {
    violations.push({ rule, path: file.path, line, detail });
  };
  for (const { name, line, member } of scan.identifiers) {
    if (AMBIENT_GLOBALS.has(name) || (name === "Math" && isImpureMath(member))) {
      add("ambient_access", line, `${name} is not allowed in domain code`);
    } else if (DYNAMIC_CODE_GLOBALS.has(name)) {
      add("dynamic_code", line, `${name} evaluates code`);
    }
  }
  for (const { specifier, line } of scan.memberNames) {
    if (DYNAMIC_CODE_MEMBERS.has(specifier)) {
      add("dynamic_code", line, `.${specifier} can reach the Function constructor`);
    }
  }
  for (const line of scan.importMetaLines) {
    add("ambient_access", line, "import.meta is not allowed in domain code");
  }
}

function checkImports(file: SourceFile, scan: SourceFacts, violations: Violation[]): void {
  const policy = domainPolicyFor(file.path);
  const isProduction = PRODUCTION_ROOTS.some((root) => file.path.startsWith(root));
  const isContract = file.path.startsWith("contracts/");
  const add = (rule: string, line: number, detail: string): void => {
    violations.push({ rule, path: file.path, line, detail });
  };

  if (policy !== undefined && !file.path.endsWith(".ts")) {
    add("unexpected_source_type", 1, "domain source files must be .ts");
  }

  if (isProduction) {
    for (const line of scan.nonLiteralDynamicImports) {
      add("non_literal_dynamic_import", line, "dynamic import target is not a literal");
    }
  }

  for (const { specifier, line } of scan.imports) {
    if (isRelative(specifier)) {
      const target = resolveRelative(file.path, specifier);
      const ownSrc = policy?.srcRoot;
      if (ownSrc !== undefined && !target.startsWith(ownSrc)) {
        add("relative_escape", line, `${specifier} leaves ${ownSrc}`);
      } else if (ownSrc === undefined && /^(?:domain|server)\/[^/]+\/src\//.test(target)) {
        add(
          "deep_import_bypass",
          line,
          `${specifier} reaches into ${target}; use the package name`,
        );
      }
      if (isProduction && target.startsWith("tests/")) {
        add("test_dependency_in_production", line, `${specifier} imports test code`);
      }
      if (isContract && (target.startsWith("server/") || target.startsWith("clients/"))) {
        add("contract_imports_runtime", line, `${specifier} imports server or client code`);
      }
      continue;
    }

    const root = packageRoot(specifier);
    if (root.startsWith("@chess-one/") && specifier !== root) {
      add("deep_import_bypass", line, `${specifier} bypasses the public entry of ${root}`);
    }
    if (isProduction && matchesPackageList(root, TEST_ONLY_PACKAGES)) {
      add("test_dependency_in_production", line, `${specifier} is a test or build tool`);
    }
    if (matchesPackageList(root, LICENSE_GATED_PACKAGES)) {
      add("license_gated_package", line, `${specifier} needs the license gate first`);
    }
    if (isContract && /^@chess-one\/(?:server|client|web)/.test(root)) {
      add("contract_imports_runtime", line, `${specifier} imports server or client code`);
    }
    if (file.path.startsWith("clients/") && matchesPackageList(root, CLIENT_FORBIDDEN_PACKAGES)) {
      add("client_imports_persistence", line, `${specifier} is server-side persistence`);
    }
    if (policy !== undefined && !policy.allowedPackages.includes(specifier)) {
      add(
        "forbidden_import",
        line,
        `${specifier} is outside the allowed set for ${policy.srcRoot}`,
      );
    }
  }

  if (policy !== undefined) checkDomainCode(file, scan, violations);
}

function objectKeys(value: unknown): string[] {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.keys(value)
    : [];
}

function parseManifest(file: SourceFile, violations: Violation[]): PackageManifest | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(file.content);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    violations.push({ rule: "manifest_invalid", path: file.path, line: 1, detail });
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    violations.push({
      rule: "manifest_invalid",
      path: file.path,
      line: 1,
      detail: "not an object",
    });
    return undefined;
  }
  const entries: [string, unknown][] = Object.entries(parsed);
  const fields = new Map(entries);
  return {
    dependencyNames: objectKeys(fields.get("dependencies")),
    exportKeys: objectKeys(fields.get("exports")),
  };
}

function checkManifest(file: SourceFile, violations: Violation[]): void {
  const manifest = parseManifest(file, violations);
  if (manifest === undefined) return;
  const add = (rule: string, detail: string): void => {
    violations.push({ rule, path: file.path, line: 1, detail });
  };
  const dependencies = manifest.dependencyNames;
  const isProduction = PRODUCTION_ROOTS.some((root) => file.path.startsWith(root));
  const isRoot = file.path === "package.json";

  for (const name of dependencies) {
    if ((isProduction || isRoot) && matchesPackageList(name, TEST_ONLY_PACKAGES)) {
      add("test_dependency_in_production", `${name} is listed in dependencies`);
    }
    if (matchesPackageList(name, LICENSE_GATED_PACKAGES)) {
      add("license_gated_package", `${name} needs the license gate first`);
    }
    if (file.path.startsWith("clients/") && matchesPackageList(name, CLIENT_FORBIDDEN_PACKAGES)) {
      add("client_imports_persistence", `${name} is server-side persistence`);
    }
  }

  const domainDir = file.path.slice(0, -"package.json".length);
  const policy = DOMAIN_POLICIES.find((candidate) => candidate.srcRoot === `${domainDir}src/`);
  if (policy === undefined) return;
  for (const name of dependencies) {
    if (!policy.allowedDependencies.includes(name)) {
      add("forbidden_dependency", `${name} is not an allowed dependency of ${domainDir}`);
    }
  }
  const { exportKeys } = manifest;
  if (exportKeys.length !== 1 || exportKeys[0] !== ".") {
    add("public_entry", `${domainDir} must expose exactly one public entry "."`);
  }
}

function checkCycles(facts: ReadonlyMap<string, SourceFacts>, violations: Violation[]): void {
  const graph = new Map<string, string[]>();
  for (const [path, scan] of facts) {
    if (domainPolicyFor(path) === undefined) continue;
    const edges = scan.imports
      .filter(({ specifier }) => isRelative(specifier))
      .map(({ specifier }) => resolveRelative(path, specifier));
    graph.set(path, edges);
  }
  const state = new Map<string, "visiting" | "done">();
  const visit = (node: string, trail: readonly string[]): void => {
    if (state.get(node) === "done") return;
    if (state.get(node) === "visiting") {
      const cycle = [...trail.slice(trail.indexOf(node)), node].join(" -> ");
      violations.push({ rule: "import_cycle", path: node, line: 1, detail: cycle });
      return;
    }
    state.set(node, "visiting");
    for (const next of graph.get(node) ?? []) if (graph.has(next)) visit(next, [...trail, node]);
    state.set(node, "done");
  };
  for (const node of graph.keys()) visit(node, []);
}

export function findBoundaryViolations(files: readonly SourceFile[]): readonly Violation[] {
  const violations: Violation[] = [];
  const sources = files.filter((file) => isSource(file.path));
  const facts = analyzeSources(sources);
  for (const file of files) {
    if (file.path.endsWith("package.json")) checkManifest(file, violations);
  }
  for (const file of sources) {
    const scan = facts.get(file.path);
    if (scan !== undefined) checkImports(file, scan, violations);
  }
  checkCycles(facts, violations);
  return violations;
}
