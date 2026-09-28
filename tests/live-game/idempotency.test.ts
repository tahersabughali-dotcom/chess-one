import {
  type ActiveGameState,
  type CommandResponse,
  fingerprintOf,
  type LiveGameCommand,
  parseCommand,
  processCommand,
  type SubmitMoveCommandV1,
} from "@chess-one/live-game";
import { describe, expect, it } from "vitest";
import {
  actorFor,
  at,
  claimCommand,
  LEASES,
  moveCommand,
  newGame,
  playMoves,
  ROTATED_WHITE_LEASE,
  START_MS,
  snapshot,
  submit,
  withRotatedLease,
} from "./support/harness.ts";

const SHORT_MS = 1_000;
const LATE = START_MS + SHORT_MS + 1;

function fingerprint(command: LiveGameCommand): string {
  const parsed = parseCommand(command);
  if (!parsed.ok) throw new Error(parsed.error);
  return fingerprintOf(parsed.value);
}

describe("TST-LIVE command identity across lease rotation", () => {
  it("TST-LIVE-100 a new controller reusing an old command id and payload does not receive the old lease's decision", () => {
    const game = newGame();
    const original = moveCommand(game, "e2e4", { clientCommandId: "cmd-1" });
    const accepted = submit(game, original, START_MS + 10).nextState;
    const rotated = withRotatedLease(accepted, "white", ROTATED_WHITE_LEASE);

    const stale = submit(rotated, original, START_MS + 20, "white");
    expect(stale.response).toMatchObject({ code: "Unauthorized", detail: "invalid_control_lease" });

    const reused = { ...original, controlLeaseId: ROTATED_WHITE_LEASE };
    const actor = actorFor(rotated, "white");
    expect(actor.controlLeaseId).toBe(ROTATED_WHITE_LEASE);
    const decision = processCommand(rotated, actor, reused, at(START_MS + 30));
    expect(decision.response).toMatchObject({
      code: "InvalidCommandIdentity",
      replayedResponse: false,
    });
    expect(decision.nextState).toBe(rotated);
    expect(decision.events).toEqual([]);
    expect(fingerprint(reused)).not.toBe(accepted.commandBindings[0]?.fingerprint);
  });

  it("TST-LIVE-101 the same command id, payload, and original lease still replays", () => {
    const game = newGame();
    const original = moveCommand(game, "e2e4", { clientCommandId: "cmd-1" });
    const first = submit(game, original, START_MS + 10);
    const replay = submit(first.nextState, original, START_MS + 20, "white");
    expect(replay.response).toEqual({ ...first.response, replayedResponse: true });
    expect(replay.nextState).toBe(first.nextState);
    expect(first.nextState.commandBindings[0]?.fingerprint).toBe(fingerprint(original));
  });
});

describe("TST-LIVE late client commands are bound", () => {
  const cases: readonly [string, (state: ActiveGameState) => LiveGameCommand][] = [
    ["SubmitMoveCommand", (state) => moveCommand(state, "e2e4", { clientCommandId: "late-1" })],
    [
      "ClaimDrawCommand current",
      (state) => claimCommand(state, "threefold_current", undefined, { clientCommandId: "late-1" }),
    ],
    [
      "ClaimDrawCommand intended",
      (state) => claimCommand(state, "threefold_intended", "e2e4", { clientCommandId: "late-1" }),
    ],
  ];

  for (const [label, build] of cases) {
    it(`TST-LIVE-102 a late ${label} commits one flag, is bound, and replays its original response`, () => {
      const game = newGame({ initialMs: SHORT_MS });
      const command = build(game);
      const first = submit(game, command, LATE);
      const flagged = first.nextState;
      expect(first.response).toMatchObject({
        code: "MoveReceivedAfterDeadline",
        replayedResponse: false,
        clientCommandId: "late-1",
        san: null,
        sequence: 1,
      });
      expect(flagged.status).toEqual({
        kind: "unresolved",
        reason: "MATING_POSSIBILITY_UNRESOLVED",
        flaggedSide: "white",
      });
      expect(flagged.sequence).toBe(1);
      expect(flagged.position).toBe(game.position);
      expect(flagged.history).toBe(game.history);
      expect(flagged.clock.remainingMs).toEqual({ white: 0, black: SHORT_MS });
      expect(flagged.commandBindings).toHaveLength(1);
      expect(flagged.commandBindings[0]).toMatchObject({
        seat: "white",
        clientCommandId: "late-1",
        fingerprint: fingerprint(command),
      });
      expect(flagged.commandBindings[0]?.response).toBe(first.response);
      expect(first.events).toEqual([]);

      const before = snapshot(flagged);
      const replay = submit(flagged, command, LATE + 500, "white");
      expect(replay.response).toEqual({ ...first.response, replayedResponse: true });
      expect(replay.nextState).toBe(flagged);
      expect(replay.events).toEqual([]);
      expect(snapshot(flagged)).toEqual(before);
    });
  }

  it("TST-LIVE-103 the same command id with a different payload after a late binding is InvalidCommandIdentity", () => {
    const game = newGame({ initialMs: SHORT_MS });
    const flagged = submit(
      game,
      moveCommand(game, "e2e4", { clientCommandId: "late-x" }),
      LATE,
    ).nextState;
    for (const different of [
      moveCommand(game, "d2d4", { clientCommandId: "late-x" }),
      claimCommand(game, "threefold_current", undefined, { clientCommandId: "late-x" }),
    ]) {
      const decision = submit(flagged, different, LATE + 5, "white");
      expect(decision.response).toMatchObject({ code: "InvalidCommandIdentity" });
      expect(decision.nextState).toBe(flagged);
    }
    const unbound = submit(
      flagged,
      moveCommand(game, "d2d4", { clientCommandId: "late-y" }),
      LATE + 6,
    );
    expect(unbound.response.code).toBe("MatingPossibilityUnresolved");
    expect(unbound.nextState).toBe(flagged);
  });

  it("TST-LIVE-104 a late binding uses the one lease-scoped fingerprint", () => {
    const game = newGame({ initialMs: SHORT_MS });
    const command = moveCommand(game, "e2e4", { clientCommandId: "late-z" });
    const flagged = submit(game, command, LATE).nextState;
    const stored = flagged.commandBindings[0]?.fingerprint;
    expect(stored).toBe(fingerprint(command));
    expect(stored).not.toBe(fingerprint({ ...command, controlLeaseId: ROTATED_WHITE_LEASE }));
    expect(command.controlLeaseId).toBe(LEASES.white);
  });
});

