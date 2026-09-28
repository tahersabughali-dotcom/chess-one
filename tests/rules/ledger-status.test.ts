import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { H50_TEXT, splitPlies } from "./fixtures/claim-histories.ts";
import { GOLDEN_POSITIONS } from "./fixtures/golden-positions.ts";
import { LEDGER_STATUS } from "./fixtures/ledger-status.ts";

const LEDGER = readFileSync(
  fileURLToPath(new URL("../../CHESS_RULES_GOLDEN_TEST_LEDGER_V1.md", import.meta.url)),
  "utf8",
);

const LEDGER_IDS = [...LEDGER.matchAll(/^\| (TST-RULE-E01-\d{3}[a-z]?) \|/gm)].map(
  (match) => match[1],
);

describe("Golden ledger coverage", () => {
  it("every ledger row has exactly one Batch 1 status, and no status is invented", () => {
    expect(new Set(LEDGER_IDS).size).toBe(LEDGER_IDS.length);
    expect([...LEDGER_IDS].sort()).toEqual(Object.keys(LEDGER_STATUS).sort());
  });

  it("every FEN written in the ledger is a typed fixture", () => {
    const ledgerFens = new Set(
      [
        ...LEDGER.matchAll(
          /`([pnbrqkPNBRQK1-8]+(?:\/[pnbrqkPNBRQK1-8]+){7} [wb] [KQkq-]+ [a-h1-8-]+ \d+ \d+)`/g,
        ),
      ]
        .map((match) => match[1])
        .filter((fen) => !fen?.startsWith("5r2/") && !fen?.includes("/3NN3/")),
    );
    expect(new Set(GOLDEN_POSITIONS.map((position) => position.fen))).toEqual(ledgerFens);
  });

  it("history H50 in the ledger matches the fixture", () => {
    const block = /\*\*History H50[^`]*```text\r?\n([\s\S]*?)```/.exec(LEDGER);
    expect(block).not.toBeNull();
    expect(splitPlies(block?.[1] ?? "")).toEqual(splitPlies(H50_TEXT));
  });

  it("every IMPLEMENTED or PARTIAL row is named by an executable test", () => {
    const testDirs = ["./", "../live-game/"].map((dir) =>
      fileURLToPath(new URL(dir, import.meta.url)),
    );
    const titles = testDirs
      .flatMap((dir) =>
        readdirSync(dir)
          .filter((name) => name.endsWith(".test.ts") && name !== "ledger-status.test.ts")
          .map((name) => `${dir}${name}`),
      )
      .flatMap((path) => [
        ...readFileSync(path, "utf8").matchAll(/\bit(?:\.each\([^)]*\))?\(\s*"([^"]+)"/g),
      ])
      .map((match) => match[1] ?? "");
    const namedIds = new Set(titles.flatMap((title) => title.split(/[^\w-]+/)));
    for (const [id, entry] of Object.entries(LEDGER_STATUS)) {
      if (entry.status !== "NOT_IMPLEMENTED") expect(namedIds.has(id), id).toBe(true);
    }
  });

  describe("NOT_IMPLEMENTED ledger rows (reported as todo, never as passing)", () => {
    for (const [id, entry] of Object.entries(LEDGER_STATUS)) {
      if (entry.status === "NOT_IMPLEMENTED") {
        it.todo(`${id}${entry.fixtureValidated ? " (fixture validated only)" : ""}`);
      }
    }
  });
});
