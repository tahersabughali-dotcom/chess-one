/** Every FEN that appears in CHESS_RULES_GOLDEN_TEST_LEDGER_V1.md, keyed by the first row that uses it. */
export interface GoldenPosition {
  readonly id: string;
  readonly articles: string;
  readonly fen: string;
  readonly alsoUsedBy: readonly string[];
}

export const GOLDEN_POSITIONS: readonly GoldenPosition[] = [
  {
    id: "TST-RULE-E01-001",
    articles: "2, 3",
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    alsoUsedBy: ["TST-RULE-E01-002", "TST-RULE-E01-003", "TST-RULE-E01-011d"],
  },
  {
    id: "TST-RULE-E01-004",
    articles: "3.9.2",
    fen: "4k3/4n3/8/8/8/8/8/4R1K1 b - - 0 1",
    alsoUsedBy: [],
  },
  {
    id: "TST-RULE-E01-005",
    articles: "3.9",
    fen: "4k3/8/8/8/4B3/8/8/4R1K1 w - - 0 1",
    alsoUsedBy: [],
  },
  {
    id: "TST-RULE-E01-006",
    articles: "3.8, 3.9",
    fen: "8/8/4k3/8/4K3/8/8/8 w - - 0 1",
    alsoUsedBy: [],
  },
  {
    id: "TST-RULE-E01-007",
    articles: "3.8.2",
    fen: "r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1",
    alsoUsedBy: [],
  },
  {
    id: "TST-RULE-E01-008a",
    articles: "3.8.2.2",
    fen: "1k3r2/8/8/8/8/8/8/R3K2R w KQ - 0 1",
    alsoUsedBy: ["TST-RULE-E01-008b"],
  },
  {
    id: "TST-RULE-E01-009",
    articles: "3.7.3.1",
    fen: "4k3/8/8/3pP3/8/8/8/6K1 w - d6 0 1",
    alsoUsedBy: [],
  },
  {
    id: "TST-RULE-E01-010",
    articles: "3.9.2",
    fen: "8/8/8/r2pP2K/8/8/8/4k3 w - d6 0 1",
    alsoUsedBy: [],
  },
  {
    id: "TST-RULE-E01-011a",
    articles: "3.7.3.3",
    fen: "8/P7/8/8/8/8/8/k1K5 w - - 0 1",
    alsoUsedBy: ["TST-RULE-E01-011b", "TST-RULE-E01-011c"],
  },
  {
    id: "TST-RULE-E01-012",
    articles: "5.1.1",
    fen: "k7/1QK5/8/8/8/8/8/8 b - - 0 1",
    alsoUsedBy: [],
  },
  {
    id: "TST-RULE-E01-013",
    articles: "5.2.1",
    fen: "k7/2K5/1Q6/8/8/8/8/8 b - - 0 1",
    alsoUsedBy: [],
  },
  {
    id: "TST-RULE-E01-014a",
    articles: "5.2.2",
    fen: "8/8/8/8/4k3/8/8/4K3 w - - 0 1",
    alsoUsedBy: ["TST-RULE-E01-015a", "TST-RULE-E01-016b"],
  },
  {
    id: "TST-RULE-E01-014b",
    articles: "5.2.2",
    fen: "8/8/8/8/4k3/8/4B3/4K3 w - - 0 1",
    alsoUsedBy: [],
  },
  {
    id: "TST-RULE-E01-014c",
    articles: "5.2.2",
    fen: "8/8/8/8/4k3/8/4N3/4K3 w - - 0 1",
    alsoUsedBy: [],
  },
  {
    id: "TST-RULE-E01-014d",
    articles: "5.2.2",
    fen: "8/8/8/8/4k3/8/2N1N3/4K3 w - - 0 1",
    alsoUsedBy: [],
  },
  {
    id: "TST-RULE-E01-021b",
    articles: "9.6.2, 5.1.1",
    fen: "k7/2K5/8/8/8/8/1Q6/8 w - - 149 80",
    alsoUsedBy: [],
  },
];

export function goldenFen(id: string): string {
  const found = GOLDEN_POSITIONS.find((position) => position.id === id);
  if (found === undefined) throw new Error(`No golden position ${id}`);
  return found.fen;
}
