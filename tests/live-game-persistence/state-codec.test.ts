import {
  type ActiveGameState,
  abortIfStartDeadlinePassed,
  decodeGameState,
  encodeBinding,
  encodeGameState,
  LIVE_GAME_STATE_FORMAT,
  LIVE_GAME_STATE_FORMAT_V1,
} from "@chess-one/live-game";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  awaitingGame,
  INITIAL_MS,
  moveCommand,
  newGame,
  offerCommand,
  respondCommand,
  START_DEADLINE_MS,
  snapshot,
  submit,
  wallClockMs,
} from "../live-game/support/harness.ts";
import { edit, type Json, type Path, REMOVE, read, viaJson } from "./support/json.ts";
import {
  activeWithBindings,
  allFixtures,
  checkmate,
  declinedOffer,
  drawAgreed,
  pendingOffer,
  unresolvedFlag,
} from "./support/states.ts";

interface Stored {
  readonly record: Json;
  readonly bindings: readonly Json[];
}

function store(state: ActiveGameState): Stored {
  return {
    record: viaJson(encodeGameState(state)),
    bindings: state.commandBindings.map((binding, index) => viaJson(encodeBinding(binding, index))),
  };
}

function load(stored: Stored): ActiveGameState {
  const decoded = decodeGameState(stored.record, stored.bindings);
  if (!decoded.ok) throw new Error(`corrupt at ${decoded.error.path}: ${decoded.error.reason}`);
  return decoded.value;
}

function expectCorrupt(record: Json, bindings: readonly Json[], path: string): string {
  const decoded = decodeGameState(record, bindings);
  expect(decoded, path).toMatchObject({ ok: false, error: { kind: "corrupt_state", path } });
  return decoded.ok ? "" : decoded.error.reason;
}

/** Corrupts one field of the game record and expects corruption reported at `expected`. */
function corruptState(
  state: ActiveGameState,
  path: Path,
  value: Json | typeof REMOVE,
  expected: string,
) {
  const stored = store(state);
  return expectCorrupt(edit(stored.record, path, value), stored.bindings, expected);
}

function corruptBinding(path: Path, value: Json | typeof REMOVE, expected: string): void {
  const stored = store(activeWithBindings().state);
  const bindings = stored.bindings.map((binding, index) =>
    index === 0 ? edit(binding, path, value) : binding,
  );
  expectCorrupt(stored.record, bindings, expected);
}

