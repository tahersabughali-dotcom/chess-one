import {
  createInitialPosition,
  evaluateDrawClaim,
  generateLegalMoves,
  type Position,
  pieceAt,
  repetitionCount,
  repetitionKey,
  samePositionForRepetition,
} from "@chess-one/chess-rules";
import type { Square } from "@chess-one/game-values";
import { describe, expect, it } from "vitest";
import { goldenFen } from "./fixtures/golden-positions.ts";
import { positionOf } from "./support/positions.ts";
import { ruleHistory } from "./support/rule-history.ts";

const INITIAL = createInitialPosition();
const CYCLE = ["g1f3", "g8f6", "f3g1", "f6g8"];

function keyText(position: Position): string {
  return repetitionKey(position).text;
}

/** Same FEN with the en passant field removed. */
function withoutTarget(fen: string): Position {
  const fields = fen.split(" ");
  fields[3] = "-";
  return positionOf(fields.join(" "));
}

describe("TST-FOUND-REP repetition identity (Article 9.2.3)", () => {
  it("TST-FOUND-REP-001 the key text is delimited: 64 cells, side, KQkq slots, effective en passant", () => {
    expect(keyText(INITIAL)).toBe(`RNBQKBNRPPPPPPPP${".".repeat(32)}pppppppprnbqkbnr w KQkq -`);
    expect(keyText(positionOf("4k3/8/8/8/8/8/8/4K2R b K - 0 1"))).toBe(
      `....K..R${".".repeat(48)}....k... b K--- -`,
    );
  });

  it("TST-FOUND-REP-002 halfmove clock and fullmove number are not part of the identity", () => {
    const a = positionOf("4k3/8/8/8/8/8/8/R3K3 w Q - 0 1");
    const b = positionOf("4k3/8/8/8/8/8/8/R3K3 w Q - 57 90");
    expect(samePositionForRepetition(a, b)).toBe(true);
    expect(keyText(a)).toBe(keyText(b));
  });

  it("TST-FOUND-REP-003 side to move and piece placement are part of the identity", () => {
    const base = positionOf("4k3/8/8/8/8/8/8/R3K3 w - - 0 1");
    expect(samePositionForRepetition(base, positionOf("4k3/8/8/8/8/8/8/R3K3 b - - 0 1"))).toBe(
      false,
    );
    expect(samePositionForRepetition(base, positionOf("4k3/8/8/8/8/8/8/1R2K3 w - - 0 1"))).toBe(
      false,
    );
    expect(
      samePositionForRepetition(
        positionOf("4k3/8/8/8/8/8/8/N3K3 w - - 0 1"),
        positionOf("4k3/8/8/8/8/8/8/n3K3 w - - 0 1"),
      ),
    ).toBe(false);
  });

  it("TST-FOUND-REP-004 castling rights are part of the identity", () => {
    const placement = "r3k2r/8/8/8/8/8/8/R3K2R w";
    expect(
      samePositionForRepetition(
        positionOf(`${placement} KQkq - 0 1`),
        positionOf(`${placement} KQk - 0 1`),
      ),
    ).toBe(false);
  });

  it("TST-FOUND-REP-005 en passant counts only when an actual legal en passant capture is available", () => {
    const legalCapture = goldenFen("TST-RULE-E01-009");
    const pinnedCapture = goldenFen("TST-RULE-E01-010");
    const kingBeside = "4k3/8/8/3pK3/8/8/8/8 w - d6 0 1";
    const afterE4 = ruleHistory(INITIAL, ["e2e4"]).current;
    expect(afterE4.enPassantTarget).toBe("e3");
    expect(generateLegalMoves(positionOf(kingBeside)).some((m) => m.to === "d6")).toBe(true);

    expect(samePositionForRepetition(positionOf(legalCapture), withoutTarget(legalCapture))).toBe(
      false,
    );
    expect(keyText(positionOf(legalCapture)).endsWith(" d6")).toBe(true);
    expect(samePositionForRepetition(positionOf(pinnedCapture), withoutTarget(pinnedCapture))).toBe(
      true,
    );
    expect(samePositionForRepetition(positionOf(kingBeside), withoutTarget(kingBeside))).toBe(true);
    expect(
      samePositionForRepetition(
        afterE4,
        positionOf("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"),
      ),
    ).toBe(true);
  });

  it("TST-FOUND-REP-006 occurrences are counted across the history and need not be consecutive", () => {
    const history = ruleHistory(INITIAL, [...CYCLE, "b1c3", "b8c6", "c3b1", "c6b8", ...CYCLE]);
    expect(history.keys).toHaveLength(13);
    expect(repetitionCount(history.keys, INITIAL)).toBe(4);
    const afterNf3 = history.positions[1];
    if (afterNf3 === undefined) throw new Error("short history");
    expect(repetitionCount(history.keys, afterNf3)).toBe(2);
    expect(repetitionCount(history.keys, positionOf("4k3/8/8/8/8/8/8/4K3 w - - 0 1"))).toBe(0);
  });

  it("TST-FOUND-REP-007 keys are frozen, deterministic, and compared by identity text", () => {
    const key = repetitionKey(INITIAL);
    expect(Object.isFrozen(key)).toBe(true);
    expect(Reflect.set(key, "text", "x")).toBe(false);
    expect(repetitionKey(INITIAL).equals(key)).toBe(true);
    expect(repetitionKey(createInitialPosition()).text).toBe(key.text);
  });

  it("TST-FOUND-REP-008 history convention: one key at creation, one per accepted move, none for a claim", () => {
    const history = ruleHistory(INITIAL, CYCLE);
    expect(history.keys).toHaveLength(CYCLE.length + 1);
    expect(history.keys[0]?.equals(repetitionKey(INITIAL))).toBe(true);
    expect(history.keys.at(-1)?.equals(repetitionKey(history.current))).toBe(true);
    const before = history.keys.map((key) => key.text);
    evaluateDrawClaim(history.keys, history.current, {
      kind: "threefold_intended",
      intended: { from: "g1", to: "f3" },
    });
    expect(history.keys.map((key) => key.text)).toEqual(before);
  });

  it("TST-FOUND-REP-009 a normal capture onto an occupied target square is not en passant", () => {
    const cases: readonly (readonly [string, Square, Square, string])[] = [
      ["4k3/8/3b4/4P3/8/8/8/4K3 w - d6 0 1", "e5", "d6", "black bishop"],
      ["4k3/8/8/8/4p3/3B4/8/4K3 b - d3 0 1", "e4", "d3", "white bishop"],
    ];
    for (const [fen, from, to, occupant] of cases) {
      const raw = positionOf(fen);
      const cleared = withoutTarget(fen);
      const piece = pieceAt(raw, to);
      expect(`${piece?.color} ${piece?.kind}`).toBe(occupant);
      expect(raw.enPassantTarget).toBe(to);
      expect(generateLegalMoves(raw).some((m) => m.from === from && m.to === to)).toBe(true);
      expect(generateLegalMoves(cleared).some((m) => m.from === from && m.to === to)).toBe(true);
      expect(generateLegalMoves(raw)).toEqual(generateLegalMoves(cleared));
      expect(samePositionForRepetition(raw, cleared)).toBe(true);
      expect(keyText(raw).endsWith(" -")).toBe(true);
    }
  });
});

