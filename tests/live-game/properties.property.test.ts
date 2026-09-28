import {
  formatFen,
  generateLegalMoves,
  isCanonicalPosition,
  parseFen,
  repetitionKey,
} from "@chess-one/chess-rules";
import { SQUARES } from "@chess-one/game-values";
import type {
  ActiveGameState,
  CommandDecision,
  LiveGameCommand,
  ResponseCode,
  Seat,
} from "@chess-one/live-game";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  claimCommand,
  INITIAL_MS,
  moveCommand,
  newGame,
  PENALTY_MS,
  START_MS,
  snapshot,
  submit,
} from "./support/harness.ts";

const RUNS = { numRuns: 60 };
const MAX_STEPS = 40;
const CLAIM_KINDS = [
  "threefold_current",
  "fifty_move_current",
  "threefold_intended",
  "fifty_move_intended",
] as const;

type Step =
  | { readonly kind: "legal"; readonly pick: number; readonly delay: number }
  | { readonly kind: "squares"; readonly from: number; readonly to: number; readonly delay: number }
  | {
      readonly kind: "claim";
      readonly claim: number;
      readonly pick: number;
      readonly delay: number;
    }
  | { readonly kind: "replay"; readonly pick: number; readonly delay: number }
  | { readonly kind: "conflict"; readonly pick: number; readonly delay: number }
  | { readonly kind: "wrong_seat"; readonly pick: number; readonly delay: number }
  | { readonly kind: "stale"; readonly pick: number; readonly delay: number };

const delay = fc.integer({ min: 0, max: 3_000 });
const pick = fc.nat({ max: 10_000 });
const step: fc.Arbitrary<Step> = fc.oneof(
  { weight: 6, arbitrary: fc.record({ kind: fc.constant("legal"), pick, delay }) },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant("squares"),
      from: fc.nat({ max: 63 }),
      to: fc.nat({ max: 63 }),
      delay,
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({ kind: fc.constant("claim"), claim: fc.nat({ max: 3 }), pick, delay }),
  },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant("replay"), pick, delay }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("conflict"), pick, delay }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("wrong_seat"), pick, delay }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("stale"), pick, delay }) },
);
const scenario = fc.record({
  initialMs: fc.constantFrom(8_000, 30_000, INITIAL_MS),
  steps: fc.array(step, { maxLength: MAX_STEPS }),
});

interface Sent {
  readonly command: LiveGameCommand;
  readonly seat: Seat;
}

function legalUci(state: ActiveGameState, index: number): string {
  const moves = generateLegalMoves(state.position);
  const move = moves[index % Math.max(moves.length, 1)];
  return move === undefined ? "a1a2" : `${move.from}${move.to}${move.promotion ?? ""}`;
}

function squareAt(index: number): string {
  return SQUARES[index] ?? "a1";
}

function build(state: ActiveGameState, current: Step, sent: readonly Sent[]): Sent {
  const seat = state.position.sideToMove;
  switch (current.kind) {
    case "legal":
      return { command: moveCommand(state, legalUci(state, current.pick)), seat };
    case "squares":
      return {
        command: moveCommand(state, `${squareAt(current.from)}${squareAt(current.to)}`, {
          clientCommandId: `sq-${state.sequence}-${current.from}-${current.to}`,
        }),
        seat,
      };
    case "claim": {
      const kind = CLAIM_KINDS[current.claim] ?? "threefold_current";
      const intended = kind.endsWith("_intended") ? legalUci(state, current.pick) : undefined;
      return { command: claimCommand(state, kind, intended), seat };
    }
    case "replay":
    case "conflict": {
      const previous = sent[current.pick % Math.max(sent.length, 1)];
      if (previous === undefined) return { command: moveCommand(state, "a2a3"), seat };
      if (current.kind === "replay") return previous;
      const other = moveCommand(state, "h2h4", {
        clientCommandId: previous.command.clientCommandId,
        controlLeaseId: state.controlLeases[previous.seat],
        fromSquare: "h2",
        toSquare: previous.command.command === "SubmitMoveCommand.v1" ? "h3" : "h4",
      });
      return { command: other, seat: previous.seat };
    }
    case "wrong_seat": {
      const other: Seat = seat === "white" ? "black" : "white";
      return {
        command: moveCommand(state, legalUci(state, current.pick), {
          clientCommandId: `wrong-${state.sequence}-${current.pick}`,
          controlLeaseId: state.controlLeases[other],
        }),
        seat: other,
      };
    }
    case "stale":
      return {
        command: moveCommand(state, legalUci(state, current.pick), {
          clientCommandId: `stale-${state.sequence}-${current.pick}`,
          expectedGameSequence: state.sequence + 1 + (current.pick % 3),
        }),
        seat,
      };
  }
}

