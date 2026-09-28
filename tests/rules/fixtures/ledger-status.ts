/**
 * Batch 1 status of every row in CHESS_RULES_GOLDEN_TEST_LEDGER_V1.md.
 * IMPLEMENTED: the row's expected behaviour is asserted.
 * PARTIAL: part of the expected behaviour is asserted; `pending` says what is not.
 * NOT_IMPLEMENTED: no behaviour is asserted. `fixtureValidated` means its FEN or
 * history is checked for integrity, which is not the row's behaviour.
 */
export type LedgerStatus =
  | { readonly status: "IMPLEMENTED" }
  | { readonly status: "PARTIAL"; readonly pending: string }
  | { readonly status: "NOT_IMPLEMENTED"; readonly fixtureValidated: boolean };

const notImplemented = (fixtureValidated = false): LedgerStatus => ({
  status: "NOT_IMPLEMENTED",
  fixtureValidated,
});

const DRAW_RESULT_PENDING = "draw `dead_position` needs GameResult, which is not in Batch 1";

export const LEDGER_STATUS: Readonly<Record<string, LedgerStatus>> = {
  "TST-RULE-E01-001": notImplemented(true),
  "TST-RULE-E01-002": notImplemented(true),
  "TST-RULE-E01-003": notImplemented(true),
  "TST-RULE-E01-004": notImplemented(true),
  "TST-RULE-E01-005": notImplemented(true),
  "TST-RULE-E01-006": notImplemented(true),
  "TST-RULE-E01-007": notImplemented(true),
  "TST-RULE-E01-008a": notImplemented(true),
  "TST-RULE-E01-008b": notImplemented(true),
  "TST-RULE-E01-009": notImplemented(true),
  "TST-RULE-E01-010": notImplemented(true),
  "TST-RULE-E01-011a": notImplemented(true),
  "TST-RULE-E01-011b": notImplemented(true),
  "TST-RULE-E01-011c": notImplemented(true),
  "TST-RULE-E01-011d": notImplemented(true),
  "TST-RULE-E01-012": notImplemented(true),
  "TST-RULE-E01-013": notImplemented(true),
  "TST-RULE-E01-014a": { status: "PARTIAL", pending: DRAW_RESULT_PENDING },
  "TST-RULE-E01-014b": { status: "PARTIAL", pending: DRAW_RESULT_PENDING },
  "TST-RULE-E01-014c": { status: "PARTIAL", pending: DRAW_RESULT_PENDING },
  "TST-RULE-E01-014d": { status: "IMPLEMENTED" },
  "TST-RULE-E01-015a": notImplemented(true),
  "TST-RULE-E01-015b": notImplemented(),
  "TST-RULE-E01-015c": notImplemented(),
  "TST-RULE-E01-016a": notImplemented(),
  "TST-RULE-E01-016b": notImplemented(true),
  "TST-RULE-E01-016c": notImplemented(),
  "TST-RULE-E01-016d": notImplemented(),
  "TST-RULE-E01-016e": notImplemented(),
  "TST-RULE-E01-017a": notImplemented(),
  "TST-RULE-E01-017b": notImplemented(),
  "TST-RULE-E01-017c": notImplemented(),
  "TST-RULE-E01-018": notImplemented(),
  "TST-RULE-E01-018b": notImplemented(true),
  "TST-RULE-E01-019": notImplemented(),
  "TST-RULE-E01-020": notImplemented(),
  "TST-RULE-E01-020b": notImplemented(true),
  "TST-RULE-E01-020c": notImplemented(true),
  "TST-RULE-E01-021a": notImplemented(),
  "TST-RULE-E01-021b": notImplemented(true),
  "TST-RULE-E01-022a": notImplemented(),
  "TST-RULE-E01-022b": notImplemented(),
  "TST-RULE-E01-022c": notImplemented(),
  "TST-RULE-E01-023a": notImplemented(),
  "TST-RULE-E01-023b": notImplemented(),
  "TST-RULE-E01-024": notImplemented(),
  "TST-RULE-E01-025": notImplemented(),
  "TST-RULE-E01-026": notImplemented(),
  "TST-RULE-E01-027": notImplemented(),
  "TST-RULE-E01-028": notImplemented(),
};
