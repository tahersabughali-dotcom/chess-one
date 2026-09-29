import type {
  ActiveGameState,
  ControlLeaseId,
  Seat,
  SubmitMoveCommandV1,
} from "@chess-one/live-game";
import type {
  CommandOutcome,
  GameControlPort,
  LeaseOutcome,
  ReplayOutcome,
} from "@chess-one/live-game-runtime";
import { describe, expect, it } from "vitest";
import {
  GAME_ID,
  LEASES,
  moveCommand,
  newGame,
  ROTATED_WHITE_LEASE,
  withRotatedLease,
} from "../live-game/support/harness.ts";
import {
  DOMAIN_OLD,
  decided,
  type RuntimeHarness,
  runtimeHarness,
  store,
  storedState,
  submitAs,
  viewOf,
} from "../realtime/support/runtime.ts";

function controlOf(h: RuntimeHarness): GameControlPort {
  const writer = h.registry.acquire(GAME_ID);
  if (writer === null) throw new Error("no writer");
  return writer;
}

function applyLease(
  writer: GameControlPort,
  seat: Seat,
  lease: ControlLeaseId,
): { accepted: boolean; outcome: Promise<LeaseOutcome>; syncReply: boolean } {
  const answer = Promise.withResolvers<LeaseOutcome>();
  let syncReply = false;
  let returned = false;
  const ingress = writer.applyControlLease(seat, lease, (outcome) => {
    syncReply = !returned;
    answer.resolve(outcome);
  });
  returned = true;
  return { accepted: ingress.accepted, outcome: answer.promise, syncReply };
}

function replay(
  writer: GameControlPort,
  state: ActiveGameState,
  seat: Seat,
  command: SubmitMoveCommandV1,
): Promise<ReplayOutcome> {
  const answer = Promise.withResolvers<ReplayOutcome>();
  const { controlLeaseId: _lease, ...leaseless } = command;
  const participant = { gameId: state.gameId, playerId: state.players[seat], seat };
  const ingress = writer.replayCommand(participant, leaseless, answer.resolve);
  if (!ingress.accepted) throw new Error(`replay refused: ${ingress.reason}`);
  return answer.promise;
}

function withoutBindings(state: ActiveGameState): unknown {
  const { commandBindings: _bindings, controlLeases: _leases, ...rest } = state;
  return rest;
}