interface Checkmated {
  readonly finished: ActiveGameState;
  readonly opening: SubmitMoveCommandV1;
  readonly openingResponse: CommandResponse;
  readonly mate: SubmitMoveCommandV1;
  readonly mateResponse: CommandResponse;
  readonly time: number;
}

/** Fool's mate, keeping the first command and the mating command for replay. */
function checkmated(): Checkmated {
  const game = newGame();
  const opening = moveCommand(game, "f2f3", { clientCommandId: "cmd-a" });
  const first = submit(game, opening, START_MS + 10);
  const { state, time } = playMoves(first.nextState, ["e7e5", "g2g4"], START_MS + 10);
  const mate = moveCommand(state, "d8h4", { clientCommandId: "cmd-mate" });
  const final = submit(state, mate, time + 10);
  expect(final.response).toMatchObject({ code: "Accepted", san: "Qh4#" });
  expect(final.nextState.status).toMatchObject({ kind: "finished" });
  expect(final.events).toHaveLength(1);
  return {
    finished: final.nextState,
    opening,
    openingResponse: first.response,
    mate,
    mateResponse: final.response,
    time: time + 10,
  };
}

describe("TST-LIVE terminal absorption", () => {
  it("TST-LIVE-105 a new command after the game finished returns the same state object and stores no binding", () => {
    const { finished, time } = checkmated();
    const bindings = finished.commandBindings.length;
    const { sequence, clock, position, history, status } = finished;
    const before = snapshot(finished);
    const fresh: readonly [LiveGameCommand, "white" | "black"][] = [
      [moveCommand(finished, "e2e4", { clientCommandId: "post-1" }), "white"],
      [
        claimCommand(finished, "threefold_current", undefined, { clientCommandId: "post-2" }),
        "white",
      ],
      [
        claimCommand(finished, "fifty_move_intended", "e2e4", { clientCommandId: "post-3" }),
        "white",
      ],
      [
        moveCommand(finished, "a2a3", { clientCommandId: "post-4", expectedGameSequence: 99 }),
        "white",
      ],
      [
        moveCommand(finished, "e8e7", {
          clientCommandId: "post-5",
          controlLeaseId: LEASES.black,
          fromSquare: "e8",
          toSquare: "e7",
        }),
        "black",
      ],
    ];
    for (const [command, seat] of fresh) {
      for (const offset of [1_000, 2_000]) {
        const decision = submit(finished, command, time + offset, seat);
        expect(decision.response).toMatchObject({
          code: "GameAlreadyFinished",
          replayedResponse: false,
          clientCommandId: command.clientCommandId,
          sequence,
        });
        expect(decision.nextState).toBe(finished);
        expect(decision.nextState.commandBindings).toHaveLength(bindings);
        expect(decision.nextState.sequence).toBe(sequence);
        expect(decision.nextState.clock).toBe(clock);
        expect(decision.nextState.position).toBe(position);
        expect(decision.nextState.history).toBe(history);
        expect(decision.nextState.status).toBe(status);
        expect(decision.events).toEqual([]);
      }
    }
    expect(snapshot(finished)).toEqual(before);
  });

  it("TST-LIVE-106 a command bound before the finish still replays its stored response after the finish", () => {
    const { finished, opening, openingResponse, mate, mateResponse, time } = checkmated();
    const before = snapshot(finished);
    for (const [command, response, seat] of [
      [opening, openingResponse, "white"],
      [mate, mateResponse, "black"],
    ] as const) {
      const replay = submit(finished, command, time + 1_000, seat);
      expect(replay.response).toEqual({ ...response, replayedResponse: true });
      expect(replay.nextState).toBe(finished);
      expect(replay.events).toEqual([]);
    }
    expect(snapshot(finished)).toEqual(before);
  });

  it("TST-LIVE-107 a bound command id with a different payload after the finish is InvalidCommandIdentity", () => {
    const { finished, opening, mate, time } = checkmated();
    for (const [different, seat] of [
      [{ ...opening, toSquare: "f4" }, "white"],
      [{ ...mate, toSquare: "g5" }, "black"],
    ] as const) {
      const decision = submit(finished, different, time + 1_000, seat);
      expect(decision.response).toMatchObject({
        code: "InvalidCommandIdentity",
        replayedResponse: false,
      });
      expect(decision.nextState).toBe(finished);
      expect(decision.events).toEqual([]);
    }
  });
});
