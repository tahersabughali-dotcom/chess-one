import {
  type ActiveGameState,
  type ClockDomainId,
  type CommitPlan,
  encodeBinding,
  encodeGameState,
  isClockDomainId,
  planCommit,
} from "@chess-one/live-game";
import {
  type LiveGameDatabase,
  PostgresLiveGameRepository,
} from "@chess-one/live-game-persistence";
import { describe, expect, it } from "vitest";
import { GAME_ID, moveCommand, newGame, playMoves, submit } from "../live-game/support/harness.ts";
import { edit, viaJson } from "./support/json.ts";
import {
  driverError,
  RecordingDriver,
  type Responder,
  recordingDatabase,
} from "./support/recording-driver.ts";
import { activeWithBindings } from "./support/states.ts";

const DOMAIN: ClockDomainId = (() => {
  const id = "writer-boot-a";
  if (!isClockDomainId(id)) throw new Error("clock domain");
  return id;
})();

const EVENT_ID = "3f2c7c1e-8a4b-4c1d-9e2f-0123456789ab";

function repositoryWith(respond: Responder): {
  readonly driver: RecordingDriver;
  readonly repository: PostgresLiveGameRepository;
} {
  const driver = new RecordingDriver(respond);
  return {
    driver,
    repository: new PostgresLiveGameRepository(recordingDatabase<LiveGameDatabase>(driver)),
  };
}

/** The rows PostgreSQL would return for `state`: bigint as text, jsonb parsed. */
function rowsFor(state: ActiveGameState) {
  const record = encodeGameState(state);
  const text = (value: string): string => value;
  return {
    game: {
      game_id: text(state.gameId),
      state_format: text(record.format),
      ruleset_id: text(state.rulesetId),
      white_player_id: text(state.players.white),
      black_player_id: text(state.players.black),
      sequence: String(state.sequence),
      status_kind: text(state.status.kind),
      position_fen: record.positionFen,
      clock_domain_id: text(DOMAIN),
      state: viaJson(record),
      created_at: "2026-09-28T00:00:00.000Z",
      updated_at: "2026-09-28T00:00:00.000Z",
    },
    bindings: state.commandBindings.map((binding, index) => {
      const stored = encodeBinding(binding, index);
      return {
        game_id: text(state.gameId),
        seat: stored.seat,
        client_command_id: stored.clientCommandId,
        binding_ordinal: index,
        record_format: text(record.format),
        fingerprint: stored.fingerprint,
        bound_at_sequence: String(stored.boundAtSequence),
        response: stored.response,
        created_at: "2026-09-28T00:00:00.000Z",
      };
    }),
  };
}

type Rows = ReturnType<typeof rowsFor>;

function loadResponder(rows: Rows | null): Responder {
  return (sql) => {
    if (sql.startsWith('select * from "live_games"'))
      return { rows: rows === null ? [] : [rows.game] };
    if (sql.startsWith('select * from "live_game_command_bindings"')) {
      return { rows: rows?.bindings ?? [] };
    }
    throw new Error(`unexpected query ${sql}`);
  };
}

type FailAt = "update" | "binding" | "outbox" | null;

function commitResponder(failAt: FailAt, code: string | null, updated = 1n): Responder {
  return (sql) => {
    if (sql.startsWith('update "live_games"')) {
      if (failAt === "update") throw driverError(code);
      return { numAffectedRows: updated };
    }
    if (sql.startsWith('insert into "live_game_command_bindings"')) {
      if (failAt === "binding") throw driverError(code);
      return { numAffectedRows: 1n };
    }
    if (sql.startsWith('insert into "outbox_events"')) {
      if (failAt === "outbox") throw driverError(code);
      return { rows: [{ event_id: EVENT_ID }], numAffectedRows: 1n };
    }
    throw new Error(`unexpected query ${sql}`);
  };
}

function finishingPlan(): CommitPlan {
  const before = playMoves(newGame(), ["f2f3", "e7e5", "g2g4"]);
  const mate = submit(before.state, moveCommand(before.state, "d8h4"), before.time + 10);
  const plan = planCommit(before.state, mate.nextState, mate.events);
  if (plan === null) throw new Error("finishing move writes");
  return plan;
}

function bindOnlyPlan(): CommitPlan {
  const game = newGame();
  const bad = submit(game, moveCommand(game, "e2e4", { promotionPiece: "q" }), 1_010);
  const plan = planCommit(game, bad.nextState, bad.events);
  if (plan === null) throw new Error("bound rejection writes");
  return plan;
}

