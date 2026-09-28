import {
  type ClockDomainId,
  encodeGameFinished,
  executeCommand,
  executeDeadline,
  gameCondition,
  isClockDomainId,
  type LiveGameWriter,
  loadForWriter,
  planCommit,
  startGame,
} from "@chess-one/live-game";
import { describe, expect, it } from "vitest";
import {
  actorFor,
  at,
  duration,
  GAME_ID,
  INITIAL_MS,
  LEASES,
  moveCommand,
  ms,
  newGame,
  PLAYERS,
  REPLACED_LEASE,
  resignCommand,
  START_MS,
  snapshot,
  submit,
} from "../live-game/support/harness.ts";
import { positionOf } from "../rules/support/positions.ts";
import { ContractRepository } from "./support/contract-repository.ts";
import { viaJson } from "./support/json.ts";
import { allFixtures, checkmate, unresolvedFlag } from "./support/states.ts";

function domain(name: string): ClockDomainId {
  if (!isClockDomainId(name)) throw new Error(`invalid clock domain ${name}`);
  return name;
}

const BOOT_A = domain("writer-boot-a");
const BOOT_B = domain("writer-boot-b");

async function started(repository = new ContractRepository()): Promise<LiveGameWriter> {
  const writer = { repository, clockDomainId: BOOT_A };
  const created = await startGame(writer, {
    gameId: GAME_ID,
    players: PLAYERS,
    controlLeases: LEASES,
    timeControl: { kind: "sudden_death", initialMs: duration(INITIAL_MS) },
    startedAtMonotonicMs: ms(START_MS),
  });
  if (!created.ok) throw new Error(`game not started: ${JSON.stringify(created.error)}`);
  return writer;
}

async function stored(writer: LiveGameWriter) {
  const loaded = await writer.repository.loadGame(GAME_ID);
  if (!loaded.ok) throw new Error(`not loaded: ${loaded.error.kind}`);
  return loaded.value;
}

function contract(writer: LiveGameWriter): ContractRepository {
  if (!(writer.repository instanceof ContractRepository)) throw new Error("contract double");
  return writer.repository;
}