describe("Golden ledger repetition identity rows", () => {
  it("TST-RULE-E01-023a same squares with KQkq versus KQk are different positions; the claim is incorrect", () => {
    const lostQueenside = ruleHistory(INITIAL, [
      "g1f3",
      "b8c6",
      "f3g1",
      "a8b8",
      "g1f3",
      "b8a8",
      "f3g1",
      "c6b8",
      ...CYCLE,
    ]);
    const current = lostQueenside.current;
    expect(current.board).toEqual(INITIAL.board);
    expect(current.sideToMove).toBe(INITIAL.sideToMove);
    expect(current.castling).toEqual({
      whiteKingside: true,
      whiteQueenside: true,
      blackKingside: true,
      blackQueenside: false,
    });
    expect(samePositionForRepetition(current, INITIAL)).toBe(false);
    const initialBoard = JSON.stringify(INITIAL.board);
    const samePlacement = lostQueenside.positions.filter(
      (position) =>
        position.sideToMove === "white" && JSON.stringify(position.board) === initialBoard,
    );
    expect(samePlacement).toHaveLength(3);
    expect(repetitionCount(lostQueenside.keys, current)).toBe(2);
    const claim = evaluateDrawClaim(lostQueenside.keys, current, { kind: "threefold_current" });
    expect(claim.ok && claim.value.verdict).toBe("incorrect");
  });

  it("TST-RULE-E01-023b same squares with and without legal en passant are different positions", () => {
    const withEp = ruleHistory(INITIAL, ["e2e4", "g8f6", "e4e5", "f6g8", "g1f3", "d7d5"]).current;
    const withoutEp = ruleHistory(INITIAL, [
      "e2e4",
      "g8f6",
      "e4e5",
      "d7d5",
      "g1f3",
      "f6g8",
    ]).current;
    expect(withEp.board).toEqual(withoutEp.board);
    expect([withEp.sideToMove, withEp.castling]).toEqual([
      withoutEp.sideToMove,
      withoutEp.castling,
    ]);
    expect([withEp.enPassantTarget, withoutEp.enPassantTarget]).toEqual(["d6", null]);
    expect(generateLegalMoves(withEp).some((m) => m.from === "e5" && m.to === "d6")).toBe(true);
    expect(samePositionForRepetition(withEp, withoutEp)).toBe(false);
    const pinned = goldenFen("TST-RULE-E01-010");
    expect(samePositionForRepetition(positionOf(pinned), withoutTarget(pinned))).toBe(true);
  });
});
