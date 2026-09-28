/**
 * Status of every row in CHESS_RULES_GOLDEN_TEST_LEDGER_V1.md after Batch 4.
 * IMPLEMENTED: the row's expected behaviour is asserted.
 * PARTIAL: part of the expected behaviour is asserted; `pending` says what is not.
 * NOT_IMPLEMENTED: no behaviour is asserted. `fixtureValidated` means its FEN or
 * history is checked for integrity, which is not the row's behaviour.
 *
 * The ledger's IllegalMove and InvalidState are asserted as the pure-domain
 * errors `illegal_move`, `promotion_required`, and `promotion_unexpected`;
 * mapping them to contract errors is a later layer. Likewise "Terminal
 * `white_win`, `checkmate`" and "Terminal draw, `stalemate`" are asserted as the
 * pure rule fact from `evaluateMoveExhaustion`; a durable GameResult is later
 * platform work. "Draw `threefold_claim`" and "Draw `fifty_move_claim`" are
 * asserted as a correct `evaluateDrawClaim` assessment, and "Automatic draw
 * `fivefold`" and "Draw `seventy_five_move`" as `evaluateAutomaticDraws` facts.
 * Changing a clock or applying a move is Live Game work, so rows that expect it
 * stay PARTIAL. "Server SAN" is asserted as `toCanonicalSan` output. Every
 * IMPLEMENTED or PARTIAL row must be named by an executable test
 * (ledger-status.test.ts).
 */
export type LedgerStatus =
  | { readonly status: "IMPLEMENTED" }
  | { readonly status: "PARTIAL"; readonly pending: string }
  | { readonly status: "NOT_IMPLEMENTED"; readonly fixtureValidated: boolean };

const notImplemented = (fixtureValidated = false): LedgerStatus => ({
  status: "NOT_IMPLEMENTED",
  fixtureValidated,
});

const DRAW_RESULT_PENDING = "draw `dead_position` needs GameResult, which is not implemented";
const LIVE_CLOCK = "adding the time to the opponent's clock";
const implemented: LedgerStatus = { status: "IMPLEMENTED" };
const partial = (pending: string): LedgerStatus => ({ status: "PARTIAL", pending });

export const LEDGER_STATUS: Readonly<Record<string, LedgerStatus>> = {
  "TST-RULE-E01-001": partial("game sequence +1 is game-layer command semantics"),
  "TST-RULE-E01-002": implemented,
  "TST-RULE-E01-003": implemented,
  "TST-RULE-E01-004": implemented,
  "TST-RULE-E01-005": implemented,
  "TST-RULE-E01-006": implemented,
  "TST-RULE-E01-007": implemented,
  "TST-RULE-E01-008a": implemented,
  "TST-RULE-E01-008b": implemented,
  "TST-RULE-E01-009": implemented,
  "TST-RULE-E01-010": implemented,
  "TST-RULE-E01-011a": implemented,
  "TST-RULE-E01-011b": implemented,
  "TST-RULE-E01-011c": implemented,
  "TST-RULE-E01-011d": implemented,
  "TST-RULE-E01-012": implemented,
  "TST-RULE-E01-013": implemented,
  "TST-RULE-E01-014a": partial(DRAW_RESULT_PENDING),
  "TST-RULE-E01-014b": partial(DRAW_RESULT_PENDING),
  "TST-RULE-E01-014c": partial(DRAW_RESULT_PENDING),
  "TST-RULE-E01-014d": implemented,
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
  "TST-RULE-E01-018": implemented,
  "TST-RULE-E01-018b": implemented,
  "TST-RULE-E01-019": implemented,
  "TST-RULE-E01-020": implemented,
  "TST-RULE-E01-020b": implemented,
  "TST-RULE-E01-020c": partial(
    `the incorrect verdict, 120000 ms rule fact, and must_apply consequence are asserted; ${LIVE_CLOCK} and applying a7a6 are Live Game work`,
  ),
  "TST-RULE-E01-021a": implemented,
  "TST-RULE-E01-021b": implemented,
  "TST-RULE-E01-022a": partial(
    `the incorrect verdict and 120000 ms rule fact are asserted; ${LIVE_CLOCK} is Live Game work`,
  ),
  "TST-RULE-E01-022b": partial(
    `the incorrect verdict, 120000 ms rule fact, and must_apply consequence are asserted; ${LIVE_CLOCK} and applying e2e4 are Live Game work`,
  ),
  "TST-RULE-E01-022c": partial(
    `the incorrect verdict, 120000 ms rule fact, and illegal (not applied) disposition are asserted; ${LIVE_CLOCK} is Live Game work`,
  ),
  "TST-RULE-E01-023a": implemented,
  "TST-RULE-E01-023b": implemented,
  "TST-RULE-E01-024": notImplemented(),
  "TST-RULE-E01-025": notImplemented(),
  "TST-RULE-E01-026": notImplemented(),
  "TST-RULE-E01-027": notImplemented(),
  "TST-RULE-E01-028": notImplemented(),
};
