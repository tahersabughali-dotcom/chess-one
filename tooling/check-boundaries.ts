import { type Dirent, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { findBoundaryViolations, SOURCE_EXTENSIONS, type SourceFile } from "./boundaries/rules.ts";

const SCANNED_ROOTS = ["domain", "contracts", "server", "clients", "tests", "tooling"];
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "coverage"]);

function collect(repoRoot: string, directory: string, files: SourceFile[]): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(directory, { withFileTypes: true, encoding: "utf8" });
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) collect(repoRoot, fullPath, files);
    } else if (
      SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension)) ||
      entry.name === "package.json"
    ) {
      const path = relative(repoRoot, fullPath).split(sep).join("/");
      files.push({ path, content: readFileSync(fullPath, "utf8") });
    }
  }
}

export function collectRepositoryFiles(repoRoot: string): SourceFile[] {
  const files: SourceFile[] = [
    { path: "package.json", content: readFileSync(join(repoRoot, "package.json"), "utf8") },
  ];
  for (const root of SCANNED_ROOTS) collect(repoRoot, join(repoRoot, root), files);
  return files;
}

if (import.meta.main) {
  const repoRoot = fileURLToPath(new URL("..", import.meta.url));
  const files = collectRepositoryFiles(repoRoot);
  const violations = findBoundaryViolations(files);
  for (const violation of violations) {
    process.stderr.write(
      `${violation.rule}: ${violation.path}:${violation.line} ${violation.detail}\n`,
    );
  }
  if (violations.length > 0) {
    process.stderr.write(`check:boundaries FAILED with ${violations.length} violation(s)\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`check:boundaries PASS (${files.length} files scanned)\n`);
  }
}