describe("TST-PERSIST live_game_state.v1 serialization", () => {
  it("TST-PERSIST-001 every fixture state survives a JSON round trip unchanged", () => {
    for (const { name, state } of allFixtures()) {
      const loaded = load(store(state));
      expect(snapshot(loaded), name).toEqual(snapshot(state));
      expect(viaJson(encodeGameState(loaded)), name).toEqual(viaJson(encodeGameState(state)));
      expect(
        loaded.commandBindings.map((binding) => viaJson(binding.response)),
        name,
      ).toEqual(state.commandBindings.map((binding) => viaJson(binding.response)));
    }
  });

  it("TST-PERSIST-002 the record is plain, versioned data with the position as canonical FEN", () => {
    const { state } = pendingOffer();
    const record = encodeGameState(state);
    expect(record.format).toBe(LIVE_GAME_STATE_FORMAT);
    expect(LIVE_GAME_STATE_FORMAT).toBe("live_game_state.v2");
    expect(viaJson(record)).toEqual(record);
    expect(record.positionFen).toBe(
      "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2",
    );
    expect(record.repetitionHistory).toEqual(state.history.map((key) => key.text));
    expect(record.repetitionHistory.at(-1)).toMatch(/ w KQkq -$/);
    expect(record.pendingDrawOffer).toEqual({
      offeredBy: "black",
      offeredTo: "white",
      createdAtSequence: 3,
    });
    expect(record.lastDrawOfferMove).toBe(2);
  });

  it("TST-PERSIST-003 a decoded state decides the next commands exactly as the original", () => {
    const offered = pendingOffer();
    const loaded = load(store(offered.state));
    for (const decision of ["accept", "decline"]) {
      const command = respondCommand(offered.state, "white", decision);
      const original = submit(offered.state, command, offered.time + 10, "white");
      const restored = submit(loaded, command, offered.time + 10, "white");
      expect(viaJson(restored.response), decision).toEqual(viaJson(original.response));
      expect(snapshot(restored.nextState), decision).toEqual(snapshot(original.nextState));
    }
    const declined = declinedOffer();
    const again = submit(
      load(store(declined.state)),
      offerCommand(declined.state, "black", { clientCommandId: "black-again" }),
      declined.time + 10,
      "black",
    );
    expect(again.response).toMatchObject({
      code: "InvalidState",
      detail: "draw_offer_already_used_for_move",
    });
    const move = moveCommand(declined.state, "g1f3");
    expect(
      snapshot(submit(load(store(declined.state)), move, declined.time + 10).nextState),
    ).toEqual(snapshot(submit(declined.state, move, declined.time + 10).nextState));
  });

  it("TST-PERSIST-004 stored bindings replay their original responses after decode", () => {
    const { state, time } = activeWithBindings();
    const loaded = load(store(state));
    const first = state.commandBindings[0];
    if (first === undefined) throw new Error("fixture has bindings");
    const replay = submit(loaded, moveCommand(newGame(), "e2e4"), time + 60, "white");
    expect(replay.nextState).toBe(loaded);
    expect(viaJson(replay.response)).toEqual(
      viaJson({ ...first.response, replayedResponse: true }),
    );
    const changed = submit(
      loaded,
      moveCommand(newGame(), "d2d4", { clientCommandId: first.clientCommandId }),
      time + 70,
      "white",
    );
    expect(changed.response.code).toBe("InvalidCommandIdentity");
    expect(changed.nextState).toBe(loaded);
  });

  it("TST-PERSIST-005 finished and unresolved statuses round-trip, and UNKNOWN never gains a result", () => {
    expect(load(store(checkmate().state)).status).toEqual({
      kind: "finished",
      result: { resultCode: "black_win", terminationReason: "checkmate", winner: "black" },
    });
    expect(load(store(drawAgreed().state)).status).toEqual({
      kind: "finished",
      result: { resultCode: "draw", terminationReason: "draw_agreed" },
    });
    const unresolved = unresolvedFlag().state;
    expect(load(store(unresolved)).status).toEqual({
      kind: "unresolved",
      reason: "MATING_POSSIBILITY_UNRESOLVED",
      flaggedSide: "white",
    });
    corruptState(
      unresolved,
      ["status", "result"],
      { resultCode: "black_win", terminationReason: "time", winner: "black" },
      "state.status.result",
    );
  });

  it("TST-PERSIST-006 a precedence-unresolved status keeps its facts", () => {
    const stored = store(unresolvedFlag().state);
    const status = {
      kind: "unresolved",
      reason: "TERMINAL_PRECEDENCE_UNRESOLVED",
      facts: [{ kind: "checkmate", winner: "black" }, { kind: "fivefold" }],
    };
    const decoded = decodeGameState(edit(stored.record, ["status"], status), stored.bindings);
    expect(decoded.ok && decoded.value.status).toEqual(status);
    expectCorrupt(
      edit(stored.record, ["status", "facts"], [{ kind: "stalemate" }]),
      stored.bindings,
      "state.status.facts",
    );
  });
});

describe("TST-PERSIST live_game_state.v2 pre-game lifecycle (GAME-START-LIFECYCLE-001)", () => {
  it("TST-PERSIST-020 a record written as v1 still decodes, with the same meaning", () => {
    for (const { name, state } of allFixtures()) {
      const stored = store(state);
      const v1 = edit(stored.record, ["format"], LIVE_GAME_STATE_FORMAT_V1);
      const decoded = decodeGameState(v1, stored.bindings);
      expect(decoded.ok && snapshot(decoded.value), name).toEqual(snapshot(state));
    }
    expect(LIVE_GAME_STATE_FORMAT_V1).toBe("live_game_state.v1");
  });

  it("TST-PERSIST-021 an awaiting game round-trips: sequence 0, the deadline, full balances on a stopped clock", () => {
    const state = awaitingGame();
    const record = encodeGameState(state);
    expect(record).toMatchObject({
      format: "live_game_state.v2",
      sequence: 0,
      status: { kind: "awaiting_players", startDeadlineAtWallMs: START_DEADLINE_MS },
      clock: { running: false, remainingMs: { white: INITIAL_MS, black: INITIAL_MS } },
    });
    expect(snapshot(load(store(state)))).toEqual(snapshot(state));
  });

  it("TST-PERSIST-022 an aborted game round-trips at sequence 1 with no result and untouched balances", () => {
    const aborted = abortIfStartDeadlinePassed(awaitingGame(), wallClockMs(START_DEADLINE_MS));
    if (aborted === null) throw new Error("not aborted");
    const loaded = load(store(aborted));
    expect(loaded.status).toEqual({
      kind: "aborted_before_start",
      reason: "START_DEADLINE_PASSED",
      startDeadlineAtWallMs: START_DEADLINE_MS,
    });
    expect(loaded.sequence).toBe(1);
    expect(snapshot(loaded)).toEqual(snapshot(aborted));
    expect(JSON.stringify(encodeGameState(aborted))).not.toMatch(/result|winner|resultCode/);
  });

  it("TST-PERSIST-023 a pre-game status is refused in v1, and any pre-game record with play or a running clock is corrupt", () => {
    const state = awaitingGame();
    corruptState(state, ["format"], LIVE_GAME_STATE_FORMAT_V1, "state.status.kind");
    corruptState(state, ["sequence"], 1, "state.sequence");
    corruptState(state, ["clock", "running"], true, "state.clock");
    corruptState(state, ["clock", "remainingMs", "white"], INITIAL_MS - 1, "state.clock");
    corruptState(
      state,
      ["status", "startDeadlineAtWallMs"],
      -1,
      "state.status.startDeadlineAtWallMs",
    );
    corruptState(
      state,
      ["status", "startDeadlineAtWallMs"],
      REMOVE,
      "state.status.startDeadlineAtWallMs",
    );
    corruptState(state, ["lastDrawOfferMove"], 0, "state.lastDrawOfferMove");
    const aborted = abortIfStartDeadlinePassed(state, wallClockMs(START_DEADLINE_MS));
    if (aborted === null) throw new Error("not aborted");
    corruptState(aborted, ["sequence"], 0, "state.sequence");
    corruptState(aborted, ["status", "reason"], "TIMEOUT", "state.status.reason");
    corruptState(aborted, ["status", "result"], { resultCode: "draw" }, "state.status.result");
  });
});

