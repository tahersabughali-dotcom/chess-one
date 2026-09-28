import * as chessRules from "@chess-one/chess-rules";
import { assessMatingPossibility, createInitialPosition, parseFen } from "@chess-one/chess-rules";
import { describe, expect, it } from "vitest";
import { goldenFen } from "./fixtures/golden-positions.ts";

function assess(fen: string) {
  const parsed = parseFen(fen);
  if (!parsed.ok) throw new Error(`${fen}: ${parsed.error.message}`);
  return assessMatingPossibility(parsed.value);
}

describe("Partial mating-possibility detector (DEC-062, DEC-064)", () => {
  it("TST-RULE-E01-014a king versus king is PROVEN_DEAD", () => {
    expect(assess(goldenFen("TST-RULE-E01-014a"))).toBe("PROVEN_DEAD");
  });

  it("TST-RULE-E01-014b king and bishop versus king is PROVEN_DEAD, both colours", () => {
    expect(assess(goldenFen("TST-RULE-E01-014b"))).toBe("PROVEN_DEAD");
    expect(assess("8/8/8/8/4k3/8/4b3/4K3 w - - 0 1")).toBe("PROVEN_DEAD");
  });

  it("TST-RULE-E01-014c king and knight versus king is PROVEN_DEAD, both colours", () => {
    expect(assess(goldenFen("TST-RULE-E01-014c"))).toBe("PROVEN_DEAD");
    expect(assess("8/8/8/8/4k3/8/4n3/4K3 w - - 0 1")).toBe("PROVEN_DEAD");
  });

  it("TST-RULE-E01-014d king and two knights versus king is not PROVEN_DEAD, both colours", () => {
    expect(assess(goldenFen("TST-RULE-E01-014d"))).not.toBe("PROVEN_DEAD");
    expect(assess("8/8/8/8/4k3/8/2n1n3/4K3 w - - 0 1")).not.toBe("PROVEN_DEAD");
  });

  it("TST-FOUND-MATE-001 mating material and unproven sets stay UNKNOWN", () => {
    const unproven = [
      "4k3/8/8/8/8/8/8/3QK3 w - - 0 1",
      "4k3/8/8/8/8/8/8/R3K3 w - - 0 1",
      "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1",
      "4k3/8/8/8/8/8/3BB3/4K3 w - - 0 1",
      "4k3/8/8/8/8/8/2B1B3/4K3 w - - 0 1",
      "4k3/8/8/8/8/8/3BN3/4K3 w - - 0 1",
      "4k3/4b3/8/8/8/8/4B3/4K3 w - - 0 1",
      "4k3/4n3/8/8/8/8/4N3/4K3 w - - 0 1",
    ];
    for (const fen of unproven) expect(assess(fen)).toBe("UNKNOWN");
    expect(assessMatingPossibility(createInitialPosition())).toBe("UNKNOWN");
  });

  it("TST-FOUND-MATE-002 the detector is not wired to any game result", () => {
    const exported = Object.keys(chessRules);
    expect(exported.some((name) => /result|finish|adjudicat|termination/i.test(name))).toBe(false);
  });
});
