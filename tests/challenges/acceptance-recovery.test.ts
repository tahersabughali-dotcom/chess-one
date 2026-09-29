import type { PlayerDirectory, PlayerRecord } from "@chess-one/accounts";
import {
  type Challenge,
  type ChallengeId,
  completeAcceptance,
  isChallengeId,
} from "@chess-one/challenge-domain";
import type {
  ChallengeAcceptance,
  ChallengeError,
  ChallengeGameSpec,
  ChallengeStore,
} from "@chess-one/challenges";
import { type AccountStatus, isUserId, type UserId } from "@chess-one/identity";
import { describe, expect, it } from "vitest";
import { type CheckFault, FakeGameCreator } from "./support/games.ts";
import {
  type ChallengeHarness,
  challengeHarness,
  createInput,
  DAY,
  type Player,
} from "./support/harness.ts";
import { MemoryChallengeStore } from "./support/memory-store.ts";

type AcceptOutcome =
  | { readonly ok: true; readonly value: ChallengeAcceptance }
  | { readonly ok: false; readonly error: ChallengeError };

function uid(text: string): UserId {
  if (!isUserId(text)) throw new Error("not a user id");
  return text;
}

function cid(text: string): ChallengeId {
  if (!isChallengeId(text)) throw new Error("not a challenge id");
  return text;
}

function memoryOf(h: ChallengeHarness): MemoryChallengeStore {
  if (h.memory === null) throw new Error("memory store expected");
  return h.memory;
}

function gamesOf(h: ChallengeHarness): FakeGameCreator {
  if (h.fakeGames === null) throw new Error("fake game creator expected");
  return h.fakeGames;
}

function rowOf(store: MemoryChallengeStore, challengeId: ChallengeId): Challenge {
  const row = store.rows.get(challengeId);
  if (row === undefined) throw new Error("challenge row expected");
  return row;
}

function errorOf(outcome: AcceptOutcome): string | null {
  return outcome.ok ? null : outcome.error.kind;
}

function gameIdOf(outcome: AcceptOutcome): string | null {
  return outcome.ok ? (outcome.value.game?.gameId ?? null) : null;
}

async function created(h: ChallengeHarness, from: Player, to: string): Promise<ChallengeId> {
  const outcome = await h.challenges.create(from.session, createInput(to));
  if (!outcome.ok) throw new Error(`create failed: ${outcome.error.kind}`);
  return cid(outcome.value.challengeId);
}

/**
 * `from` challenges `to`, who accepts while the game's creation is lost: the
 * challenge stays accepting and its game is surely absent.
 */
async function stuck(
  h: ChallengeHarness,
  store: MemoryChallengeStore,
  from: Player,
  to: Player,
): Promise<{ readonly challengeId: ChallengeId; readonly reserved: Challenge }> {
  const challengeId = await created(h, from, to.username);
  gamesOf(h).createFaults.push("lost");
  const first = await h.challenges.accept(to.session, challengeId);
  expect(first.ok && first.value.game).toBeNull();
  const reserved = rowOf(store, challengeId);
  expect(reserved.status).toBe("accepting");
  return { challengeId, reserved };
}

function specOf(challenge: Challenge): ChallengeGameSpec {
  const { acceptance } = challenge;
  if (acceptance === null) throw new Error("reservation expected");
  return {
    gameId: acceptance.gameId,
    white: acceptance.white,
    black: acceptance.black,
    rulesetId: challenge.rulesetId,
    timeControl: challenge.timeControl,
    startDeadlineAt: acceptance.startDeadlineAt,
  };
}

async function setStatus(h: ChallengeHarness, player: Player, status: AccountStatus) {
  expect(await h.accounts.accounts.setAccountStatus(uid(player.userId), status)).toBe(true);
}

