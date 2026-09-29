import type {
  ActiveGameState,
  CommandResponse,
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
import { describe, expect, it, vi } from "vitest";
import {
  GAME_ID,
  INITIAL_MS,
  LEASES,
  moveCommand,
  newGame,
  PLAYERS,
  ROTATED_WHITE_LEASE,
  START_MS,
  withRotatedLease,
} from "../live-game/support/harness.ts";
import { ContractRepository } from "../live-game-persistence/support/contract-repository.ts";
import {
  DOMAIN_A,
  DOMAIN_OLD,
  decided,
  type RuntimeHarness,
  runtimeHarness,
  store,
  storedState,
  storeInPlay,
  submitAs,
  viewOf,
} from "../realtime/support/runtime.ts";

const BOUND_LOOKUP = { accepted: true, receivedAt: null, lookup: "bound" };
const UNRESOLVED_LOOKUP = { accepted: true, receivedAt: null, lookup: "unresolved" };

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

  it("TST-GACC-RT-003 a cold writer takes a command as a lookup with no clock reading; an unbound id under a stale lease is refused at its turn, before the core: nothing received, decided, or bound", async () => {
    const h = runtimeHarness();
    const s0 = newGame();
    await store(h, withRotatedLease(s0, "white", ROTATED_WHITE_LEASE));
    const writer = controlOf(h);
    const reads = h.clock.reads;
    const stale = submitAs(writer, s0, "white", moveCommand(s0, "e2e4"));
    expect(stale.ingress).toEqual({ accepted: true, receivedAt: null, lookup: "unresolved" });
    expect(h.clock.reads).toBe(reads);
    const outcome: CommandOutcome = await stale.outcome;
    expect(outcome).toEqual({ kind: "control_not_held" });
    const stored = await storedState(h);
    expect(stored.sequence).toBe(0);
    expect(stored.commandBindings).toEqual([]);
    expect(h.repository.commits).toBe(0);
    expect(h.facts.count("command_accepted") + h.facts.count("command_rejected")).toBe(0);
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
    await storeInPlay(h, s0);
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
    await storeInPlay(h, s0);
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

  it("TST-GACC-RT-009 the controller under a new lease replays a command bound under the old one from the stored binding, never received, and nothing changes (GACC-016)", async () => {
    const h = runtimeHarness();
    const s0 = newGame();
    await storeInPlay(h, s0);
    const writer = controlOf(h);
    const command = moveCommand(s0, "e2e4");
    const first = await decided(submitAs(writer, s0, "white", command));
    await applyLease(writer, "white", ROTATED_WHITE_LEASE).outcome;
    const current = withRotatedLease(s0, "white", ROTATED_WHITE_LEASE);
    const before = await storedState(h);
    const commits = h.repository.commits;
    const wakes = h.scheduler.pending().length;
    h.clock.advance(2_500);
    const resent = { ...command, controlLeaseId: ROTATED_WHITE_LEASE };
    const replayed = submitAs(writer, current, "white", resent);
    expect(replayed.ingress).toEqual(BOUND_LOOKUP);
    expect(await decided(replayed)).toEqual({ ...first, replayedResponse: true });
    const altered = submitAs(writer, current, "white", { ...resent, toSquare: "e3" });
    expect(altered.ingress).toEqual(BOUND_LOOKUP);
    expect(await altered.outcome).toEqual({ kind: "identity_conflict" });
    expect(await storedState(h)).toEqual(before);
    expect(h.repository.commits).toBe(commits);
    expect(h.scheduler.pending().length).toBe(wakes);
    expect(h.facts.count("command_replayed")).toBe(1);
  });

  it("TST-GACC-RT-008 a writer started after a restart replays from the stored binding alone", async () => {
    const first = runtimeHarness();
    const s0 = newGame();
    await storeInPlay(first, s0);
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

interface PlayedGame {
  readonly h: RuntimeHarness;
  readonly contract: ContractRepository;
  readonly s0: ActiveGameState;
  readonly command: SubmitMoveCommandV1;
  readonly original: CommandResponse;
}

/** A game in play whose white seat bound `e2e4`, received at START_MS + 1000. */
async function playedGame(): Promise<PlayedGame> {
  const contract = new ContractRepository();
  const h = runtimeHarness({}, contract);
  const s0 = newGame();
  await storeInPlay(h, s0);
  const command = moveCommand(s0, "e2e4");
  h.clock.set(START_MS + 1_000);
  const original = await decided(submitAs(controlOf(h), s0, "white", command));
  expect([original.code, original.receivedAtMonotonicMs]).toEqual(["Accepted", START_MS + 1_000]);
  return { h, contract, s0, command, original };
}

/** Everything a replay must leave alone: the stored game, writes, outbox, timers, and deciding facts. */
async function sideEffects(game: PlayedGame): Promise<unknown> {
  const { h, contract } = game;
  return {
    stored: await storedState(h),
    writes: contract.writes().length,
    outbox: contract.outbox.length,
    wakes: h.scheduler.pending().length,
    accepted: h.facts.count("command_accepted"),
    rejected: h.facts.count("command_rejected"),
    rotated: h.facts.count("control_lease_rotated"),
  };
}

describe("TST-GACC-RCPT a historical replay is never an authoritative receipt (Batch 11.3)", () => {
  it("TST-GACC-RCPT-001 the controller's exact resend is replayed from its binding with no clock reading: no receivedAt, no receipt, nothing changes", async () => {
    const game = await playedGame();
    const { h, s0, command, original } = game;
    const before = await sideEffects(game);
    h.clock.advance(7_000);
    const reads = h.clock.reads;
    const resend = submitAs(controlOf(h), s0, "white", command);
    expect(resend.ingress).toEqual(BOUND_LOOKUP);
    expect(h.clock.reads).toBe(reads);
    expect(await decided(resend)).toEqual({ ...original, replayedResponse: true });
    expect(h.clock.reads).toBe(reads);
    expect(await sideEffects(game)).toEqual(before);
    expect(h.facts.count("command_replayed")).toBe(1);
  });

  it("TST-GACC-RCPT-002 the controller's altered payload under a bound id is an identity conflict with no clock reading: no receipt, no response, nothing changes", async () => {
    const game = await playedGame();
    const { h, s0, command } = game;
    const before = await sideEffects(game);
    h.clock.advance(7_000);
    const reads = h.clock.reads;
    const altered = submitAs(controlOf(h), s0, "white", { ...command, toSquare: "e3" });
    expect(altered.ingress).toEqual(BOUND_LOOKUP);
    expect(await altered.outcome).toEqual({ kind: "identity_conflict" });
    expect(h.clock.reads).toBe(reads);
    expect(await sideEffects(game)).toEqual(before);
    expect(h.facts.count("replay_identity_conflict")).toBe(1);
  });

  it("TST-GACC-RCPT-003 a genuinely new command is stamped at ingress with one clock reading, before its load; database latency after the stamp is not charged", async () => {
    const { h } = await playedGame();
    const s1 = await storedState(h);
    h.repository.hold();
    h.clock.set(START_MS + 2_500);
    const reads = h.clock.reads;
    const loads = h.repository.loads;
    const move = submitAs(controlOf(h), s1, "black", moveCommand(s1, "e7e5"));
    expect(move.ingress).toEqual({ accepted: true, receivedAt: START_MS + 2_500 });
    expect(h.clock.reads).toBe(reads + 1);
    expect([h.repository.loads, h.repository.heldLoads]).toEqual([loads + 1, 1]);
    h.clock.advance(5_000);
    h.repository.release();
    const response = await decided(move);
    expect([response.code, response.receivedAtMonotonicMs]).toEqual(["Accepted", START_MS + 2_500]);
    expect(response.clock.remainingMs).toEqual({
      white: INITIAL_MS - 1_000,
      black: INITIAL_MS - 1_500,
    });
  });

  it("TST-GACC-RCPT-004 a replay for a session without control stays read-only, with no clock reading", async () => {
    const game = await playedGame();
    const { h, s0, command, original } = game;
    await applyLease(controlOf(h), "white", ROTATED_WHITE_LEASE).outcome;
    const before = await sideEffects(game);
    h.clock.advance(3_000);
    const reads = h.clock.reads;
    expect(await replay(controlOf(h), s0, "white", command)).toEqual({
      kind: "decided",
      response: { ...original, replayedResponse: true },
    });
    expect(await replay(controlOf(h), s0, "white", { ...command, toSquare: "e3" })).toEqual({
      kind: "identity_conflict",
    });
    expect(h.clock.reads).toBe(reads);
    expect(await sideEffects(game)).toEqual(before);
  });

  it("TST-GACC-RCPT-005 the first request to a writer created after a restart recognizes a bound id as historical: no receipt reading beyond the load", async () => {
    const game = await playedGame();
    const { contract, s0, command, original } = game;
    await game.h.registry.dispose();
    for (const domainId of [DOMAIN_A, DOMAIN_OLD]) {
      const probe = runtimeHarness({}, contract, domainId);
      await probe.registry.activate(GAME_ID);
      const loadReads = probe.clock.reads;
      await probe.registry.dispose();

      const restarted = runtimeHarness({}, contract, domainId);
      const before = await storedState(restarted);
      const resend = submitAs(controlOf(restarted), s0, "white", command);
      expect(resend.ingress).toEqual(UNRESOLVED_LOOKUP);
      expect(restarted.clock.reads).toBe(0);
      expect(await decided(resend)).toEqual({ ...original, replayedResponse: true });
      expect(restarted.clock.reads).toBe(loadReads);
      expect(restarted.repository.commits).toBe(0);
      expect(restarted.facts.count("command_accepted")).toBe(0);
      expect(restarted.facts.count("command_rejected")).toBe(0);
      expect(restarted.facts.count("command_replayed")).toBe(1);
      expect(await storedState(restarted)).toEqual(before);
      await restarted.registry.dispose();
    }
  });

  it("TST-GACC-RCPT-006 a game entering play through startGame has a loaded writer before any command: its first command is stamped at ingress with no load ahead of it", async () => {
    const h = runtimeHarness();
    const started = await h.registry.startGame({
      gameId: GAME_ID,
      players: PLAYERS,
      controlLeases: LEASES,
      timeControl: newGame().clock.timeControl,
    });
    if (!started.ok) throw new Error("game not started");
    const s0 = started.value.state;
    h.repository.hold();
    h.clock.set(START_MS + 1_200);
    const reads = h.clock.reads;
    const loads = h.repository.loads;
    const move = submitAs(controlOf(h), s0, "white", moveCommand(s0, "e2e4"));
    expect(move.ingress).toEqual({ accepted: true, receivedAt: START_MS + 1_200 });
    expect(h.clock.reads).toBe(reads + 1);
    await vi.waitFor(() => expect(h.repository.heldLoads).toBe(1));
    expect(h.repository.loads).toBe(loads + 1);
    h.clock.advance(4_000);
    h.repository.release();
    expect((await decided(move)).receivedAtMonotonicMs).toBe(START_MS + 1_200);
  });

  it("TST-GACC-RCPT-007 a new id reaching a writer that has not loaded the game is never stamped late: not received while the clock runs here, received after the load only when no clock runs here", async () => {
    const running = runtimeHarness();
    const s0 = newGame();
    await store(running, s0);
    const cold = submitAs(controlOf(running), s0, "white", moveCommand(s0, "e2e4"));
    expect(cold.ingress).toEqual(UNRESOLVED_LOOKUP);
    expect(running.clock.reads).toBe(0);
    expect(await cold.outcome).toEqual({ kind: "unavailable", reason: "temporarily_unavailable" });
    expect(running.facts.count("command_not_received")).toBe(1);
    expect(running.repository.commits).toBe(0);
    expect((await storedState(running)).commandBindings).toEqual([]);
    running.clock.set(START_MS + 900);
    const resend = submitAs(controlOf(running), s0, "white", moveCommand(s0, "e2e4"));
    expect(resend.ingress).toEqual({ accepted: true, receivedAt: START_MS + 900 });
    expect([(await decided(resend)).code, (await storedState(running)).sequence]).toEqual([
      "Accepted",
      1,
    ]);

    const restarted = runtimeHarness();
    await store(restarted, s0, DOMAIN_OLD);
    const paused = submitAs(controlOf(restarted), s0, "white", moveCommand(s0, "e2e4"));
    expect(paused.ingress).toEqual(UNRESOLVED_LOOKUP);
    expect(await paused.outcome).toEqual({
      kind: "recovery_required",
      gameId: GAME_ID,
      reason: "RECOVERY_PAUSED_CLOCK_DOMAIN_CHANGED",
    });
    expect(restarted.facts.count("command_not_received")).toBe(0);
    expect(restarted.repository.commits).toBe(0);
    expect((await storedState(restarted)).commandBindings).toEqual([]);
  });

  it("TST-GACC-RCPT-008 a replay after a lease rotation reads no clock and rotates nothing: no clock, state, binding, or outbox effect", async () => {
    const game = await playedGame();
    const { h, s0, command, original } = game;
    await applyLease(controlOf(h), "white", ROTATED_WHITE_LEASE).outcome;
    const before = await sideEffects(game);
    h.clock.advance(9_000);
    const reads = h.clock.reads;
    const resent = { ...command, controlLeaseId: ROTATED_WHITE_LEASE };
    const current = withRotatedLease(s0, "white", ROTATED_WHITE_LEASE);
    const replayed = submitAs(controlOf(h), current, "white", resent);
    expect(replayed.ingress).toEqual(BOUND_LOOKUP);
    expect(await decided(replayed)).toEqual({ ...original, replayedResponse: true });
    const stale = submitAs(controlOf(h), s0, "white", command);
    expect(stale.ingress).toEqual(BOUND_LOOKUP);
    expect(await decided(stale)).toEqual({ ...original, replayedResponse: true });
    expect(h.clock.reads).toBe(reads);
    expect(await sideEffects(game)).toEqual(before);
    expect((await storedState(h)).controlLeases).toEqual({
      white: ROTATED_WHITE_LEASE,
      black: LEASES.black,
    });
  });
});
