/**
 * Server-owned move histories for the intended-claim rows in the golden ledger.
 * Both start from the initial position of the default ruleset.
 */
export interface ClaimHistory {
  readonly id: string;
  readonly claim: "threefold_intended" | "fifty_move_intended";
  readonly plies: readonly string[];
  readonly intended: string;
}

export const THREEFOLD_INTENDED: ClaimHistory = {
  id: "TST-RULE-E01-018b",
  claim: "threefold_intended",
  plies: ["g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1"],
  intended: "f6g8",
};

/** History H50 in the ledger: 99 knight moves, no pawn move, no capture, no repeated position. */
export const H50_TEXT = `
b1c3 b8c6 c3d5 c6b8 d5e3 b8c6 e3f5 c6b8 f5g3 b8c6 g1h3 c6b8 g3h5 b8c6 h3g5 c6b8 g5f3 b8c6
f3h4 c6b8 h4f5 b8c6 f5g3 c6b8 g3e4 b8c6 e4c5 c6b8 c5d3 b8c6 d3e5 c6b8 e5g4 b8c6 g4e3 c6b8
e3d5 b8c6 d5f4 c6b8 h5g3 b8c6 f4d5 c6b8 d5e3 b8c6 e3f5 c6b8 f5h4 b8c6 g3f5 c6b8 f5e3 b8c6
e3g4 c6b8 g4e5 b8c6 e5f3 c6b8 f3g5 b8c6 g5h3 c6b8 h3f4 b8c6 f4d5 c6b8 d5c3 b8c6 c3e4 c6b8
e4c5 b8c6 c5d3 c6b8 d3b4 b8c6 h4f5 c6b8 b4d5 b8c6 d5e3 c6b8 e3g4 b8c6 f5g3 c6b8 g3e4 b8c6
e4g5 c6b8 g4e5 b8c6 e5f3 c6b8 f3d4 b8c6 d4f5
`;

export function splitPlies(text: string): readonly string[] {
  return text.split(/\s+/).filter((ply) => ply !== "");
}

export const FIFTY_MOVE_INTENDED: ClaimHistory = {
  id: "TST-RULE-E01-020b",
  claim: "fifty_move_intended",
  plies: splitPlies(H50_TEXT),
  intended: "g8f6",
};

/** TST-RULE-E01-020c: an incorrect fifty-move claim whose intended move is a pawn move. */
export const FIFTY_MOVE_INCORRECT_INTENDED = "a7a6";