describe("TST-PERSIST corrupted records fail closed", () => {
  it("TST-PERSIST-010 an unknown or missing format version is rejected", () => {
    const { state } = activeWithBindings();
    corruptState(state, ["format"], "live_game_state.v3", "state.format");
    corruptState(state, ["format"], "live_game_state.V2", "state.format");
    corruptState(state, ["format"], REMOVE, "state.format");
    corruptState(state, ["extra"], 1, "state.extra");
    corruptState(state, ["sequence"], REMOVE, "state.sequence");
    for (const record of [null, [], "state", 3]) {
      expectCorrupt(record, [], "state");
    }
  });

  it("TST-PERSIST-011 an invalid or non-canonical FEN is rejected", () => {
    const { state } = activeWithBindings();
    corruptState(state, ["positionFen"], "not a fen", "state.positionFen");
    corruptState(state, ["positionFen"], 42, "state.positionFen");
    const fen = encodeGameState(state).positionFen;
    corruptState(state, ["positionFen"], `${fen} `, "state.positionFen");
    corruptState(state, ["positionFen"], fen.replace(/ (\d+)$/, " 0$1"), "state.positionFen");
  });

  it("TST-PERSIST-012 a repetition history that does not end at the position, or is not canonical, is rejected", () => {
    const { state } = activeWithBindings();
    const history = read(store(state).record, ["repetitionHistory"]);
    if (!Array.isArray(history)) throw new Error("history is an array");
    const keys: readonly Json[] = history;
    const path = "state.repetitionHistory";
    corruptState(state, ["repetitionHistory"], keys.slice(0, -1), path);
    corruptState(state, ["repetitionHistory"], [], path);
    corruptState(state, ["repetitionHistory"], "keys", path);
    corruptState(
      state,
      ["repetitionHistory", 2],
      read(store(state).record, ["repetitionHistory", 1]),
      `${path}[2]`,
    );
    const start = read(store(state).record, ["repetitionHistory", 0]);
    if (typeof start !== "string") throw new Error("keys are strings");
    corruptState(state, ["repetitionHistory", 0], "hello", `${path}[0]`);
    corruptState(state, ["repetitionHistory", 0], `K${start.slice(1)}`, `${path}[0]`);
    corruptState(state, ["repetitionHistory", 0], start.replace(/ -$/, " e3"), `${path}[0]`);
    corruptState(state, ["repetitionHistory", 0], start.replace(" KQkq ", " QKkq "), `${path}[0]`);
  });

  it("TST-PERSIST-013 impossible clock values are rejected", () => {
    const { state } = activeWithBindings();
    corruptState(state, ["clock", "remainingMs", "white"], -1, "state.clock.remainingMs.white");
    corruptState(state, ["clock", "remainingMs", "black"], 1.5, "state.clock.remainingMs.black");
    corruptState(
      state,
      ["clock", "timeControl", "initialMs"],
      0,
      "state.clock.timeControl.initialMs",
    );
    corruptState(
      state,
      ["clock", "timeControl", "kind"],
      "fischer",
      "state.clock.timeControl.kind",
    );
    corruptState(state, ["clock", "anchorMs"], -5, "state.clock.anchorMs");
    corruptState(state, ["clock", "activeSide"], "red", "state.clock.activeSide");
    corruptState(state, ["clock", "running"], "yes", "state.clock.running");
    corruptState(state, ["clock", "running"], false, "state.clock.running");
    corruptState(state, ["clock", "activeSide"], "white", "state.clock.activeSide");
    corruptState(checkmate().state, ["clock", "running"], true, "state.clock.running");
  });

  it("TST-PERSIST-014 invalid sequences are rejected", () => {
    const { state } = activeWithBindings();
    for (const value of [-1, 1.5, "3", null, 2 ** 53]) {
      corruptState(state, ["sequence"], value, "state.sequence");
    }
    corruptState(state, ["lastDrawOfferMove"], -1, "state.lastDrawOfferMove");
    corruptState(state, ["lastDrawOfferMove"], 9, "state.lastDrawOfferMove");
  });

  it("TST-PERSIST-015 malformed results are rejected", () => {
    const mate = checkmate().state;
    const result = ["status", "result"];
    corruptState(mate, [...result, "winner"], "white", "state.status.result.winner");
    corruptState(
      mate,
      [...result, "terminationReason"],
      "abandonment",
      "state.status.result.terminationReason",
    );
    corruptState(mate, [...result, "resultCode"], "aborted", "state.status.result.resultCode");
    corruptState(mate, [...result, "winner"], REMOVE, "state.status.result.winner");
    const agreed = drawAgreed().state;
    corruptState(
      agreed,
      [...result, "drawRuleDetails"],
      ["stalemate"],
      "state.status.result.drawRuleDetails",
    );
    const rule = { resultCode: "draw", terminationReason: "draw_rule" };
    const details = "state.status.result.drawRuleDetails";
    corruptState(agreed, result, { ...rule, drawRuleDetails: [] }, details);
    corruptState(agreed, result, { ...rule, drawRuleDetails: ["stalemate", "stalemate"] }, details);
    corruptState(agreed, result, { ...rule, drawRuleDetails: ["agreed"] }, `${details}[0]`);
    corruptState(
      unresolvedFlag().state,
      ["status"],
      {
        kind: "finished",
        result: { resultCode: "white_win", terminationReason: "checkmate", winner: "white" },
      },
      "state.status.result",
    );
  });

  it("TST-PERSIST-016 invalid ids and leases are rejected without echoing them", () => {
    const { state } = activeWithBindings();
    const reason = corruptState(
      state,
      ["controlLeases", "white"],
      "bad lease!",
      "state.controlLeases.white",
    );
    expect(reason).not.toContain("bad lease!");
    corruptState(state, ["controlLeases", "black"], "lease-white-1", "state.controlLeases");
    corruptState(state, ["controlLeases", "white"], REMOVE, "state.controlLeases.white");
    corruptState(state, ["players", "black"], "player-alice", "state.players");
    corruptState(state, ["players", "white"], "", "state.players.white");
    corruptState(state, ["gameId"], "game 1", "state.gameId");
    corruptState(state, ["rulesetId"], "FIDE-2099", "state.rulesetId");
  });

  it("TST-PERSIST-017 impossible enums and status combinations are rejected", () => {
    const { state } = activeWithBindings();
    corruptState(state, ["status", "kind"], "paused", "state.status.kind");
    corruptState(state, ["status"], "active", "state.status");
    const unresolved = unresolvedFlag().state;
    corruptState(unresolved, ["status", "reason"], "MAYBE", "state.status.reason");
    corruptState(unresolved, ["status", "flaggedSide"], "red", "state.status.flaggedSide");
    const mate = checkmate().state;
    let activeMate = edit(store(mate).record, ["status"], { kind: "active" });
    activeMate = edit(
      edit(activeMate, ["clock", "running"], true),
      ["clock", "activeSide"],
      "white",
    );
    expectCorrupt(activeMate, store(mate).bindings, "state.status");
  });

  it("TST-PERSIST-018 draw-offer state that the core cannot produce is rejected", () => {
    const offered = pendingOffer().state;
    const offer = "state.pendingDrawOffer";
    corruptState(offered, ["pendingDrawOffer", "offeredTo"], "black", offer);
    corruptState(offered, ["pendingDrawOffer", "offeredBy"], "white", offer);
    corruptState(offered, ["pendingDrawOffer", "createdAtSequence"], 99, offer);
    corruptState(offered, ["pendingDrawOffer", "offeredBy"], "grey", `${offer}.offeredBy`);
    corruptState(offered, ["lastDrawOfferMove"], null, offer);
    corruptState(offered, ["pendingDrawOffer"], "yes", offer);
    corruptState(
      drawAgreed().state,
      ["pendingDrawOffer"],
      { offeredBy: "black", offeredTo: "white", createdAtSequence: 3 },
      offer,
    );
  });

  it("TST-PERSIST-019 malformed binding records and responses are rejected", () => {
    corruptBinding(["ordinal"], 5, "bindings[0].ordinal");
    corruptBinding(["seat"], "green", "bindings[0].seat");
    corruptBinding(["fingerprint"], "", "bindings[0].fingerprint");
    corruptBinding(["boundAtSequence"], 2, "bindings[0].boundAtSequence");
    corruptBinding(["clientCommandId"], "no spaces allowed", "bindings[0].clientCommandId");
    corruptBinding(["response", "replayedResponse"], true, "bindings[0].response.replayedResponse");
    corruptBinding(
      ["response", "clientCommandId"],
      "other-id",
      "bindings[0].response.clientCommandId",
    );
    corruptBinding(["response", "san"], REMOVE, "bindings[0].response.san");
    corruptBinding(["response", "san"], "e4; DROP", "bindings[0].response.san");
    corruptBinding(["response", "code"], "Maybe", "bindings[0].response.code");
    corruptBinding(["response", "detail"], "because", "bindings[0].response.detail");
    corruptBinding(["response", "command"], "TeleportCommand.v1", "bindings[0].response.command");
    corruptBinding(["response", "positionFen"], "8/8/8/8 w", "bindings[0].response.positionFen");
    corruptBinding(["response", "gameId"], "game-2", "bindings[0].response.gameId");
    corruptBinding(
      ["response", "clock", "remainingMs", "white"],
      -1,
      "bindings[0].response.clock.remainingMs.white",
    );
    corruptBinding(["response", "status", "kind"], "paused", "bindings[0].response.status.kind");
    corruptBinding(["response"], "Accepted", "bindings[0].response");
  });

  it("TST-PERSIST-020 binding order and uniqueness are checked across records", () => {
    const stored = store(activeWithBindings().state);
    const [first, second] = stored.bindings;
    if (first === undefined || second === undefined) throw new Error("fixture has bindings");
    expectCorrupt(stored.record, [first, edit(first, ["ordinal"], 1)], "bindings[1]");
    expectCorrupt(stored.record, [second, first], "bindings[0].ordinal");
    expectCorrupt(stored.record, ["binding"], "bindings[0]");
    const late = edit(edit(first, ["boundAtSequence"], 99), ["response", "sequence"], 99);
    expectCorrupt(stored.record, [late], "bindings[0].response.sequence");
  });

  it("TST-PERSIST-021 decoding either rejects a mutated record or reproduces it exactly: nothing is repaired", () => {
    const fixtures = allFixtures().map(({ state }) => store(state));
    const leaves = (node: Json, path: Path): Path[] => {
      if (Array.isArray(node)) {
        const items: readonly Json[] = node;
        return [path, ...items.flatMap((item, index) => leaves(item, [...path, index]))];
      }
      if (typeof node === "object" && node !== null) {
        return [
          path,
          ...Object.entries(node).flatMap(([key, value]) => leaves(value, [...path, key])),
        ];
      }
      return [path];
    };
    fc.assert(
      fc.property(
        fc.nat({ max: fixtures.length - 1 }),
        fc.nat(),
        fc.oneof(
          fc.jsonValue({ maxDepth: 2 }),
          fc.integer({ min: -3, max: 400 }),
          fc.constantFrom("white", "black", "active", null),
        ),
        (fixtureIndex, leafIndex, value) => {
          const stored = fixtures[fixtureIndex];
          if (stored === undefined) throw new Error("fixture index");
          const paths = leaves(stored.record, []).filter((path) => path.length > 0);
          const path = paths[leafIndex % paths.length];
          if (path === undefined) throw new Error("leaf index");
          const record = viaJson(edit(stored.record, path, viaJson(value)));
          const decoded = decodeGameState(record, stored.bindings);
          if (decoded.ok) {
            expect(viaJson(encodeGameState(decoded.value))).toEqual(record);
          } else {
            expect(decoded.error.kind).toBe("corrupt_state");
          }
        },
      ),
      { numRuns: 400, seed: 20260928 },
    );
  });
});
