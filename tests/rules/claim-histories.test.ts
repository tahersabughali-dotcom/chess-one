import { createInitialPosition, pieceAt } from "@chess-one/chess-rules";
import { describe, expect, it } from "vitest";
import {
  FIFTY_MOVE_INCORRECT_INTENDED,
  FIFTY_MOVE_INTENDED,
  THREEFOLD_INTENDED,
} from "./fixtures/claim-histories.ts";
import { applyQuietKnightMove, repetitionKey, replay } from "./support/knight-replay.ts";

function occurrences(keys: readonly string[], key: string): number {
  return keys.filter((candidate) => candidate === key).length;
}

describe("Intended-claim history fixture integrity", () => {
  it("TST-RULE-E01-018b fixture: the intended move creates the third occurrence", () => {
    const start = createInitialPosition();
    const positions = replay(start, THREEFOLD_INTENDED.plies);
    const keys = positions.map(repetitionKey);
    const startKey = repetitionKey(start);
    const last = positions.at(-1);
    if (last === undefined) throw new Error("empty replay");
    expect(last.sideToMove).toBe("black");
    expect(occurrences(keys, startKey)).toBe(2);
    const after = applyQuietKnightMove(last, THREEFOLD_INTENDED.intended);
    expect(repetitionKey(after)).toBe(startKey);
    expect(occurrences([...keys, repetitionKey(after)], startKey)).toBe(3);
  });

  it("TST-RULE-E01-020b fixture: 99 quiet plies, the intended move completes 50 moves each", () => {
    const start = createInitialPosition();
    const positions = replay(start, FIFTY_MOVE_INTENDED.plies);
    expect(FIFTY_MOVE_INTENDED.plies).toHaveLength(99);
    const keys = positions.map(repetitionKey);
    expect(new Set(keys).size).toBe(100);
    const last = positions.at(-1);
    if (last === undefined) throw new Error("empty replay");
    expect(last.sideToMove).toBe("black");
    expect(last.halfmoveClock).toBe(99);
    expect(last.fullmoveNumber).toBe(50);
    expect(pieceAt(last, "f5")?.kind).toBe("knight");
    expect(pieceAt(last, "g5")?.kind).toBe("knight");
    expect(pieceAt(last, "c6")?.kind).toBe("knight");
    expect(pieceAt(last, "g8")?.kind).toBe("knight");
    const after = applyQuietKnightMove(last, FIFTY_MOVE_INTENDED.intended);
    expect(after.halfmoveClock).toBe(100);
    expect(keys).not.toContain(repetitionKey(after));
  });

  it("TST-RULE-E01-020c fixture: the incorrect intended move is a black pawn move to an empty square", () => {
    const last = replay(createInitialPosition(), FIFTY_MOVE_INTENDED.plies).at(-1);
    if (last === undefined) throw new Error("empty replay");
    const from = FIFTY_MOVE_INCORRECT_INTENDED.slice(0, 2);
    const to = FIFTY_MOVE_INCORRECT_INTENDED.slice(2, 4);
    expect(from).toBe("a7");
    expect(to).toBe("a6");
    expect(pieceAt(last, "a7")).toEqual({ color: "black", kind: "pawn" });
    expect(pieceAt(last, "a6")).toBeNull();
  });
});
