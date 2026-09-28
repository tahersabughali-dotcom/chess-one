/**
 * Status of every row in CHESS_RULES_GOLDEN_TEST_LEDGER_V1.md after Batch 5.
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
 * "Server SAN" is asserted as `toCanonicalSan` output.
 *
 * Batch 5 adds the in-memory live-game authority (tests/live-game): sequence,
 * command identity, clock changes, applied moves, GameResult, and flags are
 * asserted there through `processCommand`. Rows 014a-c are asserted by a live
 * king capture that reaches the ledger's exact piece placement (fullmove 2
 * instead of 1), because a live game refuses to start in a finished position.
 *
 * Batch 6 adds `assessMatingCapability` and adjudicates flags and
 * resignations by the opponent's one-sided capability (LIVE-CONTRACT-001
 * resolved). Rows 015b and 016a name a whole-position `NOT_DEAD` proof as
 * their precondition; that criterion is superseded, and they are asserted
 * with the corrected one, the opponent's PROVEN_CAN_MATE (the whole-position
 * detector never returns `NOT_DEAD`). Row 015a's `InvalidState` is
 * superseded by `GameAlreadyFinished` (LIVE-CONTRACT-006, resolved in Batch
 * 6.1).
 *
 * Batch 7 adds the draw-offer state machine: rows 017a to 017c are asserted
 * through `OfferDrawCommand.v1`, `RespondDrawOfferCommand.v1`, and a
 * recipient's `SubmitMoveCommand.v1` in tests/live-game/draw-offer.test.ts.
 * Every IMPLEMENTED or PARTIAL row must be named by an executable test
 * (ledger-status.test.ts).
 */
export type LedgerStatus =
  | { readonly status: "IMPLEMENTED" }
  | { readonly status: "PARTIAL"; readonly pending: string }
  | { readonly status: "NOT_IMPLEMENTED"; readonly fixtureValidated: boolean };

const implemented: LedgerStatus = { status: "IMPLEMENTED" };

export const LEDGER_STATUS: Readonly<Record<string, LedgerStatus>> = {
  "TST-RULE-E01-001": implemented,
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
  "TST-RULE-E01-014a": implemented,
  "TST-RULE-E01-014b": implemented,
  "TST-RULE-E01-014c": implemented,
  "TST-RULE-E01-014d": implemented,
  "TST-RULE-E01-015a": implemented,
  "TST-RULE-E01-015b": implemented,
  "TST-RULE-E01-015c": implemented,
  "TST-RULE-E01-016a": implemented,
  "TST-RULE-E01-016b": implemented,
  "TST-RULE-E01-016c": implemented,
  "TST-RULE-E01-016d": implemented,
  "TST-RULE-E01-016e": implemented,
  "TST-RULE-E01-017a": implemented,
  "TST-RULE-E01-017b": implemented,
  "TST-RULE-E01-017c": implemented,
  "TST-RULE-E01-018": implemented,
  "TST-RULE-E01-018b": implemented,
  "TST-RULE-E01-019": implemented,
  "TST-RULE-E01-020": implemented,
  "TST-RULE-E01-020b": implemented,
  "TST-RULE-E01-020c": implemented,
  "TST-RULE-E01-021a": implemented,
  "TST-RULE-E01-021b": implemented,
  "TST-RULE-E01-022a": implemented,
  "TST-RULE-E01-022b": implemented,
  "TST-RULE-E01-022c": implemented,
  "TST-RULE-E01-023a": implemented,
  "TST-RULE-E01-023b": implemented,
  "TST-RULE-E01-024": implemented,
  "TST-RULE-E01-025": implemented,
  "TST-RULE-E01-026": implemented,
  "TST-RULE-E01-027": implemented,
  "TST-RULE-E01-028": implemented,
};