describe("TST-PERSIST PostgreSQL adapter protocol (recording driver, not PostgreSQL)", () => {
  it("TST-PERSIST-060 a load is one read-only REPEATABLE READ transaction with bound parameters", async () => {
    const { state } = activeWithBindings();
    const { driver, repository } = repositoryWith(loadResponder(rowsFor(state)));
    const loaded = await repository.loadGame(GAME_ID);
    expect(loaded.ok && encodeGameState(loaded.value.state)).toEqual(encodeGameState(state));
    expect(loaded.ok && loaded.value.clockDomainId).toBe(DOMAIN);
    expect(driver.steps[0]).toEqual({
      kind: "begin",
      settings: { isolationLevel: "repeatable read", accessMode: "read only" },
    });
    expect(driver.steps.at(-1)).toEqual({ kind: "commit" });
    expect(driver.queries().map((query) => query.sql)).toEqual([
      'select * from "live_games" where "game_id" = $1',
      'select * from "live_game_command_bindings" where "game_id" = $1 order by "binding_ordinal"',
    ]);
    for (const query of driver.queries()) {
      expect(query.parameters).toEqual([GAME_ID]);
      expect(query.sql).not.toContain(GAME_ID);
    }
  });

  it("TST-PERSIST-061 a missing game reads only the game row", async () => {
    const { driver, repository } = repositoryWith(loadResponder(null));
    expect(await repository.loadGame(GAME_ID)).toEqual({
      ok: false,
      error: { kind: "game_not_found" },
    });
    expect(driver.queries()).toHaveLength(1);
  });

  it("TST-PERSIST-062 typed columns that disagree with the record, or malformed column values, are corruption", async () => {
    const rows = rowsFor(activeWithBindings().state);
    const [binding] = rows.bindings;
    if (binding === undefined) throw new Error("fixture has bindings");
    const cases: readonly [Rows, string][] = [
      [{ ...rows, game: { ...rows.game, sequence: "04" } }, "row.sequence"],
      [{ ...rows, game: { ...rows.game, sequence: "9" } }, "row.sequence"],
      [{ ...rows, game: { ...rows.game, sequence: "-1" } }, "row.sequence"],
      [{ ...rows, game: { ...rows.game, status_kind: "finished" } }, "row.status_kind"],
      [
        { ...rows, game: { ...rows.game, position_fen: "8/8/8/8/8/8/8/8 w - - 0 1" } },
        "row.position_fen",
      ],
      [{ ...rows, game: { ...rows.game, white_player_id: "player-zed" } }, "row.white_player_id"],
      [{ ...rows, game: { ...rows.game, clock_domain_id: "no spaces" } }, "row.clock_domain_id"],
      [{ ...rows, game: { ...rows.game, game_id: "game-9" } }, "row.game_id"],
      [{ ...rows, bindings: [{ ...binding, record_format: "v0" }] }, "bindings[0].record_format"],
      [
        { ...rows, bindings: [{ ...binding, bound_at_sequence: "1.0" }] },
        "bindings[0].bound_at_sequence",
      ],
      [{ ...rows, bindings: [{ ...binding, binding_ordinal: 3 }] }, "bindings[0].ordinal"],
      [
        { ...rows, game: { ...rows.game, state: edit(rows.game.state, ["format"], "v2") } },
        "state.format",
      ],
    ];
    for (const [corrupt, path] of cases) {
      const { repository } = repositoryWith(loadResponder(corrupt));
      expect(await repository.loadGame(GAME_ID), path).toMatchObject({
        ok: false,
        error: { kind: "corrupt_state", path },
      });
    }
  });

  it("TST-PERSIST-063 a driver failure is reported by SQLSTATE only, and the read rolls back", async () => {
    const { driver, repository } = repositoryWith(() => {
      throw driverError("08006");
    });
    const loaded = await repository.loadGame(GAME_ID);
    expect(loaded).toEqual({
      ok: false,
      error: { kind: "persistence_failure", operation: "load", code: "08006" },
    });
    expect(JSON.stringify(loaded)).not.toContain("hunter2");
    expect(driver.steps.at(-1)).toEqual({ kind: "rollback" });
  });

  it("TST-PERSIST-064 a finishing transition is one transaction: compare-and-set, binding, outbox", async () => {
    const plan = finishingPlan();
    if (plan.kind !== "transition") throw new Error("transition");
    const { driver, repository } = repositoryWith(commitResponder(null, null));
    const committed = await repository.commitDecision(plan, DOMAIN);
    expect(committed).toEqual({ ok: true, value: { eventIds: [EVENT_ID] } });
    expect(driver.kinds()).toEqual([
      "begin",
      'update "live_games" set',
      'insert into "live_game_command_bindings"',
      'insert into "outbox_events"',
      "commit",
    ]);
    const [update, binding, outbox] = driver.queries();
    expect(update?.sql).toBe(
      'update "live_games" set "sequence" = $1, "status_kind" = $2, "position_fen" = $3, "state" = $4, "clock_domain_id" = $5, "updated_at" = now() where "game_id" = $6 and "sequence" = $7',
    );
    expect(update?.parameters).toEqual([
      plan.state.sequence,
      "finished",
      encodeGameState(plan.state).positionFen,
      JSON.stringify(encodeGameState(plan.state)),
      DOMAIN,
      GAME_ID,
      String(plan.expectedSequence),
    ]);
    expect(binding?.parameters).toContain(plan.binding?.clientCommandId);
    expect(outbox?.sql).toContain('returning "event_id"');
    expect(outbox?.parameters.slice(0, 5)).toEqual([
      "game.finished",
      1,
      "live_game",
      GAME_ID,
      plan.state.sequence,
    ]);
    for (const query of driver.queries()) {
      expect(query.sql).not.toContain(GAME_ID);
      expect(query.sql).not.toContain("rnbqkbnr");
    }
  });

  it("TST-PERSIST-065 a bind-only commit locks the row on its sequence and changes only audit time", async () => {
    const plan = bindOnlyPlan();
    const { driver, repository } = repositoryWith(commitResponder(null, null));
    expect(await repository.commitDecision(plan, DOMAIN)).toEqual({
      ok: true,
      value: { eventIds: [] },
    });
    const [update] = driver.queries();
    expect(update?.sql).toBe(
      'update "live_games" set "updated_at" = now() where "game_id" = $1 and "sequence" = $2',
    );
    expect(update?.parameters).toEqual([GAME_ID, "0"]);
    expect(driver.kinds()).toEqual([
      "begin",
      'update "live_games" set',
      'insert into "live_game_command_bindings"',
      "commit",
    ]);
  });

  it("TST-PERSIST-066 a compare-and-set miss rolls back before any insert and is a concurrency conflict", async () => {
    const plan = finishingPlan();
    const { driver, repository } = repositoryWith(commitResponder(null, null, 0n));
    expect(await repository.commitDecision(plan, DOMAIN)).toEqual({
      ok: false,
      error: { kind: "concurrency_conflict", expectedSequence: plan.expectedSequence },
    });
    expect(driver.kinds()).toEqual(["begin", 'update "live_games" set', "rollback"]);
  });

  it("TST-PERSIST-067 a failure at the state update, binding insert, or outbox insert rolls back everything", async () => {
    const cases: readonly [FailAt, string | null, string][] = [
      ["update", "57014", "persistence_failure"],
      ["update", "40001", "concurrency_conflict"],
      ["update", "40P01", "concurrency_conflict"],
      ["binding", "23505", "concurrency_conflict"],
      ["binding", "23514", "persistence_failure"],
      ["outbox", "23505", "concurrency_conflict"],
      ["outbox", "53100", "persistence_failure"],
      ["outbox", null, "persistence_failure"],
    ];
    for (const [failAt, code, kind] of cases) {
      const plan = finishingPlan();
      const { driver, repository } = repositoryWith(commitResponder(failAt, code));
      const committed = await repository.commitDecision(plan, DOMAIN);
      const label = `${failAt} ${code}`;
      expect(committed, label).toMatchObject({ ok: false, error: { kind } });
      if (kind === "persistence_failure") {
        expect(committed, label).toEqual({
          ok: false,
          error: { kind, operation: "commit", code },
        });
      }
      expect(JSON.stringify(committed), label).not.toContain("hunter2");
      expect(driver.steps.at(-1), label).toEqual({ kind: "rollback" });
      expect(driver.kinds(), label).not.toContain("commit");
    }
  });

  it("TST-PERSIST-068 an outbox row without a valid event id rolls the commit back", async () => {
    const plan = finishingPlan();
    const { driver, repository } = repositoryWith((sql, parameters) =>
      sql.startsWith('insert into "outbox_events"')
        ? { rows: [{ event_id: "not-a-uuid" }] }
        : commitResponder(null, null)(sql, parameters),
    );
    expect(await repository.commitDecision(plan, DOMAIN)).toEqual({
      ok: false,
      error: { kind: "persistence_failure", operation: "commit", code: null },
    });
    expect(driver.steps.at(-1)).toEqual({ kind: "rollback" });
  });

  it("TST-PERSIST-069 creating a game inserts its row in one transaction; a duplicate id is reported", async () => {
    const created = repositoryWith(() => ({ numAffectedRows: 1n }));
    expect(await created.repository.createGame(newGame(), DOMAIN)).toEqual({
      ok: true,
      value: null,
    });
    expect(created.driver.kinds()).toEqual(["begin", 'insert into "live_games"', "commit"]);
    const duplicate = repositoryWith(() => {
      throw driverError("23505");
    });
    expect(await duplicate.repository.createGame(newGame(), DOMAIN)).toEqual({
      ok: false,
      error: { kind: "game_already_exists" },
    });
    expect(duplicate.driver.steps.at(-1)).toEqual({ kind: "rollback" });
    const failed = repositoryWith(() => {
      throw driverError("28P01");
    });
    expect(await failed.repository.createGame(newGame(), DOMAIN)).toEqual({
      ok: false,
      error: { kind: "persistence_failure", operation: "create", code: "28P01" },
    });
  });
});