/** No challenge fact carries an identity, a secret, or an account's standing. */
function expectPrivateFacts(h: ChallengeHarness, players: readonly Player[]): void {
  const text = JSON.stringify(h.facts.facts);
  for (const player of players) {
    for (const secret of [player.userId, player.token, player.session.sessionId]) {
      expect(text).not.toContain(secret);
    }
  }
  for (const fact of h.facts.facts) {
    expect(
      Object.keys(fact).filter((key) => /user|name$|email|session|token|status/i.test(key)),
    ).toEqual(["name"]);
    for (const [key, value] of Object.entries(fact)) {
      if (key !== "challengeId") expect(String(value)).not.toMatch(/disabled|locked|@/);
    }
  }
}

/** Player lookups that fail while `failing` is set, like an accounts store outage. */
class FlakyPlayers implements PlayerDirectory {
  readonly #inner: PlayerDirectory;
  failing = false;

  constructor(inner: PlayerDirectory) {
    this.#inner = inner;
  }

  findPlayerByUsername(username: Parameters<PlayerDirectory["findPlayerByUsername"]>[0]) {
    return this.#inner.findPlayerByUsername(username);
  }

  async findPlayerById(userId: UserId): Promise<PlayerRecord | null> {
    if (this.failing) throw new Error("accounts store unreachable");
    return this.#inner.findPlayerById(userId);
  }
}

