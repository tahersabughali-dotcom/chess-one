import type { AuthenticatedSession } from "@chess-one/accounts";
import { CHALLENGE_ID_FORMAT, CHALLENGE_POLICY, isChallengeId } from "@chess-one/challenge-domain";
import {
  type ChallengeError,
  type ChallengePage,
  type ChallengeStore,
  Challenges,
  ChallengesConfigError,
  type ChallengeView,
  newChallengeId,
  secureSeatColor,
} from "@chess-one/challenges";
import { isUserId, type UserId } from "@chess-one/identity";
import { describe, expect, it } from "vitest";
import { DefectLog, RecordingFacts } from "../realtime/support/facts.ts";
import { FakeGameCreator } from "./support/games.ts";
import {
  type ChallengeHarness,
  challengeHarness,
  createInput,
  DAY,
  MINUTE,
  type Player,
} from "./support/harness.ts";

function value<T>(outcome: { ok: true; value: T } | { ok: false; error: ChallengeError }): T {
  if (!outcome.ok) throw new Error(`unexpected ${outcome.error.kind}`);
  return outcome.value;
}

function errorOf<T>(
  outcome: { ok: true; value: T } | { ok: false; error: ChallengeError },
): string {
  if (outcome.ok) throw new Error("unexpected success");
  return outcome.error.kind;
}

function uid(text: string): UserId {
  if (!isUserId(text)) throw new Error("not a user id");
  return text;
}

async function pair(h: ChallengeHarness): Promise<{ alice: Player; bob: Player }> {
  return { alice: await h.player("Alice"), bob: await h.player("Bob") };
}

async function challenge(h: ChallengeHarness, from: Player, to: string): Promise<ChallengeView> {
  return value(await h.challenges.create(from.session, createInput(to)));
}