describe("TST-PERSIST writer orchestration (contract double, not PostgreSQL)", () => {
  it("TST-PERSIST-050 a started game is stored, and a second start is refused", async () => {
    const writer = await started();
    expect(snapshot((await stored(writer)).state)).toEqual(snapshot(newGame()));
    expect((await stored(writer)).clockDomainId).toBe(BOOT_A);
    const again = await startGame(writer, {
      gameId: GAME_ID,
      players: PLAYERS,
      controlLeases: LEASES,
      timeControl: { kind: "sudden_death", initialMs: duration(INITIAL_MS) },
      startedAtMonotonicMs: ms(START_MS),
    });
    expect(again).toEqual({ ok: false, error: { kind: "game_already_exists" } });
    const invalid = await startGame(writer, {
      gameId: GAME_ID,
      players: { white: PLAYERS.white, black: PLAYERS.white },
      controlLeases: LEASES,
      timeControl: { kind: "sudden_death", initialMs: duration(INITIAL_MS) },
      startedAtMonotonicMs: ms(START_MS),
    });
    expect(invalid.ok).toBe(false);
    expect(contract(writer).writes()).toEqual(["create", "create"]);
  });

  it("TST-PERSIST-051 an accepted command stores exactly the state the pure core decided", async () => {
    const writer = await started();
    const game = newGame();
    const command = moveCommand(game, "e2e4");
    const executed = await executeCommand(
      writer,
      actorFor(game, "white"),
      command,
      at(START_MS + 10),
    );
    expect(executed.ok && executed.value.decision.response.code).toBe("Accepted");
    const expected = submit(game, command, START_MS + 10);
    expect(snapshot((await stored(writer)).state)).toEqual(snapshot(expected.nextState));
    expect(contract(writer).writes()).toEqual(["create", "commit:transition"]);
  });

  it("TST-PERSIST-052 a non-binding rejection writes nothing", async () => {
    const writer = await started();
    const game = newGame();
    const stale = moveCommand(game, "e2e4", { expectedGameSequence: 3 });
    const staleResult = await executeCommand(
      writer,
      actorFor(game, "white"),
      stale,
      at(START_MS + 10),
    );
    expect(staleResult.ok && staleResult.value.decision.response.code).toBe("StaleSequence");
    const replaced = moveCommand(game, "e2e4", { controlLeaseId: REPLACED_LEASE });
    const unauthorized = await executeCommand(
      writer,
      { ...actorFor(game, "white"), controlLeaseId: REPLACED_LEASE },
      replaced,
      at(START_MS + 20),
    );
    expect(unauthorized.ok && unauthorized.value.decision.response.code).toBe("Unauthorized");
    expect(contract(writer).writes()).toEqual(["create"]);
  });

  it("TST-PERSIST-053 a bound rejection stores only its binding, and its retry writes nothing", async () => {
    const writer = await started();
    const game = newGame();
    const bad = moveCommand(game, "e2e4", { promotionPiece: "q" });
    const first = await executeCommand(writer, actorFor(game, "white"), bad, at(START_MS + 10));
    expect(first.ok && first.value.decision.response.code).toBe("InvalidState");
    expect((await stored(writer)).state.sequence).toBe(0);
    expect((await stored(writer)).state.commandBindings).toHaveLength(1);
    const retry = await executeCommand(writer, actorFor(game, "white"), bad, at(START_MS + 90));
    expect(retry.ok && retry.value.decision.response).toMatchObject({
      code: "InvalidState",
      replayedResponse: true,
      receivedAtMonotonicMs: START_MS + 10,
    });
    expect(contract(writer).writes()).toEqual(["create", "commit:bind_only"]);
  });

  it("TST-PERSIST-054 after a restart the game is recovery-paused at its committed balances: a stored command replays, every new decision is refused, nothing is written", async () => {
    const before = await started();
    const game = newGame();
    const command = moveCommand(game, "e2e4");
    const original = await executeCommand(
      before,
      actorFor(game, "white"),
      command,
      at(START_MS + 10),
    );
    if (!original.ok) throw new Error("move not stored");

    const repository = contract(before).restarted();
    const after: LiveGameWriter = { repository, clockDomainId: BOOT_B };
    const replay = await executeCommand(after, actorFor(game, "white"), command, at(5));
    expect(replay.ok).toBe(true);
    expect(replay.ok && viaJson(replay.value.decision.response)).toEqual(
      viaJson({ ...original.value.decision.response, replayedResponse: true }),
    );
    const moved = (await stored(after)).state;
    const paused = {
      kind: "recovery_paused",
      reason: "RECOVERY_PAUSED_CLOCK_DOMAIN_CHANGED",
      remainingMs: { white: INITIAL_MS - 10, black: INITIAL_MS },
      activeSide: "black",
      storedClockDomainId: BOOT_A,
    };
    const loaded = await loadForWriter(after, GAME_ID);
    expect(loaded.ok && loaded.value.condition).toEqual(paused);
    expect(loaded.ok && loaded.value.state.status).toEqual({ kind: "active" });
    const reply = moveCommand(moved, "e7e5");
    expect(await executeCommand(after, actorFor(moved, "black"), reply, at(20))).toEqual({
      ok: false,
      error: paused,
    });
    const resign = resignCommand(moved, "white");
    expect(await executeCommand(after, actorFor(moved, "white"), resign, at(21))).toEqual({
      ok: false,
      error: paused,
    });
    expect(await executeDeadline(after, GAME_ID, ms(10_000_000))).toEqual({
      ok: false,
      error: paused,
    });
    expect(repository.writes()).toEqual([]);
    expect(snapshot((await stored(after)).state)).toEqual(snapshot(moved));
    expect(repository.outbox).toEqual([]);

    const sameDomain: LiveGameWriter = { repository, clockDomainId: BOOT_A };
    const continued = await executeCommand(
      sameDomain,
      actorFor(moved, "black"),
      reply,
      at(START_MS + 20),
    );
    expect(continued.ok && continued.value.decision.response.code).toBe("Accepted");
    expect(repository.writes()).toEqual(["commit:transition"]);
  });

  it("TST-PERSIST-055 the finishing commit stores one outbox event; after a restart nothing adds another", async () => {
    const writer = await started();
    let state = newGame();
    let time = START_MS;
    let finishing = moveCommand(state, "f2f3");
    let eventIds: readonly string[] = [];
    for (const uci of ["f2f3", "e7e5", "g2g4", "d8h4"]) {
      time += 10;
      finishing = moveCommand(state, uci);
      const executed = await executeCommand(
        writer,
        actorFor(state, state.position.sideToMove),
        finishing,
        at(time),
      );
      if (!executed.ok) throw new Error(`${uci} not stored`);
      state = executed.value.decision.nextState;
      eventIds = executed.value.eventIds;
      if (uci === "d8h4") {
        expect(executed.value.decision.events).toHaveLength(1);
        const [event] = executed.value.decision.events;
        expect(contract(writer).outbox.map((row) => JSON.parse(row.payload))).toEqual([
          viaJson(event === undefined ? null : encodeGameFinished(event)),
        ]);
      }
    }
    expect(state.status).toMatchObject({ kind: "finished" });
    expect(eventIds).toEqual([contract(writer).outbox[0]?.eventId]);

    const repository = contract(writer).restarted();
    const after: LiveGameWriter = { repository, clockDomainId: BOOT_B };
    const replay = await executeCommand(after, actorFor(state, "black"), finishing, at(3));
    expect(replay.ok && replay.value.decision.response).toMatchObject({
      code: "Accepted",
      replayedResponse: true,
    });
    expect(replay.ok && replay.value.eventIds).toEqual([]);
    const late = await executeCommand(
      after,
      actorFor(state, "white"),
      moveCommand(state, "a2a3"),
      at(4),
    );
    expect(late.ok && late.value.decision.response.code).toBe("GameAlreadyFinished");
    const deadline = await executeDeadline(after, GAME_ID, ms(10_000_000));
    expect(deadline.ok && deadline.value.decision.flagged).toBe(false);
    expect(repository.writes()).toEqual([]);
    expect(repository.outbox).toHaveLength(1);
  });

  it("TST-PERSIST-056 a decision made on an old sequence is a concurrency conflict and writes nothing", async () => {
    const writer = await started();
    const loaded = await stored(writer);
    const game = loaded.state;
    const one = submit(game, moveCommand(game, "e2e4"), START_MS + 10);
    const two = submit(game, moveCommand(game, "d2d4"), START_MS + 10);
    const planOne = planCommit(game, one.nextState, one.events);
    const planTwo = planCommit(game, two.nextState, two.events);
    if (planOne === null || planTwo === null) throw new Error("both decisions write");
    expect((await writer.repository.commitDecision(planOne, BOOT_A)).ok).toBe(true);
    expect(await writer.repository.commitDecision(planTwo, BOOT_A)).toEqual({
      ok: false,
      error: { kind: "concurrency_conflict", expectedSequence: 0 },
    });
    expect(snapshot((await stored(writer)).state)).toEqual(snapshot(one.nextState));
    const retried = await executeCommand(
      writer,
      actorFor(game, "white"),
      moveCommand(game, "e2e4"),
      at(START_MS + 30),
    );
    expect(retried.ok && retried.value.decision.response.replayedResponse).toBe(true);
  });

  it("TST-PERSIST-057 the writer's flag is stored with its event and no binding", async () => {
    const repository = new ContractRepository();
    const writer: LiveGameWriter = { repository, clockDomainId: BOOT_A };
    const created = await startGame(writer, {
      gameId: GAME_ID,
      players: PLAYERS,
      controlLeases: LEASES,
      timeControl: { kind: "sudden_death", initialMs: duration(1_000) },
      startedAtMonotonicMs: ms(START_MS),
      startPosition: positionOf("4k3/8/8/8/8/8/8/3QK3 b - - 0 1"),
    });
    expect(created.ok).toBe(true);
    const early = await executeDeadline(writer, GAME_ID, ms(START_MS + 999));
    expect(early.ok && early.value.decision.flagged).toBe(false);
    const flagged = await executeDeadline(writer, GAME_ID, ms(START_MS + 1_001));
    expect(flagged.ok && flagged.value.decision.nextState.status).toMatchObject({
      kind: "finished",
      result: { resultCode: "white_win", terminationReason: "time" },
    });
    expect(flagged.ok && flagged.value.eventIds).toHaveLength(1);
    expect((await stored(writer)).state.commandBindings).toEqual([]);
    expect(repository.writes()).toEqual(["create", "commit:transition"]);
  });

  it("TST-PERSIST-058 a missing or corrupt stored game is reported, never decided", async () => {
    const writer = await started();
    const game = newGame();
    const command = moveCommand(game, "e2e4");
    const actor = actorFor(game, "white");
    const repository = contract(writer);
    const text = repository.games.get(GAME_ID);
    if (text === undefined) throw new Error("stored");
    repository.games.set(GAME_ID, {
      ...text,
      record: text.record.replace('"sequence":0', '"sequence":-1'),
    });
    const corrupt = await executeCommand(writer, actor, command, at(START_MS + 10));
    expect(corrupt).toMatchObject({
      ok: false,
      error: { kind: "corrupt_state", path: "state.sequence" },
    });
    repository.games.clear();
    expect(await executeCommand(writer, actor, command, at(START_MS + 10))).toEqual({
      ok: false,
      error: { kind: "game_not_found" },
    });
    expect(repository.writes()).toEqual(["create"]);
  });

  it("TST-PERSIST-059 only a running clock stored by another clock domain is recovery-paused; stopped games keep their condition", () => {
    const otherDomainKinds: string[] = [];
    for (const { name, state } of allFixtures()) {
      const sameDomain = gameCondition({ state, clockDomainId: BOOT_A }, BOOT_A);
      const otherDomain = gameCondition({ state, clockDomainId: BOOT_A }, BOOT_B);
      otherDomainKinds.push(otherDomain.kind);
      if (state.status.kind === "active") {
        expect(sameDomain, name).toEqual({ kind: "running" });
        expect(otherDomain, name).toEqual({
          kind: "recovery_paused",
          reason: "RECOVERY_PAUSED_CLOCK_DOMAIN_CHANGED",
          remainingMs: state.clock.remainingMs,
          activeSide: state.clock.activeSide,
          storedClockDomainId: BOOT_A,
        });
      } else {
        const expected = state.status.kind === "finished" ? "finished" : "rules_unresolved";
        expect(sameDomain, name).toEqual({ kind: expected });
        expect(otherDomain, name).toEqual({ kind: expected });
      }
    }
    expect(otherDomainKinds).toEqual([
      "recovery_paused",
      "recovery_paused",
      "recovery_paused",
      "recovery_paused",
      "finished",
      "finished",
      "rules_unresolved",
    ]);
  });

  it("TST-PERSIST-060 finished and rules-unresolved games under another clock domain are decided normally, never paused", async () => {
    for (const fixture of [checkmate(), unresolvedFlag()]) {
      const repository = new ContractRepository();
      expect((await repository.createGame(fixture.state, BOOT_A)).ok).toBe(true);
      const after: LiveGameWriter = { repository, clockDomainId: BOOT_B };
      const loaded = await loadForWriter(after, GAME_ID);
      expect(loaded.ok && snapshot(loaded.value.state)).toEqual(snapshot(fixture.state));
      const late = await executeCommand(
        after,
        actorFor(fixture.state, "white"),
        resignCommand(fixture.state, "white"),
        at(5),
      );
      expect(late.ok && late.value.decision.response.code, fixture.name).toBe(
        fixture.state.status.kind === "finished"
          ? "GameAlreadyFinished"
          : "MatingPossibilityUnresolved",
      );
      const deadline = await executeDeadline(after, GAME_ID, ms(10_000_000));
      expect(deadline.ok && deadline.value.decision.flagged, fixture.name).toBe(false);
      expect(repository.writes(), fixture.name).toEqual(["create"]);
      expect(repository.outbox, fixture.name).toEqual([]);
    }
  });
});