describe("TST-CHAL-REC terminal failure", () => {
  it("TST-CHAL-REC-001 race C: a participant disabled or locked before the game exists fails the acceptance for good: no game, no second id, the reservation kept, one generic answer", async () => {
    const answers = new Set<string>();
    for (const [status, whose] of [
      ["disabled", "challenger"],
      ["locked", "challenger"],
      ["disabled", "challenged"],
      ["locked", "challenged"],
    ] satisfies [AccountStatus, "challenger" | "challenged"][]) {
      const label = `${whose} ${status}`;
      const h = challengeHarness();
      const store = memoryOf(h);
      const alice = await h.player("Alice");
      const bob = await h.player("Bob");
      const { challengeId, reserved } = await stuck(h, store, alice, bob);
      h.accounts.clock.advance(30_000);
      await setStatus(h, whose === "challenger" ? alice : bob, status);
      expect(await h.challenges.reconcileAcceptingChallenge(challengeId), label).toBe(
        "accept_failed",
      );
      const failed = rowOf(store, challengeId);
      expect(failed, label).toEqual({
        ...reserved,
        status: "accept_failed",
        resolvedAt: h.accounts.clock.now(),
      });
      expect(failed.acceptance).toEqual(reserved.acceptance);
      const games = gamesOf(h);
      expect([games.games.size, games.creates], label).toEqual([0, 1]);
      expect(h.facts.named("challenge_accept_failed"), label).toEqual([
        { name: "challenge_accept_failed", challengeId, reason: "participant_unavailable" },
      ]);

      const active = whose === "challenger" ? bob : alice;
      if (whose === "challenger") {
        const retry = await h.challenges.accept(bob.session, challengeId);
        expect(retry, label).toEqual({ ok: false, error: { kind: "challenge_accept_failed" } });
        answers.add(JSON.stringify(retry));
      }
      const read = await h.challenges.get(active.session, challengeId);
      expect(read.ok && read.value, label).toMatchObject({
        status: "accept_failed",
        createdGameId: null,
        viewerSeat: null,
        resolvedAt: h.accounts.clock.now(),
      });
      expect(JSON.stringify(read)).not.toContain(String(reserved.acceptance?.gameId));
      const declined = await h.challenges.decline(bob.session, challengeId);
      const cancelled = await h.challenges.cancel(alice.session, challengeId);
      for (const outcome of [declined, cancelled]) {
        expect(outcome.ok, label).toBe(false);
      }
      h.accounts.clock.advance(DAY * 2);
      expect(await h.challenges.reconcileAcceptingChallenge(challengeId)).toBe("accept_failed");
      expect(await h.challenges.reconcileAcceptingChallenges(10)).toMatchObject({
        listed: true,
        examined: 0,
        next: null,
      });
      expect(rowOf(store, challengeId), label).toEqual(failed);
      expect([games.games.size, games.creates], label).toEqual([0, 1]);
      expectPrivateFacts(h, [alice, bob]);
      expect(h.defects.errors, label).toEqual([]);
    }
    expect(answers.size).toBe(1);
  });

  it("TST-CHAL-REC-002 an account lost between the reservation and the creation: the creator refuses, the game is proven absent, and the first accept already answers the generic failure", async () => {
    const h = challengeHarness();
    const store = memoryOf(h);
    const alice = await h.player("Alice");
    const bob = await h.player("Bob");
    const challengeId = await created(h, alice, "Bob");
    const games = gamesOf(h);
    games.createFaults.push("refused");
    const answer = await h.challenges.accept(bob.session, challengeId);
    expect(answer).toEqual({ ok: false, error: { kind: "challenge_accept_failed" } });
    expect(rowOf(store, challengeId)).toMatchObject({
      status: "accept_failed",
      createdGameId: null,
      acceptance: expect.objectContaining({ gameId: expect.any(String) }),
    });
    expect([games.games.size, games.creates, games.checks]).toEqual([0, 1, 1]);
    expect(h.facts.named("challenge_accept_refused").map((fact) => fact.reason)).toEqual([
      "accept_failed",
    ]);
    const again = await h.challenges.accept(bob.session, challengeId);
    expect(again).toEqual(answer);
    expect([games.creates, games.checks]).toEqual([1, 1]);
    expect(h.defects.errors).toEqual([]);
  });

  it("TST-CHAL-REC-003 race D: an account disabled after the acceptance never rewrites it: the challenge stays accepted with its game", async () => {
    const h = challengeHarness();
    const store = memoryOf(h);
    const alice = await h.player("Alice");
    const bob = await h.player("Bob");
    const challengeId = await created(h, alice, "Bob");
    const accepted = await h.challenges.accept(bob.session, challengeId);
    const gameId = gameIdOf(accepted);
    expect(gameId).not.toBeNull();
    const row = rowOf(store, challengeId);
    for (const status of ["disabled", "locked"] satisfies AccountStatus[]) {
      await setStatus(h, alice, status);
      expect(await h.challenges.reconcileAcceptingChallenge(challengeId)).toBe("accepted");
      expect(await h.challenges.reconcileAcceptingChallenges(10)).toMatchObject({ examined: 0 });
      const retry = await h.challenges.accept(bob.session, challengeId);
      expect(gameIdOf(retry)).toBe(gameId);
      expect(rowOf(store, challengeId)).toEqual(row);
    }
    expect(h.facts.count("challenge_accept_failed")).toBe(0);
    expect(gamesOf(h).games.size).toBe(1);
    expect(h.defects.errors).toEqual([]);
  });

  it("TST-CHAL-REC-004 race E: the game exists but completing failed; reconciliation proves it and accepts, even with an account disabled since", async () => {
    const h = challengeHarness();
    const store = memoryOf(h);
    const alice = await h.player("Alice");
    const bob = await h.player("Bob");
    const challengeId = await created(h, alice, "Bob");
    store.acceptanceFault = { method: "completeAcceptance", mode: "fail" };
    const first = await h.challenges.accept(bob.session, challengeId);
    expect(first.ok && first.value.game).toBeNull();
    const reserved = rowOf(store, challengeId);
    expect(reserved.status).toBe("accepting");
    await setStatus(h, alice, "locked");
    expect(await h.challenges.reconcileAcceptingChallenge(challengeId)).toBe("accepted");
    expect(rowOf(store, challengeId)).toMatchObject({
      status: "accepted",
      createdGameId: reserved.acceptance?.gameId,
      resolvedAt: reserved.acceptance?.acceptedAt,
    });
    const games = gamesOf(h);
    expect([games.games.size, games.creates]).toEqual([1, 1]);
    expect(h.facts.named("challenge_accepted").map((fact) => fact.via)).toEqual(["reconcile"]);
    expect(h.facts.named("challenge_accept_reconciled")).toEqual([
      {
        name: "challenge_accept_reconciled",
        challengeId,
        via: "maintenance",
        outcome: "accepted",
      },
    ]);
    expect(h.defects.errors).toEqual([]);
  });

  it("TST-CHAL-REC-005 race F: a game surely absent with both players eligible is created again with the same id, seats, and settings, by an accept retry or by maintenance", async () => {
    for (const via of ["request", "maintenance"] satisfies ("request" | "maintenance")[]) {
      const h = challengeHarness();
      const store = memoryOf(h);
      const alice = await h.player("Alice");
      const bob = await h.player("Bob");
      const { challengeId, reserved } = await stuck(h, store, alice, bob);
      h.accounts.clock.advance(60_000);
      if (via === "request") {
        const retry = await h.challenges.accept(bob.session, challengeId);
        expect(gameIdOf(retry), via).toBe(reserved.acceptance?.gameId);
      } else {
        expect(await h.challenges.reconcileAcceptingChallenge(challengeId), via).toBe("accepted");
      }
      const games = gamesOf(h);
      expect([...games.games.values()], via).toEqual([specOf(reserved)]);
      expect(games.creates, via).toBe(2);
      expect(rowOf(store, challengeId), via).toEqual(completeAcceptance(reserved));
      expect(h.facts.named("challenge_accept_reconcile_started"), via).toEqual([
        { name: "challenge_accept_reconcile_started", challengeId, via },
      ]);
      expect(
        h.facts.named("challenge_accepted").map((fact) => fact.via),
        via,
      ).toEqual([via === "request" ? "request" : "reconcile"]);
      expect(h.defects.errors).toEqual([]);
    }
  });

  it("TST-CHAL-REC-006 race G: while the game's existence is unknown the challenge stays accepting, however long it takes, and creates nothing", async () => {
    const h = challengeHarness();
    const store = memoryOf(h);
    const alice = await h.player("Alice");
    const bob = await h.player("Bob");
    const { challengeId, reserved } = await stuck(h, store, alice, bob);
    const games = gamesOf(h);
    for (const wait of [0, DAY, 365 * DAY]) {
      h.accounts.clock.advance(wait);
      games.checkFaults.push("unknown", "unknown");
      expect(await h.challenges.reconcileAcceptingChallenge(challengeId)).toBe("processing");
      const retry = await h.challenges.accept(bob.session, challengeId);
      expect(retry.ok && retry.value.game).toBeNull();
      expect(retry.ok && retry.value.challenge.status).toBe("processing");
      expect(rowOf(store, challengeId)).toEqual(reserved);
    }
    expect(games.creates).toBe(1);
    expect(
      h.facts.named("challenge_accept_reconcile_unavailable").map((fact) => fact.cause),
    ).toEqual(Array.from({ length: 6 }, () => "creation_unconfirmed"));
    expect(h.facts.count("challenge_accept_failed")).toBe(0);
    expect(await h.challenges.reconcileAcceptingChallenge(challengeId)).toBe("accepted");
    expect(games.games.size).toBe(1);
    expect(h.defects.errors).toEqual([]);
  });

  it("TST-CHAL-REC-007 race H: another game under the reserved id fails closed: a defect, never accepted, never a second game, whatever field differs", async () => {
    const variants: [string, (spec: ChallengeGameSpec) => ChallengeGameSpec][] = [
      ["seats swapped", (spec) => ({ ...spec, white: spec.black, black: spec.white })],
      ["start deadline", (spec) => ({ ...spec, startDeadlineAt: spec.startDeadlineAt + 1 })],
      [
        "initial time",
        (spec) => ({ ...spec, timeControl: { ...spec.timeControl, initialMs: 600_000 } }),
      ],
    ];
    for (const [label, change] of variants) {
      const h = challengeHarness();
      const store = memoryOf(h);
      const alice = await h.player("Alice");
      const bob = await h.player("Bob");
      const { challengeId, reserved } = await stuck(h, store, alice, bob);
      const games = gamesOf(h);
      const foreign = change(specOf(reserved));
      games.games.set(foreign.gameId, foreign);
      expect(await h.challenges.reconcileAcceptingChallenge(challengeId), label).toBe(
        "accept_failed",
      );
      expect(rowOf(store, challengeId), label).toMatchObject({
        status: "accept_failed",
        createdGameId: null,
        acceptance: reserved.acceptance,
      });
      expect([...games.games.values()], label).toEqual([foreign]);
      expect(games.creates, label).toBe(1);
      expect(h.defects.errors, label).toHaveLength(1);
      expect(
        h.facts.named("challenge_accept_failed").map((fact) => fact.reason),
        label,
      ).toEqual(["game_mismatch"]);
      const retry = await h.challenges.accept(bob.session, challengeId);
      expect(errorOf(retry), label).toBe("challenge_accept_failed");
      expect(h.facts.count("challenge_accepted"), label).toBe(0);
    }
  });
});