describe("TST-GACC-RT control lease at the writer (admission linearization point)", () => {
  it("TST-GACC-RT-001 once a rotation is queued, the old lease is refused synchronously: no queue entry, stamp, clock effect, sequence, or binding", async () => {
    const h = runtimeHarness();
    const s0 = newGame();
    await store(h, s0);
    const writer = controlOf(h);
    await viewOf(writer);
    const before = await storedState(h);
    const rotation = applyLease(writer, "white", ROTATED_WHITE_LEASE);
    expect(rotation.accepted).toBe(true);
    const queued = h.registry.peek(GAME_ID)?.queuedRequests ?? -1;
    h.clock.advance(5_000);
    const stale = submitAs(writer, s0, "white", moveCommand(s0, "e2e4"));
    expect(stale.ingress).toEqual({ accepted: false, reason: "control_not_held" });
    expect(h.registry.peek(GAME_ID)?.queuedRequests).toBe(queued);
    expect(h.facts.count("command_refused_control")).toBe(1);
    expect(await rotation.outcome).toEqual({ kind: "applied" });
    const after = await storedState(h);
    expect(after.controlLeases).toEqual({ white: ROTATED_WHITE_LEASE, black: LEASES.black });
    expect(after.sequence).toBe(before.sequence);
    expect(after.clock).toEqual(before.clock);
    expect(after.position).toEqual(before.position);
    expect(after.history).toEqual(before.history);
    expect(after.status).toEqual(before.status);
    expect(after.commandBindings).toEqual([]);
    expect(h.facts.count("control_lease_rotated")).toBe(1);
  });

  it("TST-GACC-RT-002 the new lease is admitted while its rotation is still queued, and plays after it", async () => {
    const h = runtimeHarness();
    const s0 = newGame();
    await store(h, s0);
    const writer = controlOf(h);
    await viewOf(writer);
    const rotation = applyLease(writer, "white", ROTATED_WHITE_LEASE);
    const next = withRotatedLease(s0, "white", ROTATED_WHITE_LEASE);
    const move = submitAs(
      writer,
      next,
      "white",
      moveCommand(s0, "e2e4", { controlLeaseId: ROTATED_WHITE_LEASE }),
    );
    expect(move.ingress).toMatchObject({ accepted: true });
    expect(await rotation.outcome).toEqual({ kind: "applied" });
    expect((await decided(move)).code).toBe("Accepted");
    expect((await storedState(h)).sequence).toBe(1);
  });

  it("TST-GACC-RT-003 a cold writer admits provisionally and refuses at job start, before the core: nothing decided or bound", async () => {
    const h = runtimeHarness();
    const s0 = newGame();
    await store(h, withRotatedLease(s0, "white", ROTATED_WHITE_LEASE));
    const writer = controlOf(h);
    const stale = submitAs(writer, s0, "white", moveCommand(s0, "e2e4"));
    expect(stale.ingress).toMatchObject({ accepted: true });
    const outcome: CommandOutcome = await stale.outcome;
    expect(outcome).toEqual({ kind: "control_not_held" });
    const stored = await storedState(h);
    expect(stored.sequence).toBe(0);
    expect(stored.commandBindings).toEqual([]);
    expect(h.repository.commits).toBe(0);
  });

  it("TST-GACC-RT-004 applying the lease the writer already holds answers at once and writes nothing", async () => {
    const h = runtimeHarness();
    await store(h, newGame());
    const writer = controlOf(h);
    await viewOf(writer);
    const same = applyLease(writer, "white", LEASES.white);
    expect(same.syncReply).toBe(true);
    expect(await same.outcome).toEqual({ kind: "applied" });
    expect(h.repository.commits).toBe(0);
  });

  it("TST-GACC-RT-005 a rotation works while the game is paused for recovery and grants no resume", async () => {
    const h = runtimeHarness();
    const s0 = newGame();
    await store(h, s0, DOMAIN_OLD);
    const writer = controlOf(h);
    expect((await viewOf(writer)).recoveryReason).not.toBeNull();
    expect(await applyLease(writer, "white", ROTATED_WHITE_LEASE).outcome).toEqual({
      kind: "applied",
    });
    expect((await storedState(h)).controlLeases.white).toBe(ROTATED_WHITE_LEASE);
    const view = await viewOf(writer);
    expect(view.recoveryReason).not.toBeNull();
    expect(view.condition).not.toBe("running");
    const next = withRotatedLease(s0, "white", ROTATED_WHITE_LEASE);
    const move = submitAs(
      writer,
      next,
      "white",
      moveCommand(s0, "e2e4", { controlLeaseId: ROTATED_WHITE_LEASE }),
    );
    expect(move.ingress.accepted).toBe(true);
    expect((await move.outcome).kind).toBe("recovery_required");
    expect((await storedState(h)).sequence).toBe(0);
  });

  it("TST-GACC-RT-006 replayCommand returns the stored decision for an exact resend under the lease it was bound with; an unbound id is control_not_held", async () => {
    const h = runtimeHarness();
    const s0 = newGame();
    await store(h, s0);
    const writer = controlOf(h);
    const command = moveCommand(s0, "e2e4");
    const first = await decided(submitAs(writer, s0, "white", command));
    expect(first.code).toBe("Accepted");
    expect(await applyLease(writer, "white", ROTATED_WHITE_LEASE).outcome).toEqual({
      kind: "applied",
    });
    const commits = h.repository.commits;
    expect(await replay(writer, s0, "white", command)).toEqual({
      kind: "decided",
      response: { ...first, replayedResponse: true },
    });
    expect(h.facts.count("command_replayed")).toBe(1);
    expect(await replay(writer, s0, "white", { ...command, clientCommandId: "fresh" })).toEqual({
      kind: "control_not_held",
    });
    expect(await replay(writer, s0, "black", command)).toEqual({ kind: "control_not_held" });
    expect(h.repository.commits).toBe(commits);
    expect((await storedState(h)).sequence).toBe(1);
  });

  it("TST-GACC-RT-007 an altered payload under a bound id is identity_conflict, and no replay changes the game", async () => {
    const h = runtimeHarness();
    const s0 = newGame();
    await store(h, s0);
    const writer = controlOf(h);
    const command = moveCommand(s0, "e2e4");
    expect((await decided(submitAs(writer, s0, "white", command))).code).toBe("Accepted");
    await applyLease(writer, "white", ROTATED_WHITE_LEASE).outcome;
    const before = await storedState(h);
    const commits = h.repository.commits;
    const wakes = h.scheduler.pending().length;
    h.clock.advance(4_000);
    expect(await replay(writer, s0, "white", { ...command, toSquare: "e3" })).toEqual({
      kind: "identity_conflict",
    });
    expect(h.facts.count("replay_identity_conflict")).toBe(1);
    expect((await replay(writer, s0, "white", command)).kind).toBe("decided");
    const after = await storedState(h);
    expect(withoutBindings(after)).toEqual(withoutBindings(before));
    expect(after.commandBindings).toEqual(before.commandBindings);
    expect(after.controlLeases).toEqual(before.controlLeases);
    expect(h.repository.commits).toBe(commits);
    expect(h.scheduler.pending().length).toBe(wakes);
  });

  it("TST-GACC-RT-008 a writer started after a restart replays from the stored binding alone", async () => {
    const first = runtimeHarness();
    const s0 = newGame();
    await store(first, s0);
    const command = moveCommand(s0, "e2e4");
    const decision = await decided(submitAs(controlOf(first), s0, "white", command));
    await applyLease(controlOf(first), "white", ROTATED_WHITE_LEASE).outcome;
    const restarted = runtimeHarness({}, first.contract);
    expect(await replay(controlOf(restarted), s0, "white", command)).toEqual({
      kind: "decided",
      response: { ...decision, replayedResponse: true },
    });
    expect(restarted.repository.commits).toBe(0);
    expect((await storedState(restarted)).sequence).toBe(1);
  });
});