const COMMITTING: ReadonlySet<ResponseCode> = new Set([
  "Accepted",
  "IncorrectClaim",
  "MoveReceivedAfterDeadline",
]);

function commits(decision: CommandDecision, sent: Sent): boolean {
  const { code, replayedResponse } = decision.response;
  if (replayedResponse) return false;
  if (COMMITTING.has(code)) return true;
  return code === "IllegalMove" && sent.command.command === "ClaimDrawCommand.v1";
}

function checkInvariants(before: ActiveGameState, decision: CommandDecision, sent: Sent): void {
  const next = decision.nextState;
  const { response } = decision;
  if (
    response.replayedResponse ||
    response.code === "InvalidCommandIdentity" ||
    before.status.kind === "finished"
  ) {
    expect(next).toBe(before);
  }
  if (before.status.kind !== "active") {
    expect(next.status).toBe(before.status);
    expect(next.position).toBe(before.position);
    expect(next.clock).toBe(before.clock);
    expect(next.sequence).toBe(before.sequence);
  }
  const committed = commits(decision, sent);
  expect(next.sequence).toBe(before.sequence + (committed ? 1 : 0));
  if (committed) {
    expect(next.commandBindings).toHaveLength(before.commandBindings.length + 1);
    expect(next.commandBindings.at(-1)?.response).toBe(response);
  }
  if (!committed) {
    expect(next.position).toBe(before.position);
    expect(next.history).toBe(before.history);
    expect(next.clock).toBe(before.clock);
  }
  const moved = committed && response.san !== null;
  expect(next.history).toHaveLength(before.history.length + (moved ? 1 : 0));
  expect(next.history.at(-1)).toEqual(repetitionKey(next.position));
  if (response.code === "IncorrectClaim" && !response.replayedResponse) {
    const opponent: Seat = sent.seat === "white" ? "black" : "white";
    expect(next.clock.remainingMs[opponent]).toBe(before.clock.remainingMs[opponent] + PENALTY_MS);
  }
  for (const balance of Object.values(next.clock.remainingMs)) {
    expect(Number.isSafeInteger(balance) && balance >= 0).toBe(true);
  }
  expect(isCanonicalPosition(next.position)).toBe(true);
  const reparsed = parseFen(formatFen(next.position));
  expect(reparsed.ok && formatFen(reparsed.value)).toBe(formatFen(next.position));
  expect(decision.events.length).toBe(
    committed && before.status.kind === "active" && next.status.kind === "finished" ? 1 : 0,
  );
}