describe("TST-CHAL-APP create", () => {
  it("TST-CHAL-APP-001 a challenge is created pending for 24 hours and shows usernames only", async () => {
    const h = challengeHarness();
    const { alice, bob } = await pair(h);
    const view = await challenge(h, alice, "Bob");
    expect(view).toMatchObject({
      status: "pending",
      viewerRole: "challenger",
      challengerUsername: "Alice",
      challengedUsername: "Bob",
      rulesetId: "FIDE-E01-2023",
      timeControl: { type: "sudden_death", initialMs: 5 * MINUTE, incrementMs: 0 },
      seatPreference: "white",
      resolvedAt: null,
      createdGameId: null,
    });
    expect(isChallengeId(view.challengeId)).toBe(true);
    expect(view.expiresAt - view.createdAt).toBe(DAY);
    expect(view.createdAt).toBe(h.accounts.clock.now());
    const text = JSON.stringify(view);
    for (const secret of [alice.userId, bob.userId, alice.session.sessionId, "@example.test"]) {
      expect(text).not.toContain(secret);
    }
    expect(h.facts.named("challenge_created")).toEqual([
      { name: "challenge_created", challengeId: view.challengeId },
    ]);
    expect(h.defects.errors).toEqual([]);
  });

  it("TST-CHAL-APP-002 the opponent is found by canonical username only: case-insensitive, never by email", async () => {
    const h = challengeHarness();
    const { alice } = await pair(h);
    expect(
      value(await h.challenges.create(alice.session, createInput("bOB"))).challengedUsername,
    ).toBe("Bob");
    for (const name of ["nobody", "bob@example.test", "b", "bo b", "", "x".repeat(200)]) {
      expect(errorOf(await h.challenges.create(alice.session, createInput(name))), name).toBe(
        "player_not_found",
      );
    }
  });

  it("TST-CHAL-APP-003 nobody can challenge themselves", async () => {
    const h = challengeHarness();
    const { alice } = await pair(h);
    expect(errorOf(await h.challenges.create(alice.session, createInput("ALICE")))).toBe(
      "cannot_challenge_self",
    );
    expect(h.memory?.rows.size).toBe(0);
  });

  it("TST-CHAL-APP-004 disabled or locked opponents are unavailable; a disabled challenger cannot act", async () => {
    const h = challengeHarness();
    const { alice, bob } = await pair(h);
    const carol = await h.player("Carol");
    await h.accounts.accounts.setAccountStatus(uid(bob.userId), "disabled");
    await h.accounts.accounts.setAccountStatus(uid(carol.userId), "locked");
    expect(errorOf(await h.challenges.create(alice.session, createInput("Bob")))).toBe(
      "player_unavailable",
    );
    expect(errorOf(await h.challenges.create(alice.session, createInput("Carol")))).toBe(
      "player_unavailable",
    );
    const dave = await h.player("Dave");
    await h.accounts.accounts.setAccountStatus(uid(alice.userId), "disabled");
    expect(errorOf(await h.challenges.create(alice.session, createInput("Dave")))).toBe(
      "account_unavailable",
    );
    expect(dave.username).toBe("Dave");
    expect(h.memory?.rows.size).toBe(0);
  });

  it("TST-CHAL-APP-005 invalid seat preference, time control, or ruleset is refused before any lookup", async () => {
    const h = challengeHarness();
    const { alice } = await pair(h);
    const cases: [Parameters<typeof createInput>[1], string][] = [
      [{ seatPreference: "either" }, "invalid_seat_preference"],
      [{ seatPreference: "WHITE" }, "invalid_seat_preference"],
      [
        { timeControl: { type: "sudden_death", initialMs: 5 * MINUTE, incrementMs: 2_000 } },
        "invalid_time_control",
      ],
      [
        { timeControl: { type: "sudden_death", initialMs: 30_000, incrementMs: 0 } },
        "invalid_time_control",
      ],
      [
        { timeControl: { type: "sudden_death", initialMs: Number.NaN, incrementMs: 0 } },
        "invalid_time_control",
      ],
      [
        { timeControl: { type: "bronstein", initialMs: 5 * MINUTE, incrementMs: 0 } },
        "invalid_time_control",
      ],
      [{ rulesetId: "FIDE-E01-2018" }, "invalid_ruleset"],
      [{ rulesetId: "" }, "invalid_ruleset"],
    ];
    const callsBefore = h.memory?.calls ?? 0;
    for (const [overrides, expected] of cases) {
      expect(
        errorOf(await h.challenges.create(alice.session, createInput("nobody", overrides))),
        expected,
      ).toBe(expected);
    }
    expect(h.memory?.calls).toBe(callsBefore);
    expect(
      value(
        await h.challenges.create(
          alice.session,
          createInput("Bob", { rulesetId: "FIDE-E01-2023" }),
        ),
      ).rulesetId,
    ).toBe("FIDE-E01-2023");
  });

  it("TST-CHAL-APP-006 a verified email is not required; the eligibility hook can refuse either side", async () => {
    const plain = challengeHarness();
    const { alice } = await pair(plain);
    expect((await plain.challenges.create(alice.session, createInput("Bob"))).ok).toBe(true);

    const strict = challengeHarness({
      eligibility: {
        check: (challenger, opponent) =>
          !challenger.emailVerified
            ? "challenger_ineligible"
            : opponent.emailVerified
              ? "eligible"
              : "opponent_ineligible",
      },
    });
    const players = await pair(strict);
    expect(errorOf(await strict.challenges.create(players.alice.session, createInput("Bob")))).toBe(
      "account_unavailable",
    );
    expect(strict.facts.named("challenge_create_rejected").at(-1)?.reason).toBe(
      "account_unavailable",
    );
  });

  it("TST-CHAL-APP-007 one pending challenge per pair, in either direction; a resolved or expired one frees the pair", async () => {
    const h = challengeHarness();
    const { alice, bob } = await pair(h);
    const first = await challenge(h, alice, "Bob");
    expect(errorOf(await h.challenges.create(alice.session, createInput("Bob")))).toBe(
      "challenge_already_pending",
    );
    expect(errorOf(await h.challenges.create(bob.session, createInput("Alice")))).toBe(
      "challenge_already_pending",
    );
    value(await h.challenges.decline(bob.session, first.challengeId));
    const second = await challenge(h, bob, "Alice");
    h.accounts.clock.advance(DAY);
    const third = await challenge(h, alice, "Bob");
    expect(new Set([first.challengeId, second.challengeId, third.challengeId]).size).toBe(3);
    expect(h.memory?.rows.get(second.challengeId)?.status).toBe("expired");
    expect(value(await h.challenges.get(bob.session, second.challengeId))).toMatchObject({
      status: "expired",
      resolvedAt: second.expiresAt,
    });
  });

  it("TST-CHAL-APP-008 at most 20 outgoing pending challenges; the incoming cap reads as unavailable", async () => {
    const h = challengeHarness();
    const alice = await h.player("Alice");
    for (let index = 0; index < CHALLENGE_POLICY.maxOutgoingPending; index += 1) {
      const opponent = await h.player(`Opp${index}`);
      await challenge(h, alice, opponent.username);
    }
    await h.player("OneMore");
    expect(errorOf(await h.challenges.create(alice.session, createInput("OneMore")))).toBe(
      "challenge_limit_reached",
    );
    h.accounts.clock.advance(DAY);
    expect((await h.challenges.create(alice.session, createInput("OneMore"))).ok).toBe(true);

    const full = challengeHarness();
    const players = await pair(full);
    const store = full.memory;
    if (store === null) throw new Error("memory store expected");
    const capped: ChallengeStore = {
      create: async () => "incoming_limit",
      find: (id) => store.find(id),
      listPending: (query) => store.listPending(query),
      resolve: (next, now) => store.resolve(next, now),
      reserveAcceptance: (next, now) => store.reserveAcceptance(next, now),
      completeAcceptance: (next) => store.completeAcceptance(next),
      failAcceptance: (next) => store.failAcceptance(next),
      listAccepting: (query) => store.listAccepting(query),
      expire: (id, now) => store.expire(id, now),
      expireOverdue: (now, limit) => store.expireOverdue(now, limit),
    };
    const refusing = challengeHarness({ accounts: full.accounts, store: capped });
    expect(
      errorOf(await refusing.challenges.create(players.alice.session, createInput("Bob"))),
    ).toBe("player_unavailable");
    expect(refusing.facts.named("challenge_create_rejected")).toEqual([
      { name: "challenge_create_rejected", reason: "incoming_limit" },
    ]);
  });

  it("TST-CHAL-APP-009 creations are rate limited per user, before any lookup", async () => {
    const h = challengeHarness({ rateLimit: { burst: 2, refillEveryMs: 30_000 } });
    const { alice, bob } = await pair(h);
    expect(errorOf(await h.challenges.create(alice.session, createInput("nobody")))).toBe(
      "player_not_found",
    );
    expect(errorOf(await h.challenges.create(alice.session, createInput("nobody")))).toBe(
      "player_not_found",
    );
    const limited = await h.challenges.create(alice.session, createInput("Bob"));
    expect(limited).toEqual({ ok: false, error: { kind: "rate_limited", retryAfterMs: 30_000 } });
    expect((await h.challenges.create(bob.session, createInput("Alice"))).ok).toBe(true);
    h.accounts.clock.advance(30_000);
    expect(errorOf(await h.challenges.create(alice.session, createInput("Bob")))).toBe(
      "challenge_already_pending",
    );
    expect(h.facts.named("challenge_create_rejected").map((fact) => fact.reason)).toContain(
      "rate_limited",
    );
  });
});