describe("TST-CHAL-REC concurrency", () => {
  it("TST-CHAL-REC-008 race A: accept retries against maintenance in one process settle once: one game, one id, one accepted fact", async () => {
    const h = challengeHarness();
    const store = memoryOf(h);
    const alice = await h.player("Alice");
    const bob = await h.player("Bob");
    const { challengeId, reserved } = await stuck(h, store, alice, bob);
    const [first, reconciled, swept, second] = await Promise.all([
      h.challenges.accept(bob.session, challengeId),
      h.challenges.reconcileAcceptingChallenge(challengeId),
      h.challenges.reconcileAcceptingChallenges(10),
      h.challenges.accept(bob.session, challengeId),
    ]);
    const gameId = reserved.acceptance?.gameId;
    expect([gameIdOf(first), gameIdOf(second)]).toEqual([gameId, gameId]);
    expect(reconciled).toBe("accepted");
    expect(swept.failed).toBe(0);
    const games = gamesOf(h);
    expect([games.games.size, games.creates]).toEqual([1, 2]);
    expect(h.facts.count("challenge_accepted")).toBe(1);
    expect(rowOf(store, challengeId)).toEqual(completeAcceptance(reserved));

    const failing = await stuck(h, store, alice, await h.player("Carol"));
    await setStatus(h, alice, "disabled");
    const answers = await Promise.all([
      h.challenges.reconcileAcceptingChallenge(failing.challengeId),
      h.challenges.reconcileAcceptingChallenges(10),
      h.challenges.reconcileAcceptingChallenge(failing.challengeId),
    ]);
    expect([answers[0], answers[2]]).toEqual(["accept_failed", "accept_failed"]);
    expect(rowOf(store, failing.challengeId).status).toBe("accept_failed");
    expect(h.facts.count("challenge_accept_failed")).toBe(1);
    expect(games.games.size).toBe(1);
    expect(h.defects.errors).toEqual([]);
  });

  it("TST-CHAL-REC-009 race B: two workers with their own applications over one store and one game creator: one game, one outcome, one fact", async () => {
    const h = challengeHarness();
    const store = memoryOf(h);
    const alice = await h.player("Alice");
    const bob = await h.player("Bob");
    const games = gamesOf(h);
    const other = challengeHarness({ accounts: h.accounts, store, games });
    const { challengeId, reserved } = await stuck(h, store, alice, bob);
    await Promise.all([
      h.challenges.reconcileAcceptingChallenges(10),
      other.challenges.reconcileAcceptingChallenges(10),
    ]);
    expect(rowOf(store, challengeId)).toEqual(completeAcceptance(reserved));
    expect(games.games.size).toBe(1);
    expect(h.facts.count("challenge_accepted") + other.facts.count("challenge_accepted")).toBe(1);

    const carol = await h.player("Carol");
    const failing = await stuck(h, store, alice, carol);
    await setStatus(h, carol, "locked");
    const outcomes = await Promise.all([
      h.challenges.reconcileAcceptingChallenge(failing.challengeId),
      other.challenges.reconcileAcceptingChallenge(failing.challengeId),
    ]);
    expect(outcomes).toEqual(["accept_failed", "accept_failed"]);
    expect(
      h.facts.count("challenge_accept_failed") + other.facts.count("challenge_accept_failed"),
    ).toBe(1);
    expect(games.games.size).toBe(1);
    expect([...h.defects.errors, ...other.defects.errors]).toEqual([]);
  });

  it("TST-CHAL-REC-010 the maintenance pass is bounded, oldest reservation first with ties by id, resumable by cursor, and idempotent", async () => {
    const h = challengeHarness();
    const store = memoryOf(h);
    const alice = await h.player("Alice");
    const games = gamesOf(h);
    const ids: ChallengeId[] = [];
    for (const [index, name] of ["Bob", "Carol", "Dave", "Erin", "Fred"].entries()) {
      const opponent = await h.player(name);
      if (index !== 4) h.accounts.clock.advance(1_000);
      ids.push((await stuck(h, store, alice, opponent)).challengeId);
    }
    const tied = ids.slice(3).sort();
    const order = [...ids.slice(0, 3), ...tied];
    const started = () =>
      h.facts.named("challenge_accept_reconcile_started").map((fact) => fact.challengeId);

    games.checkFaults.push(...Array.from({ length: 5 }, (): CheckFault => "unknown"));
    const first = await h.challenges.reconcileAcceptingChallenges(2);
    expect(first).toMatchObject({ listed: true, examined: 2, processing: 2, accepted: 0 });
    const secondOldest = order[1];
    if (secondOldest === undefined) throw new Error("five challenges expected");
    expect(first.next).toEqual({
      acceptedAt: rowOf(store, secondOldest).acceptance?.acceptedAt,
      challengeId: secondOldest,
    });
    const second = await h.challenges.reconcileAcceptingChallenges(2, first.next);
    expect(second).toMatchObject({ examined: 2, processing: 2 });
    const third = await h.challenges.reconcileAcceptingChallenges(2, second.next);
    expect(third).toMatchObject({ examined: 1, processing: 1, next: null });
    expect(started()).toEqual(order);
    expect(games.creates).toBe(5);

    const all = await h.challenges.reconcileAcceptingChallenges(100);
    expect(all).toMatchObject({ examined: 5, accepted: 5, failed: 0, processing: 0, next: null });
    expect(games.games.size).toBe(5);
    const settled = ids.map((id) => rowOf(store, id));
    const again = await h.challenges.reconcileAcceptingChallenges(100);
    expect(again).toEqual({
      listed: true,
      examined: 0,
      accepted: 0,
      failed: 0,
      processing: 0,
      next: null,
    });
    expect(ids.map((id) => rowOf(store, id))).toEqual(settled);
    expect(games.games.size).toBe(5);

    for (const limit of [0, -1, 1.5, 101, Number.NaN]) {
      await expect(h.challenges.reconcileAcceptingChallenges(limit), String(limit)).rejects.toThrow(
        RangeError,
      );
    }
    store.failNext = "unavailable";
    expect(await h.challenges.reconcileAcceptingChallenges(10, first.next)).toEqual({
      listed: false,
      examined: 0,
      accepted: 0,
      failed: 0,
      processing: 0,
      next: first.next,
    });
    expect(h.facts.named("challenge_accept_reconcile_unavailable").at(-1)).toEqual({
      name: "challenge_accept_reconcile_unavailable",
      challengeId: null,
      via: "maintenance",
      cause: "store_unavailable",
    });
    expect(await h.challenges.reconcileAcceptingChallenge("not an id")).toBe("not_accepting");
    const pendingId = await created(h, await h.player("Gina"), "Alice");
    expect(await h.challenges.reconcileAcceptingChallenge(pendingId)).toBe("not_accepting");
    expect(rowOf(store, pendingId).status).toBe("pending");
    expect(h.defects.errors).toEqual([]);
  });
});