describe("TST-LIVE properties", () => {
  it("TST-LIVE-080 replay, rejection, conflict, commit, penalty, terminal, clock, and position invariants hold on random sessions", () => {
    const seen = new Set<string>();
    fc.assert(
      fc.property(scenario, ({ initialMs, steps }) => {
        let state = newGame({ initialMs });
        let now = START_MS;
        const sent: Sent[] = [];
        for (const current of steps) {
          now += current.delay;
          const outgoing = build(state, current, sent);
          const before = snapshot(state);
          const decision = submit(state, outgoing.command, now, outgoing.seat);
          expect(snapshot(state)).toEqual(before);
          checkInvariants(state, decision, outgoing);
          seen.add(decision.response.replayedResponse ? "replay" : decision.response.code);
          sent.push(outgoing);
          state = decision.nextState;
        }
      }),
      { ...RUNS, seed: 20260928 },
    );
    expect([...seen].sort()).toEqual(
      expect.arrayContaining([
        "Accepted",
        "IllegalMove",
        "IncorrectClaim",
        "InvalidCommandIdentity",
        "MoveReceivedAfterDeadline",
        "NotYourTurn",
        "StaleSequence",
        "replay",
      ]),
    );
  });

  it("TST-LIVE-081 replaying every command of a session changes nothing and returns the stored responses", () => {
    fc.assert(
      fc.property(fc.array(pick, { minLength: 1, maxLength: 24 }), (picks) => {
        let state = newGame();
        let now = START_MS;
        const log: { sent: Sent; response: CommandDecision["response"] }[] = [];
        for (const choice of picks) {
          now += 25;
          const sent = build(state, { kind: "legal", pick: choice, delay: 0 }, []);
          const decision = submit(state, sent.command, now, sent.seat);
          log.push({ sent, response: decision.response });
          state = decision.nextState;
        }
        const final = state;
        for (const { sent, response } of log) {
          if (response.clientCommandId === null) continue;
          const replay = submit(final, sent.command, now + 1, sent.seat);
          if (
            response.code === "MatingPossibilityUnresolved" ||
            response.code === "StaleSequence"
          ) {
            expect(replay.nextState).toBe(final);
            continue;
          }
          expect(replay.response).toEqual({ ...response, replayedResponse: true });
          expect(replay.nextState).toBe(final);
        }
      }),
      { numRuns: 40 },
    );
  });

  it("TST-LIVE-082 a finished game returns the same state object for every later command", () => {
    let game = newGame();
    let now = START_MS;
    const played: { sent: Sent; response: CommandDecision["response"] }[] = [];
    for (const uci of ["f2f3", "e7e5", "g2g4", "d8h4"]) {
      now += 10;
      const sent = { command: moveCommand(game, uci), seat: game.position.sideToMove };
      const decision = submit(game, sent.command, now, sent.seat);
      played.push({ sent, response: decision.response });
      game = decision.nextState;
    }
    const finished = game;
    expect(finished.status.kind).toBe("finished");
    const stored = new Map(played.map(({ sent, response }) => [sent.command, response]));
    const seen = new Set<string>();
    fc.assert(
      fc.property(fc.array(step, { minLength: 1, maxLength: MAX_STEPS }), (steps) => {
        const sent = played.map((entry) => entry.sent);
        const before = snapshot(finished);
        let time = now;
        for (const current of steps) {
          time += current.delay;
          const outgoing = build(finished, current, sent);
          const decision = submit(finished, outgoing.command, time, outgoing.seat);
          expect(decision.nextState).toBe(finished);
          expect(decision.events).toEqual([]);
          const original = stored.get(outgoing.command);
          if (original === undefined) {
            expect(decision.response.replayedResponse).toBe(false);
            expect(["GameAlreadyFinished", "InvalidCommandIdentity", "InvalidState"]).toContain(
              decision.response.code,
            );
          } else {
            expect(decision.response).toEqual({ ...original, replayedResponse: true });
          }
          seen.add(decision.response.replayedResponse ? "replay" : decision.response.code);
          sent.push(outgoing);
        }
        expect(snapshot(finished)).toEqual(before);
      }),
      { ...RUNS, seed: 20260928 },
    );
    expect([...seen]).toEqual(
      expect.arrayContaining(["GameAlreadyFinished", "InvalidCommandIdentity", "replay"]),
    );
  });
});