describe("TST-CHAL-APP read and list", () => {
  it("TST-CHAL-APP-010 only the two participants can read a challenge; a stranger learns nothing", async () => {
    const h = challengeHarness();
    const { alice, bob } = await pair(h);
    const mallory = await h.player("Mallory");
    const view = await challenge(h, alice, "Bob");
    expect(value(await h.challenges.get(alice.session, view.challengeId)).viewerRole).toBe(
      "challenger",
    );
    expect(value(await h.challenges.get(bob.session, view.challengeId)).viewerRole).toBe(
      "challenged",
    );
    const stranger = await h.challenges.get(mallory.session, view.challengeId);
    const unknown = await h.challenges.get(mallory.session, newChallengeId());
    const malformed = await h.challenges.get(mallory.session, "../../etc/passwd");
    expect(stranger).toEqual({ ok: false, error: { kind: "challenge_not_found" } });
    expect(unknown).toEqual(stranger);
    expect(malformed).toEqual(stranger);
  });

  it("TST-CHAL-APP-011 a pending challenge past its deadline reads as expired without a write", async () => {
    const h = challengeHarness();
    const { alice, bob } = await pair(h);
    const view = await challenge(h, alice, "Bob");
    h.accounts.clock.advance(DAY - 1);
    expect(value(await h.challenges.get(bob.session, view.challengeId)).status).toBe("pending");
    h.accounts.clock.advance(1);
    expect(value(await h.challenges.get(bob.session, view.challengeId))).toMatchObject({
      status: "expired",
      resolvedAt: view.expiresAt,
    });
    expect(h.memory?.rows.get(view.challengeId)?.status).toBe("pending");
  });

  it("TST-CHAL-APP-012 incoming and outgoing lists page newest first with a cursor, without repeats or gaps", async () => {
    const h = challengeHarness();
    const target = await h.player("Target");
    const senders: Player[] = [];
    for (let index = 0; index < 5; index += 1) senders.push(await h.player(`Sender${index}`));
    const created: string[] = [];
    for (const [index, sender] of senders.entries()) {
      if (index !== 2) h.accounts.clock.advance(1_000);
      created.push((await challenge(h, sender, "Target")).challengeId);
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 4; page += 1) {
      const result: ChallengePage = value(
        await h.challenges.list(target.session, { direction: "incoming", cursor, limit: 2 }),
      );
      expect(result.challenges.length).toBeLessThanOrEqual(2);
      for (const item of result.challenges) {
        expect(item.viewerRole).toBe("challenged");
        seen.push(item.challengeId);
      }
      cursor = result.nextCursor;
      if (cursor === null) break;
    }
    expect(cursor).toBeNull();
    expect(new Set(seen)).toEqual(new Set(created));
    expect(seen.length).toBe(5);
    const created0 = value(await h.challenges.get(target.session, created[4] ?? "")).createdAt;
    expect(value(await h.challenges.get(target.session, seen[0] ?? "")).createdAt).toBe(created0);

    const outgoing = value(
      await h.challenges.list(senders[0]?.session ?? target.session, {
        direction: "outgoing",
        cursor: null,
        limit: null,
      }),
    );
    expect(outgoing.challenges.map((item) => item.challengeId)).toEqual([created[0]]);
    expect(outgoing.nextCursor).toBeNull();
    expect(
      value(
        await h.challenges.list(target.session, {
          direction: "outgoing",
          cursor: null,
          limit: null,
        }),
      ).challenges,
    ).toEqual([]);
  });

  it("TST-CHAL-APP-013 lists hold pending challenges only, never resolved or overdue ones; bad parameters are refused", async () => {
    const h = challengeHarness();
    const { alice, bob } = await pair(h);
    const carol = await h.player("Carol");
    const declined = await challenge(h, alice, "Bob");
    value(await h.challenges.decline(bob.session, declined.challengeId));
    await challenge(h, carol, "Bob");
    const list = async (): Promise<number> =>
      value(
        await h.challenges.list(bob.session, { direction: "incoming", cursor: null, limit: null }),
      ).challenges.length;
    expect(await list()).toBe(1);
    h.accounts.clock.advance(DAY);
    expect(await list()).toBe(0);
    for (const input of [
      { direction: "sideways", cursor: null, limit: null },
      { direction: "incoming", cursor: "not-a-cursor", limit: null },
      { direction: "incoming", cursor: null, limit: 0 },
      { direction: "incoming", cursor: null, limit: 51 },
    ]) {
      expect(errorOf(await h.challenges.list(bob.session, input)), JSON.stringify(input)).toBe(
        "invalid_request",
      );
    }
  });
});