describe("TST-CHAL-REC failure injection", () => {
  it("TST-CHAL-REC-011 the game creator unreachable right after the reservation: processing, reported, and the same game later", async () => {
    const h = challengeHarness();
    const store = memoryOf(h);
    const alice = await h.player("Alice");
    const bob = await h.player("Bob");
    const challengeId = await created(h, alice, "Bob");
    const games = gamesOf(h);
    games.createFaults.push("throw");
    games.checkFaults.push("throw");
    const first = await h.challenges.accept(bob.session, challengeId);
    expect(first.ok && first.value.game).toBeNull();
    expect(h.defects.errors).toHaveLength(2);
    const reserved = rowOf(store, challengeId);
    expect(reserved.status).toBe("accepting");
    expect(await h.challenges.reconcileAcceptingChallenge(challengeId)).toBe("accepted");
    expect([...games.games.keys()]).toEqual([reserved.acceptance?.gameId]);
  });

  it("TST-CHAL-REC-012 the failure's final write fails, or is stored with its reply lost: still accepting (or failed as stored), never accepted, never a game", async () => {
    for (const mode of ["fail", "apply_then_fail"] satisfies ("fail" | "apply_then_fail")[]) {
      const h = challengeHarness();
      const store = memoryOf(h);
      const alice = await h.player("Alice");
      const bob = await h.player("Bob");
      const { challengeId, reserved } = await stuck(h, store, alice, bob);
      await setStatus(h, alice, "disabled");
      store.acceptanceFault = { method: "failAcceptance", mode };
      expect(await h.challenges.reconcileAcceptingChallenge(challengeId), mode).toBe("processing");
      expect(rowOf(store, challengeId).status, mode).toBe(
        mode === "fail" ? "accepting" : "accept_failed",
      );
      expect(h.facts.named("challenge_accept_processing").at(-1)?.cause, mode).toBe(
        "completion_failed",
      );
      expect(await h.challenges.reconcileAcceptingChallenge(challengeId), mode).toBe(
        "accept_failed",
      );
      expect(rowOf(store, challengeId), mode).toMatchObject({
        status: "accept_failed",
        acceptance: reserved.acceptance,
        createdGameId: null,
      });
      expect(gamesOf(h).games.size, mode).toBe(0);
      expect(h.facts.count("challenge_accept_failed"), mode).toBe(mode === "fail" ? 1 : 0);
      expect(h.defects.errors, mode).toEqual([]);
    }
  });

  it("TST-CHAL-REC-013 the challenge store fails during reconciliation: unavailable, nothing changes, and the next attempt settles", async () => {
    const h = challengeHarness();
    const store = memoryOf(h);
    const alice = await h.player("Alice");
    const bob = await h.player("Bob");
    const { challengeId, reserved } = await stuck(h, store, alice, bob);
    store.failNext = "unavailable";
    expect(await h.challenges.reconcileAcceptingChallenge(challengeId)).toBe("unavailable");
    expect(h.facts.named("challenge_accept_reconcile_unavailable")).toEqual([
      {
        name: "challenge_accept_reconcile_unavailable",
        challengeId,
        via: "maintenance",
        cause: "store_unavailable",
      },
    ]);
    expect(rowOf(store, challengeId)).toEqual(reserved);
    expect(gamesOf(h).creates).toBe(1);
    expect(await h.challenges.reconcileAcceptingChallenge(challengeId)).toBe("accepted");
    expect(h.defects.errors).toEqual([]);
  });

  it("TST-CHAL-REC-014 the eligibility lookup is unavailable: nothing is created and nothing fails; once readable the same game is created", async () => {
    const base = challengeHarness();
    const players = new FlakyPlayers(base.accounts.accounts);
    const store = new MemoryChallengeStore(() => "user");
    const games = new FakeGameCreator();
    const h = challengeHarness({ accounts: base.accounts, players, store, games });
    const alice = await base.player("Alice");
    const bob = await base.player("Bob");
    const { challengeId, reserved } = await stuck(h, store, alice, bob);
    players.failing = true;
    expect(await h.challenges.reconcileAcceptingChallenge(challengeId)).toBe("processing");
    expect(h.facts.named("challenge_accept_processing").at(-1)?.cause).toBe(
      "eligibility_unavailable",
    );
    expect(h.defects.errors).toHaveLength(2);
    expect(games.creates).toBe(1);
    expect(rowOf(store, challengeId)).toEqual(reserved);
    expect(h.facts.count("challenge_accept_failed")).toBe(0);
    players.failing = false;
    expect(await h.challenges.reconcileAcceptingChallenge(challengeId)).toBe("accepted");
    expect([...games.games.values()]).toEqual([specOf(reserved)]);
  });

  it("TST-CHAL-REC-015 a final write that loses its compare-and-set to another writer takes the stored outcome", async () => {
    const accountsOwner = challengeHarness();
    const memory = new MemoryChallengeStore(() => "user");
    let rivalFirst: "complete" | "fail" | null = null;
    const rival: ChallengeStore = {
      create: (challenge, caps) => memory.create(challenge, caps),
      find: (id) => memory.find(id),
      listPending: (query) => memory.listPending(query),
      resolve: (next, now) => memory.resolve(next, now),
      reserveAcceptance: (next, now) => memory.reserveAcceptance(next, now),
      completeAcceptance: async (next) => {
        if (rivalFirst === "complete") await memory.completeAcceptance(next);
        return memory.completeAcceptance(next);
      },
      failAcceptance: async (next) => {
        const row = memory.rows.get(next.challengeId);
        if (rivalFirst === "fail" && row !== undefined) {
          await memory.completeAcceptance(completeAcceptance(row));
        }
        return memory.failAcceptance(next);
      },
      listAccepting: (query) => memory.listAccepting(query),
      expire: (id, now) => memory.expire(id, now),
      expireOverdue: (now, limit) => memory.expireOverdue(now, limit),
    };
    const h = challengeHarness({ accounts: accountsOwner.accounts, store: rival });
    const alice = await accountsOwner.player("Alice");
    const bob = await accountsOwner.player("Bob");
    const carol = await accountsOwner.player("Carol");

    const completing = await stuck(h, memory, alice, bob);
    rivalFirst = "complete";
    expect(await h.challenges.reconcileAcceptingChallenge(completing.challengeId)).toBe("accepted");
    expect(rowOf(memory, completing.challengeId)).toEqual(completeAcceptance(completing.reserved));
    expect(h.facts.count("challenge_accepted")).toBe(0);

    const failing = await stuck(h, memory, alice, carol);
    await setStatus(accountsOwner, carol, "disabled");
    rivalFirst = "fail";
    expect(await h.challenges.reconcileAcceptingChallenge(failing.challengeId)).toBe("accepted");
    expect(rowOf(memory, failing.challengeId).status).toBe("accepted");
    expect(h.facts.count("challenge_accept_failed")).toBe(0);
    expect(h.defects.errors).toEqual([]);
  });

  it("TST-CHAL-REC-016 the reconciliation facts: started, then reconciled or unavailable, with codes and challenge ids only", async () => {
    const h = challengeHarness();
    const store = memoryOf(h);
    const alice = await h.player("Alice");
    const bob = await h.player("Bob");
    const carol = await h.player("Carol");
    const accepted = await stuck(h, store, alice, bob);
    h.accounts.clock.advance(1_000);
    const failing = await stuck(h, store, alice, carol);
    await setStatus(h, carol, "locked");
    gamesOf(h).checkFaults.push("unknown");
    const pass = await h.challenges.reconcileAcceptingChallenges(10);
    expect(pass).toMatchObject({ examined: 2, processing: 1, failed: 1, accepted: 0 });
    await h.challenges.reconcileAcceptingChallenges(10);
    const names = [
      "challenge_accept_reconcile_started",
      "challenge_accept_reconciled",
      "challenge_accept_failed",
      "challenge_accept_reconcile_unavailable",
    ];
    expect(
      h.facts.facts.filter((fact) => names.includes(fact.name)).map((fact) => fact.name),
    ).toEqual([
      "challenge_accept_reconcile_started",
      "challenge_accept_reconcile_unavailable",
      "challenge_accept_reconcile_started",
      "challenge_accept_failed",
      "challenge_accept_reconciled",
      "challenge_accept_reconcile_started",
      "challenge_accept_reconciled",
    ]);
    expect(h.facts.named("challenge_accept_reconciled")).toEqual([
      {
        name: "challenge_accept_reconciled",
        challengeId: failing.challengeId,
        via: "maintenance",
        outcome: "accept_failed",
      },
      {
        name: "challenge_accept_reconciled",
        challengeId: accepted.challengeId,
        via: "maintenance",
        outcome: "accepted",
      },
    ]);
    expectPrivateFacts(h, [alice, bob, carol]);
    expect(h.defects.errors).toEqual([]);
  });
});
