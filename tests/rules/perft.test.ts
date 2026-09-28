import { type Position, parseFen } from "@chess-one/chess-rules";
import { describe, expect, it } from "vitest";
import { perft, perftDivide } from "./support/perft.ts";

/**
 * Engineering regression vectors, not legal authority (FIDE-E01-2023 is).
 * Provenance: the widely republished perft tables on the Chess Programming
 * Wiki "Perft Results" page (initial position, Position 2 "Kiwipete" by Peter
 * McKenzie, Position 3, Position 4). Depths are kept shallow so routine runs
 * stay fast; there is no timing assertion.
 */
const VECTORS: readonly {
  readonly name: string;
  readonly fen: string;
  readonly counts: readonly (readonly [depth: number, nodes: number])[];
}[] = [
  {
    name: "initial position",
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    counts: [
      [0, 1],
      [1, 20],
      [2, 400],
      [3, 8902],
      [4, 197281],
    ],
  },
  {
    name: "position 2 (Kiwipete)",
    fen: "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
    counts: [
      [1, 48],
      [2, 2039],
      [3, 97862],
    ],
  },
  {
    name: "position 3",
    fen: "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
    counts: [
      [1, 14],
      [2, 191],
      [3, 2812],
      [4, 43238],
    ],
  },
  {
    name: "position 4",
    fen: "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1",
    counts: [
      [1, 6],
      [2, 264],
      [3, 9467],
    ],
  },
];

function parsed(fen: string): Position {
  const result = parseFen(fen);
  if (!result.ok) throw new Error(`${fen}: ${result.error.message}`);
  return result.value;
}

describe("TST-FOUND-PERFT regression vectors", () => {
  for (const { name, fen, counts } of VECTORS) {
    for (const [depth, nodes] of counts) {
      it(`TST-FOUND-PERFT ${name} depth ${depth} = ${nodes}`, () => {
        expect(perft(parsed(fen), depth)).toBe(nodes);
      });
    }
  }

  it("TST-FOUND-PERFT divide sums to perft", () => {
    const position = parsed(VECTORS[1]?.fen ?? "");
    const divide = perftDivide(position, 2);
    expect(divide.size).toBe(48);
    expect([...divide.values()].reduce((sum, count) => sum + count, 0)).toBe(2039);
  });
});