describe("TST-CHAL-APP decline, cancel, expiry", () => {
  it("TST-CHAL-APP-014 only the challenged player declines; a repeat is answered with the same result", async () => {
    const h = challengeHarness();
    const { alice, bob } = await pair(h);
    const mallory = await h.player("Mallory");
    const view = await challenge(h, alice, "Bob");
    expect(errorOf(await h.challenges.decline(alice.session, view.challengeId))).toBe(
      "not_challenge_participant",
    );
    expect(errorOf(await h.challenges.decline(mallory.session, view.challengeId))).toBe(
      "challenge_not_found",
    );
    h.accounts.clock.advance(5_000);
    const declined = value(await h.challenges.decline(bob.session, view.challengeId));
    expect(declined).toMatchObject({
      status: "declined",
      viewerRole: "challenged",
      resolvedAt: view.createdAt + 5_000,
      createdGameId: null,
    });
    h.accounts.clock.advance(5_000);
    expect(value(await h.challenges.decline(bob.session, view.challengeId))).toEqual(declined);
    expect(errorOf(await h.challenges.cancel(alice.session, view.challengeId))).toBe(
      "challenge_not_pending",
    );
    expect(h.facts.named("challenge_declined")).toEqual([
      { name: "challenge_declined", challengeId: view.challengeId },
    ]);
  });

  it("TST-CHAL-APP-015 only the challenger cancels; a repeat is answered with the same result", async () => {
    const h = challengeHarness();
    const { alice, bob } = await pair(h);
    const view = await challenge(h, alice, "Bob");
    expect(errorOf(await h.challenges.cancel(bob.session, view.challengeId))).toBe(
      "not_challenge_participant",
    );
    const cancelled = value(await h.challenges.cancel(alice.session, view.challengeId));
    expect(cancelled).toMatchObject({ status: "cancelled", viewerRole: "challenger" });
    expect(value(await h.challenges.cancel(alice.session, view.challengeId))).toEqual(cancelled);
    expect(errorOf(await h.challenges.decline(bob.session, view.challengeId))).toBe(
      "challenge_not_pending",
    );
  });

  it("TST-CHAL-APP-016 at the deadline an action is refused as expired and the expiry is stored", async () => {
    const h = challengeHarness();
    const { alice, bob } = await pair(h);
    const early = await challenge(h, alice, "Bob");
    h.accounts.clock.advance(DAY - 1);
    expect(value(await h.challenges.decline(bob.session, early.challengeId)).status).toBe(
      "declined",
    );

    const late = await challenge(h, bob, "Alice");
    h.accounts.clock.advance(DAY);
    expect(errorOf(await h.challenges.cancel(bob.session, late.challengeId))).toBe(
      "challenge_expired",
    );
    expect(h.memory?.rows.get(late.challengeId)).toMatchObject({
      status: "expired",
      resolvedAt: late.expiresAt,
    });
    expect(errorOf(await h.challenges.decline(alice.session, late.challengeId))).toBe(
      "challenge_expired",
    );
    expect(h.facts.named("challenge_expired")).toEqual([
      { name: "challenge_expired", challengeId: late.challengeId, via: "action" },
    ]);
  });

  it("TST-CHAL-APP-017 concurrent decline and cancel: exactly one wins, the other sees it", async () => {
    for (let round = 0; round < 10; round += 1) {
      const h = challengeHarness();
      const { alice, bob } = await pair(h);
      const view = await challenge(h, alice, "Bob");
      const [declined, cancelled] = await Promise.all([
        h.challenges.decline(bob.session, view.challengeId),
        h.challenges.cancel(alice.session, view.challengeId),
      ]);
      const winners = [declined, cancelled].filter((outcome) => outcome.ok);
      expect(winners.length).toBe(1);
      const loser = declined.ok ? cancelled : declined;
      expect(errorOf(loser)).toBe("challenge_not_pending");
      const stored = h.memory?.rows.get(view.challengeId);
      expect(stored?.status).toBe(declined.ok ? "declined" : "cancelled");
    }
  });

  it("TST-CHAL-APP-018 the expiry sweep marks overdue challenges expired and keeps them", async () => {
    const h = challengeHarness();
    const { alice } = await pair(h);
    await h.player("Carol");
    await challenge(h, alice, "Bob");
    await challenge(h, alice, "Carol");
    expect(await h.challenges.expireOverdue(10)).toBe(0);
    h.accounts.clock.advance(DAY);
    expect(await h.challenges.expireOverdue(1)).toBe(1);
    expect(await h.challenges.expireOverdue(10)).toBe(1);
    expect([...(h.memory?.rows.values() ?? [])].map((row) => row.status)).toEqual([
      "expired",
      "expired",
    ]);
    expect(h.facts.named("challenges_expired_swept").map((fact) => fact.count)).toEqual([1, 1]);
  });
});

describe("TST-CHAL-APP failures and hygiene", () => {
  it("TST-CHAL-APP-019 a store failure is TEMPORARILY_UNAVAILABLE; corruption is also reported", async () => {
    const h = challengeHarness();
    const { alice, bob } = await pair(h);
    const view = await challenge(h, alice, "Bob");
    const store = h.memory;
    if (store === null) throw new Error("memory store expected");
    store.failNext = "unavailable";
    expect(errorOf(await h.challenges.get(bob.session, view.challengeId))).toBe(
      "temporarily_unavailable",
    );
    store.failNext = "unavailable";
    expect(errorOf(await h.challenges.decline(bob.session, view.challengeId))).toBe(
      "temporarily_unavailable",
    );
    store.failNext = "unavailable";
    expect(errorOf(await h.challenges.create(bob.session, createInput("Alice")))).toBe(
      "temporarily_unavailable",
    );
    expect(h.defects.errors).toEqual([]);
    store.failNext = "corrupt";
    expect(
      errorOf(
        await h.challenges.list(bob.session, { direction: "incoming", cursor: null, limit: null }),
      ),
    ).toBe("temporarily_unavailable");
    expect(h.defects.errors.length).toBe(1);
    expect(store.rows.get(view.challengeId)?.status).toBe("pending");
  });

  it("TST-CHAL-APP-020 facts carry codes and challenge ids only: no user id, username, email, or session", async () => {
    const h = challengeHarness();
    const { alice, bob } = await pair(h);
    const view = await challenge(h, alice, "Bob");
    await h.challenges.create(alice.session, createInput("Bob"));
    await h.challenges.create(alice.session, createInput("nobody"));
    await h.challenges.decline(alice.session, view.challengeId);
    await h.challenges.decline(bob.session, view.challengeId);
    const text = JSON.stringify(h.facts.facts);
    for (const secret of [alice.userId, bob.userId, "Alice", "Bob", "nobody", "example.test"]) {
      expect(text).not.toContain(secret);
    }
    for (const session of [alice.session, bob.session]) {
      expect(text).not.toContain(session.sessionId);
    }
  });

  it("TST-CHAL-APP-021 ids and random seats come from the CSPRNG", () => {
    const ids = new Set<string>();
    for (let index = 0; index < 500; index += 1) {
      const id = newChallengeId();
      expect(id).toMatch(CHALLENGE_ID_FORMAT);
      ids.add(id);
    }
    expect(ids.size).toBe(500);
    const colors = new Map<string, number>();
    for (let index = 0; index < 400; index += 1) {
      const color = secureSeatColor();
      colors.set(color, (colors.get(color) ?? 0) + 1);
    }
    expect([...colors.keys()].sort()).toEqual(["black", "white"]);
    for (const count of colors.values()) expect(count).toBeGreaterThan(120);
  });

  it("TST-CHAL-APP-022 the configuration refuses a non-positive rate limit", () => {
    const h = challengeHarness();
    for (const rateLimit of [
      { burst: 0, refillEveryMs: 1 },
      { burst: 1, refillEveryMs: 0 },
      { burst: 1.5, refillEveryMs: 1 },
    ]) {
      expect(
        () =>
          new Challenges({
            store: h.store,
            games: new FakeGameCreator(),
            players: h.accounts.accounts,
            clock: h.accounts.clock,
            facts: new RecordingFacts(),
            reportDefect: new DefectLog().report,
            rateLimit,
          }),
      ).toThrow(ChallengesConfigError);
    }
  });

  it("TST-CHAL-APP-023 a session whose account was disabled cannot decline or cancel", async () => {
    const h = challengeHarness();
    const { alice, bob } = await pair(h);
    const view = await challenge(h, alice, "Bob");
    await h.accounts.accounts.setAccountStatus(uid(bob.userId), "disabled");
    const stale: AuthenticatedSession = bob.session;
    expect(errorOf(await h.challenges.decline(stale, view.challengeId))).toBe(
      "account_unavailable",
    );
    expect(h.memory?.rows.get(view.challengeId)?.status).toBe("pending");
    await h.accounts.accounts.setAccountStatus(uid(alice.userId), "locked");
    expect(errorOf(await h.challenges.cancel(alice.session, view.challengeId))).toBe(
      "account_unavailable",
    );
    expect(h.memory?.rows.get(view.challengeId)?.status).toBe("pending");
  });
});
