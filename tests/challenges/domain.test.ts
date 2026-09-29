import { randomUUID } from "node:crypto";
import {
  CHALLENGE_POLICY,
  CHALLENGE_STATUSES,
  CHALLENGE_TIME_CONTROL_POLICY,
  type Challenge,
  type ChallengeId,
  type ChallengeRequest,
  challengeInvariantViolation,
  completeAcceptance,
  DEFAULT_CHALLENGE_RULESET_ID,
  decide,
  decideAcceptance,
  effectiveChallenge,
  encodeChallengeCursor,
  expiryOf,
  failAcceptance,
  type GameReference,
  isChallengeId,
  isChallengeStatus,
  isExpiredAt,
  isGameReference,
  isSeatPreference,
  isTerminalStatus,
  newChallenge,
  parseChallengeCursor,
  parseChallengeRuleset,
  parseTimeControlRequest,
  reserveAcceptance,
  resolvePageSize,
  resolveSeats,
  type SeatColor,
  type SeatPreference,
  type TimeControlRequest,
} from "@chess-one/challenge-domain";
import { isUserId, type UserId } from "@chess-one/identity";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

function userId(): UserId {
  const id = randomUUID();
  if (!isUserId(id)) throw new Error("not a user id");
  return id;
}

function challengeId(text = "AAAAAAAAAAAAAAAAAAAAAA"): ChallengeId {
  if (!isChallengeId(text)) throw new Error("not a challenge id");
  return text;
}

function gameRef(text = "game-1"): GameReference {
  if (!isGameReference(text)) throw new Error("not a game reference");
  return text;
}

const CREATED = 1_800_000_000_000;
const DAY_MS = 86_400_000;
const CHALLENGER = userId();
const CHALLENGED = userId();
const STRANGER = userId();
const ACTIONS: readonly ChallengeRequest["action"][] = ["decline", "cancel"];
type Action = "accept" | ChallengeRequest["action"];
const FIVE_MINUTES: TimeControlRequest = {
  type: "sudden_death",
  initialMs: 300_000,
  incrementMs: 0,
};

function pending(): Challenge {
  const created = newChallenge({
    challengeId: challengeId(),
    challengerUserId: CHALLENGER,
    challengedUserId: CHALLENGED,
    rulesetId: DEFAULT_CHALLENGE_RULESET_ID,
    timeControl: FIVE_MINUTES,
    seatPreference: "random",
    now: CREATED,
  });
  if (!created.ok) throw new Error(created.reason);
  return created.challenge;
}

function request(
  action: ChallengeRequest["action"],
  actor: UserId,
  now = CREATED + 1_000,
): ChallengeRequest {
  return { action, actor, now };
}

/** The pending challenge reserved for acceptance at `now`, drawing `drawn` if asked. */
function reserved(
  challenge: Challenge,
  now = CREATED + 1_000,
  drawn: SeatColor = "white",
  gameId = gameRef(),
): Challenge {
  return reserveAcceptance(challenge, { now, gameId, drawChallengerColor: () => drawn });
}

/** The outcome of any request, accept included, as one label. */
function outcomeOf(challenge: Challenge, action: Action, actor: UserId, now: number): string {
  if (action === "accept") {
    const decision = decideAcceptance(challenge, actor, now);
    return decision.kind === "refused" ? decision.reason : decision.kind;
  }
  const decision = decide(challenge, request(action, actor, now));
  return decision.kind === "refused" ? decision.reason : decision.kind;
}

describe("TST-CHAL-DOM challenge values", () => {
  it("TST-CHAL-DOM-001 ids are 22 base64url characters; game references use the live game's id syntax", () => {
    expect(isChallengeId("AbC_-0123456789abcdefgh")).toBe(false);
    expect(isChallengeId("AbC_-0123456789abcdefg")).toBe(true);
    expect(isChallengeId("AbC_-0123456789abcdef=")).toBe(false);
    expect(isChallengeId("")).toBe(false);
    expect(isGameReference("game:1.a_b-c")).toBe(true);
    expect(isGameReference("game 1")).toBe(false);
    expect(isGameReference("x".repeat(129))).toBe(false);
  });

  it("TST-CHAL-DOM-002 time controls: sudden death, whole seconds from 1 minute to 3 hours, no increment", () => {
    const { minInitialMs, maxInitialMs } = CHALLENGE_TIME_CONTROL_POLICY;
    expect(parseTimeControlRequest("sudden_death", minInitialMs, 0)).toEqual({
      type: "sudden_death",
      initialMs: minInitialMs,
      incrementMs: 0,
    });
    expect(parseTimeControlRequest("sudden_death", maxInitialMs, 0)).not.toBeNull();
    for (const [type, initialMs, incrementMs] of [
      ["sudden_death", minInitialMs - 1_000, 0],
      ["sudden_death", maxInitialMs + 1_000, 0],
      ["sudden_death", 300_500, 0],
      ["sudden_death", 300_000, 1_000],
      ["sudden_death", 300_000, -1],
      ["sudden_death", Number.NaN, 0],
      ["sudden_death", Number.POSITIVE_INFINITY, 0],
      ["sudden_death", 300_000.5, 0],
      ["sudden_death", 300_000, 0.5],
      ["sudden_death", -300_000, 0],
      ["fischer", 300_000, 0],
      ["SUDDEN_DEATH", 300_000, 0],
      ["", 300_000, 0],
    ] satisfies [string, number, number][]) {
      expect(
        parseTimeControlRequest(type, initialMs, incrementMs),
        `${type} ${initialMs} ${incrementMs}`,
      ).toBeNull();
    }
  });

  it("TST-CHAL-DOM-003 property: exactly the whole-second budgets in range are accepted", () => {
    fc.assert(
      fc.property(
        fc.double({ noDefaultInfinity: false }),
        fc.integer({ min: -5, max: 5 }),
        (initialMs, incrementMs) => {
          const parsed = parseTimeControlRequest("sudden_death", initialMs, incrementMs);
          const valid =
            Number.isSafeInteger(initialMs) &&
            initialMs >= CHALLENGE_TIME_CONTROL_POLICY.minInitialMs &&
            initialMs <= CHALLENGE_TIME_CONTROL_POLICY.maxInitialMs &&
            initialMs % 1_000 === 0 &&
            incrementMs === 0;
          expect(parsed !== null).toBe(valid);
        },
      ),
    );
    fc.assert(
      fc.property(fc.integer({ min: 60, max: 10_800 }), (seconds) => {
        expect(parseTimeControlRequest("sudden_death", seconds * 1_000, 0)?.initialMs).toBe(
          seconds * 1_000,
        );
      }),
    );
  });

  it("TST-CHAL-DOM-004 seat preferences: white, black, random; nothing else", () => {
    for (const value of ["white", "black", "random"]) expect(isSeatPreference(value)).toBe(true);
    for (const value of ["White", "w", "", "either", "none"]) {
      expect(isSeatPreference(value)).toBe(false);
    }
  });

  it("TST-CHAL-DOM-005 seats: fixed preferences never draw; random draws exactly once; seats are always the two players", () => {
    let draws = 0;
    const draw = (): "white" | "black" => {
      draws += 1;
      return "black";
    };
    expect(resolveSeats("white", "a", "b", draw)).toEqual({ white: "a", black: "b" });
    expect(resolveSeats("black", "a", "b", draw)).toEqual({ white: "b", black: "a" });
    expect(draws).toBe(0);
    expect(resolveSeats("random", "a", "b", draw)).toEqual({ white: "b", black: "a" });
    expect(draws).toBe(1);
    fc.assert(
      fc.property(
        fc.constantFrom("white", "black", "random"),
        fc.constantFrom("white", "black"),
        (preference, drawn) => {
          const seats = resolveSeats(preference, "a", "b", () => drawn);
          expect(new Set([seats.white, seats.black])).toEqual(new Set(["a", "b"]));
          if (preference !== "random") expect(seats[preference]).toBe("a");
        },
      ),
    );
  });

  it("TST-CHAL-DOM-006 rulesets: only those the live game plays", () => {
    expect(parseChallengeRuleset(DEFAULT_CHALLENGE_RULESET_ID)).toBe(DEFAULT_CHALLENGE_RULESET_ID);
    for (const value of [
      "",
      "FIDE-E01-2018",
      DEFAULT_CHALLENGE_RULESET_ID.toLowerCase(),
      "CHESS960-1",
    ]) {
      expect(parseChallengeRuleset(value), value).toBeNull();
    }
  });
});

describe("TST-CHAL-DOM lifecycle", () => {
  it("TST-CHAL-DOM-007 a new challenge is pending for exactly 24 hours and never names one player twice", () => {
    const challenge = pending();
    expect(challenge.status).toBe("pending");
    expect(challenge.expiresAt - challenge.createdAt).toBe(CHALLENGE_POLICY.ttlMs);
    expect(CHALLENGE_POLICY.ttlMs).toBe(86_400_000);
    expect(challenge.resolvedAt).toBeNull();
    expect(challenge.createdGameId).toBeNull();
    expect(challengeInvariantViolation(challenge)).toBeNull();
    const self = newChallenge({
      challengeId: challengeId(),
      challengerUserId: CHALLENGER,
      challengedUserId: CHALLENGER,
      rulesetId: DEFAULT_CHALLENGE_RULESET_ID,
      timeControl: FIVE_MINUTES,
      seatPreference: "white",
      now: CREATED,
    });
    expect(self).toEqual({ ok: false, reason: "same_player" });
  });

  it("TST-CHAL-DOM-008 the expiry boundary: acting is allowed while now < expiresAt, never at or after it", () => {
    const challenge = pending();
    const { expiresAt } = challenge;
    expect(isExpiredAt(expiresAt, expiresAt - 1)).toBe(false);
    expect(isExpiredAt(expiresAt, expiresAt)).toBe(true);
    expect(isExpiredAt(expiresAt, expiresAt + 1)).toBe(true);
    expect(decide(challenge, request("decline", CHALLENGED, expiresAt - 1)).kind).toBe(
      "transition",
    );
    expect(decideAcceptance(challenge, CHALLENGED, expiresAt - 1)).toEqual({ kind: "reserve" });
    for (const now of [expiresAt, expiresAt + 1]) {
      for (const action of ACTIONS) {
        const actor = action === "cancel" ? CHALLENGER : CHALLENGED;
        const decision = decide(challenge, request(action, actor, now));
        expect(decision.kind, `${action} at ${now - expiresAt}`).toBe("expired");
        if (decision.kind === "expired") {
          expect(decision.next.status).toBe("expired");
          expect(decision.next.resolvedAt).toBe(expiresAt);
          expect(challengeInvariantViolation(decision.next)).toBeNull();
        }
      }
      const accept = decideAcceptance(challenge, CHALLENGED, now);
      expect(accept.kind, `accept at ${now - expiresAt}`).toBe("expired");
      if (accept.kind === "expired") {
        expect(accept.next).toMatchObject({ status: "expired", resolvedAt: expiresAt });
        expect(accept.next.acceptance).toBeNull();
      }
    }
  });

  it("TST-CHAL-DOM-008A an acceptance reserved just before the deadline never expires, and completes at its reservation time", () => {
    const challenge = pending();
    const accepting = reserved(challenge, challenge.expiresAt - 1);
    expect(challengeInvariantViolation(accepting)).toBeNull();
    for (const now of [challenge.expiresAt, challenge.expiresAt + DAY_MS]) {
      expect(expiryOf(accepting, now)).toBeNull();
      expect(effectiveChallenge(accepting, now)).toBe(accepting);
      expect(decideAcceptance(accepting, CHALLENGED, now)).toEqual({
        kind: "continue",
        challenge: accepting,
      });
    }
    const accepted = completeAcceptance(accepting);
    expect(accepted).toMatchObject({
      status: "accepted",
      resolvedAt: challenge.expiresAt - 1,
      createdGameId: "game-1",
    });
    expect(challengeInvariantViolation(accepted)).toBeNull();
  });

  it("TST-CHAL-DOM-009 the transition table: who may do what from pending", () => {
    const challenge = pending();
    const table: [Action, UserId, string][] = [
      ["accept", CHALLENGED, "reserve"],
      ["decline", CHALLENGED, "transition"],
      ["cancel", CHALLENGER, "transition"],
      ["accept", CHALLENGER, "wrong_role"],
      ["decline", CHALLENGER, "wrong_role"],
      ["cancel", CHALLENGED, "wrong_role"],
      ["accept", STRANGER, "not_participant"],
      ["decline", STRANGER, "not_participant"],
      ["cancel", STRANGER, "not_participant"],
    ];
    for (const [action, actor, expected] of table) {
      expect(
        outcomeOf(challenge, action, actor, CREATED + 1_000),
        `${action} by ${actor === CHALLENGER ? "challenger" : actor === CHALLENGED ? "challenged" : "stranger"}`,
      ).toBe(expected);
    }
  });

  it("TST-CHAL-DOM-010 only acceptance links a game: reserved while accepting, recorded once accepted, checked by the invariant", () => {
    const challenge = pending();
    const accepting = reserved(challenge);
    const accepted = completeAcceptance(accepting);
    const declined = decide(challenge, request("decline", CHALLENGED));
    const cancelled = decide(challenge, request("cancel", CHALLENGER));
    if (declined.kind !== "transition" || cancelled.kind !== "transition") {
      throw new Error("expected transitions");
    }
    expect(accepting).toMatchObject({
      status: "accepting",
      resolvedAt: null,
      createdGameId: null,
      acceptance: {
        acceptedAt: CREATED + 1_000,
        gameId: "game-1",
        white: CHALLENGER,
        black: CHALLENGED,
        startDeadlineAt: CREATED + 1_000 + CHALLENGE_POLICY.startDeadlineMs,
      },
    });
    expect(CHALLENGE_POLICY.startDeadlineMs).toBe(600_000);
    expect(accepted).toMatchObject({
      status: "accepted",
      createdGameId: "game-1",
      acceptance: accepting.acceptance,
    });
    expect(declined.next).toMatchObject({ status: "declined", createdGameId: null });
    expect(cancelled.next).toMatchObject({ status: "cancelled", createdGameId: null });
    for (const next of [accepted, declined.next, cancelled.next]) {
      expect(next.resolvedAt).toBe(CREATED + 1_000);
      expect(challengeInvariantViolation(next)).toBeNull();
    }
    expect(challengeInvariantViolation(accepting)).toBeNull();
    expect(challengeInvariantViolation({ ...accepted, createdGameId: null })).toBe(
      "created_game_id",
    );
    expect(challengeInvariantViolation({ ...accepted, createdGameId: gameRef("other") })).toBe(
      "created_game_id",
    );
    expect(challengeInvariantViolation({ ...accepting, createdGameId: gameRef() })).toBe(
      "created_game_id",
    );
    expect(challengeInvariantViolation({ ...declined.next, createdGameId: gameRef() })).toBe(
      "created_game_id",
    );
    expect(challengeInvariantViolation({ ...accepting, acceptance: null })).toBe("acceptance");
    expect(
      challengeInvariantViolation({ ...declined.next, acceptance: accepting.acceptance }),
    ).toBe("acceptance");
  });

  it("TST-CHAL-DOM-010A seats follow the preference; only random draws, exactly once; the reservation is checked", () => {
    let draws = 0;
    const counted = (color: SeatColor) => () => {
      draws += 1;
      return color;
    };
    for (const [preference, drawn, white] of [
      ["white", "black", CHALLENGER],
      ["black", "white", CHALLENGED],
      ["random", "white", CHALLENGER],
      ["random", "black", CHALLENGED],
    ] satisfies [SeatPreference, SeatColor, UserId][]) {
      const before = draws;
      const accepting = reserveAcceptance(
        { ...pending(), seatPreference: preference },
        { now: CREATED + 1_000, gameId: gameRef(), drawChallengerColor: counted(drawn) },
      );
      expect(accepting.acceptance?.white, `${preference} ${drawn}`).toBe(white);
      expect(draws - before).toBe(preference === "random" ? 1 : 0);
      expect(challengeInvariantViolation(accepting)).toBeNull();
    }
    const accepting = reserved({ ...pending(), seatPreference: "white" });
    const reservation = accepting.acceptance;
    if (reservation === null) throw new Error("no reservation");
    const broken: [Partial<typeof reservation>, string][] = [
      [{ white: CHALLENGED, black: CHALLENGER }, "seats"],
      [{ white: STRANGER }, "seats"],
      [{ startDeadlineAt: reservation.startDeadlineAt + 1 }, "start_deadline_at"],
      [{ acceptedAt: CREATED - 1, startDeadlineAt: CREATED - 1 + 600_000 }, "accepted_at"],
      [
        {
          acceptedAt: accepting.expiresAt,
          startDeadlineAt: accepting.expiresAt + 600_000,
        },
        "accepted_at",
      ],
    ];
    for (const [change, violation] of broken) {
      expect(
        challengeInvariantViolation({ ...accepting, acceptance: { ...reservation, ...change } }),
      ).toBe(violation);
    }
    expect(() => reserved(accepting)).toThrow();
    expect(() => completeAcceptance(pending())).toThrow();
  });

  it("TST-CHAL-DOM-011 terminal states absorb: a repeat by the same player is unchanged, anything else is not_pending", () => {
    const challenge = pending();
    const resolved = new Map<string, Challenge>();
    for (const [action, actor] of [
      ["decline", CHALLENGED],
      ["cancel", CHALLENGER],
    ] satisfies [ChallengeRequest["action"], UserId][]) {
      const decision = decide(challenge, request(action, actor));
      if (decision.kind !== "transition") throw new Error("expected a transition");
      resolved.set(decision.next.status, decision.next);
    }
    resolved.set("accepting", reserved(challenge));
    resolved.set("accepted", completeAcceptance(reserved(challenge)));
    const expired = expiryOf(challenge, challenge.expiresAt);
    if (expired === null) throw new Error("expected an expiry");
    resolved.set("expired", expired);
    for (const [status, stored] of resolved) {
      for (const [action, actor] of [
        ["accept", CHALLENGED],
        ["decline", CHALLENGED],
        ["cancel", CHALLENGER],
        ["accept", CHALLENGER],
        ["cancel", CHALLENGED],
      ] satisfies [Action, UserId][]) {
        const outcome = outcomeOf(stored, action, actor, CREATED + 2_000);
        const expected =
          action === "accept" && actor === CHALLENGED && status === "accepting"
            ? "continue"
            : action === "accept" && actor === CHALLENGED && status === "accepted"
              ? "accepted"
              : (status === "declined" && action === "decline" && actor === CHALLENGED) ||
                  (status === "cancelled" && action === "cancel" && actor === CHALLENGER)
                ? "unchanged"
                : "not_pending";
        expect(outcome, `${status} ${action}`).toBe(expected);
      }
      expect(decide(stored, request("decline", STRANGER))).toEqual({
        kind: "refused",
        reason: "not_participant",
      });
      expect(decideAcceptance(stored, STRANGER, CREATED + 2_000)).toEqual({
        kind: "refused",
        reason: "not_participant",
      });
    }
    const accepted = resolved.get("accepted") ?? challenge;
    const repeat = decideAcceptance(accepted, CHALLENGED, CREATED + 3_000);
    expect(repeat.kind === "accepted" && repeat.challenge.createdGameId).toBe("game-1");
  });

  it("TST-CHAL-DOM-012 property: every decision keeps the invariant and never leaves a terminal state", () => {
    const actors = [CHALLENGER, CHALLENGED, STRANGER];
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            action: fc.constantFrom("accept", "complete", "decline", "cancel"),
            actor: fc.integer({ min: 0, max: 2 }),
            offset: fc.integer({ min: -60_000, max: CHALLENGE_POLICY.ttlMs + 60_000 }),
            drawn: fc.constantFrom("white", "black"),
          }),
          { maxLength: 8 },
        ),
        (steps) => {
          let challenge = pending();
          let reservation: Challenge["acceptance"] = null;
          for (const step of steps) {
            const actor = actors[step.actor] ?? STRANGER;
            const now = CREATED + step.offset;
            if (step.action === "complete") {
              if (challenge.status === "accepting") challenge = completeAcceptance(challenge);
            } else if (step.action === "accept") {
              const decision = decideAcceptance(challenge, actor, now);
              if (decision.kind === "reserve") {
                expect(challenge.status).toBe("pending");
                challenge = reserved(challenge, now, step.drawn);
                reservation = challenge.acceptance;
              } else if (decision.kind === "expired") {
                challenge = decision.next;
              }
            } else {
              const decision = decide(challenge, request(step.action, actor, now));
              if (decision.kind === "transition" || decision.kind === "expired") {
                expect(challenge.status).toBe("pending");
                challenge = decision.next;
              }
            }
            expect(challengeInvariantViolation(challenge)).toBeNull();
            if (reservation !== null) expect(challenge.acceptance).toBe(reservation);
          }
          expect(CHALLENGE_STATUSES).toContain(challenge.status);
        },
      ),
    );
  });

  it("TST-CHAL-DOM-013 a wall clock stepped back never dates a resolution before the creation", () => {
    const decision = decide(pending(), request("decline", CHALLENGED, CREATED - 5_000));
    expect(decision.kind === "transition" && decision.next.resolvedAt).toBe(CREATED);
  });

  it("TST-CHAL-DOM-014 readers see an overdue pending challenge as expired at its deadline", () => {
    const challenge = pending();
    expect(effectiveChallenge(challenge, challenge.expiresAt - 1)).toBe(challenge);
    expect(effectiveChallenge(challenge, challenge.expiresAt)).toMatchObject({
      status: "expired",
      resolvedAt: challenge.expiresAt,
    });
  });

  it("TST-CHAL-DOM-015 the invariant names corrupt rows", () => {
    const challenge = pending();
    expect(challengeInvariantViolation({ ...challenge, challengedUserId: CHALLENGER })).toBe(
      "participants",
    );
    expect(challengeInvariantViolation({ ...challenge, expiresAt: challenge.createdAt })).toBe(
      "expires_at",
    );
    expect(challengeInvariantViolation({ ...challenge, resolvedAt: CREATED })).toBe("resolved_at");
    expect(challengeInvariantViolation({ ...challenge, status: "declined" })).toBe("resolved_at");
    expect(
      challengeInvariantViolation({
        ...challenge,
        status: "declined",
        resolvedAt: challenge.expiresAt,
      }),
    ).toBe("resolved_at");
    expect(
      challengeInvariantViolation({ ...challenge, status: "expired", resolvedAt: CREATED + 1 }),
    ).toBe("resolved_at");
  });
});

describe("TST-CHAL-DOM pages", () => {
  it("TST-CHAL-DOM-016 cursors round-trip and anything malformed is refused", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
        fc.stringMatching(/^[A-Za-z0-9_-]{22}$/),
        (createdAt, id) => {
          const cursor = { createdAt, challengeId: challengeId(id) };
          expect(parseChallengeCursor(encodeChallengeCursor(cursor))).toEqual(cursor);
        },
      ),
    );
    for (const text of [
      "",
      "1",
      "01.AAAAAAAAAAAAAAAAAAAAAA",
      "-1.AAAAAAAAAAAAAAAAAAAAAA",
      "1.AAAAAAAAAAAAAAAAAAAAA",
      "1.AAAAAAAAAAAAAAAAAAAAAA.x",
      "99999999999999999.AAAAAAAAAAAAAAAAAAAAAA",
      "1 .AAAAAAAAAAAAAAAAAAAAAA",
    ]) {
      expect(parseChallengeCursor(text), text).toBeNull();
    }
  });

  it("TST-CHAL-DOM-017 page sizes: default 20, 1 to 50, nothing else", () => {
    expect(resolvePageSize(null)).toBe(20);
    expect(resolvePageSize(1)).toBe(1);
    expect(resolvePageSize(50)).toBe(50);
    for (const size of [0, 51, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolvePageSize(size), String(size)).toBeNull();
    }
  });
});

describe("TST-CHAL-DOM failed acceptance", () => {
  it("TST-CHAL-DOM-018 accept_failed is one terminal status: it keeps the reservation, has no game, and never reads as another status", () => {
    expect(CHALLENGE_STATUSES).toEqual([
      "pending",
      "accepting",
      "accepted",
      "accept_failed",
      "declined",
      "cancelled",
      "expired",
    ]);
    expect(isChallengeStatus("accept_failed")).toBe(true);
    expect(isTerminalStatus("accept_failed")).toBe(true);
    expect(isTerminalStatus("accepting")).toBe(false);
    const accepting = reserved(pending());
    const failed = failAcceptance(accepting, CREATED + 5_000);
    expect(failed).toMatchObject({
      status: "accept_failed",
      resolvedAt: CREATED + 5_000,
      createdGameId: null,
    });
    expect(failed.acceptance).toBe(accepting.acceptance);
    expect(challengeInvariantViolation(failed)).toBeNull();
    const late = failAcceptance(accepting, accepting.expiresAt + DAY_MS);
    expect(challengeInvariantViolation(late)).toBeNull();
    const steppedBack = failAcceptance(accepting, CREATED - 60_000);
    expect(steppedBack.resolvedAt).toBe(accepting.acceptance?.acceptedAt);
    expect(effectiveChallenge(failed, failed.expiresAt + DAY_MS)).toBe(failed);
    expect(expiryOf(failed, failed.expiresAt + DAY_MS)).toBeNull();
    expect(() => failAcceptance(pending(), CREATED + 5_000)).toThrow();
    expect(() => failAcceptance(failed, CREATED + 6_000)).toThrow();
    expect(() => failAcceptance(completeAcceptance(accepting), CREATED + 6_000)).toThrow();
    expect(() => completeAcceptance(failed)).toThrow();
    expect(() => reserved(failed)).toThrow();
  });

  it("TST-CHAL-DOM-019 the invariant names a corrupt failed acceptance", () => {
    const accepting = reserved(pending());
    const failed = failAcceptance(accepting, CREATED + 5_000);
    const acceptedAt = accepting.acceptance?.acceptedAt ?? 0;
    expect(challengeInvariantViolation({ ...failed, acceptance: null })).toBe("acceptance");
    expect(challengeInvariantViolation({ ...failed, createdGameId: gameRef() })).toBe(
      "created_game_id",
    );
    expect(challengeInvariantViolation({ ...failed, resolvedAt: null })).toBe("resolved_at");
    expect(challengeInvariantViolation({ ...failed, resolvedAt: acceptedAt - 1 })).toBe(
      "resolved_at",
    );
    expect(challengeInvariantViolation({ ...failed, resolvedAt: acceptedAt })).toBeNull();
  });

  it("TST-CHAL-DOM-020 decisions on a failed acceptance: the challenged player gets the same failure, everyone else changes nothing", () => {
    const failed = failAcceptance(reserved(pending()), CREATED + 5_000);
    for (const now of [CREATED + 6_000, failed.expiresAt, failed.expiresAt + DAY_MS]) {
      expect(decideAcceptance(failed, CHALLENGED, now)).toEqual({
        kind: "failed",
        challenge: failed,
      });
      expect(outcomeOf(failed, "accept", CHALLENGER, now)).toBe("not_pending");
      expect(outcomeOf(failed, "accept", STRANGER, now)).toBe("not_participant");
      expect(outcomeOf(failed, "decline", CHALLENGED, now)).toBe("not_pending");
      expect(outcomeOf(failed, "cancel", CHALLENGER, now)).toBe("not_pending");
      expect(outcomeOf(failed, "decline", STRANGER, now)).toBe("not_participant");
    }
  });

  it("TST-CHAL-DOM-021 property: accepting leads only to accepted or accept_failed, the reservation never changes, and both are absorbing", () => {
    const actors = [CHALLENGER, CHALLENGED, STRANGER];
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            action: fc.constantFrom("accept", "complete", "fail", "decline", "cancel"),
            actor: fc.integer({ min: 0, max: 2 }),
            offset: fc.integer({ min: -60_000, max: CHALLENGE_POLICY.ttlMs + 60_000 }),
          }),
          { maxLength: 10 },
        ),
        (steps) => {
          let challenge = pending();
          let reservation: Challenge["acceptance"] = null;
          for (const step of steps) {
            const before = challenge.status;
            const actor = actors[step.actor] ?? STRANGER;
            const now = CREATED + step.offset;
            if (step.action === "complete") {
              if (challenge.status === "accepting") challenge = completeAcceptance(challenge);
            } else if (step.action === "fail") {
              if (challenge.status === "accepting") challenge = failAcceptance(challenge, now);
            } else if (step.action === "accept") {
              const decision = decideAcceptance(challenge, actor, now);
              if (decision.kind === "reserve") {
                challenge = reserved(challenge, now);
                reservation = challenge.acceptance;
              } else if (decision.kind === "expired") {
                challenge = decision.next;
              }
            } else {
              const decision = decide(challenge, request(step.action, actor, now));
              if (decision.kind === "transition" || decision.kind === "expired") {
                challenge = decision.next;
              }
            }
            if (before === "accepting") {
              expect(["accepting", "accepted", "accept_failed"]).toContain(challenge.status);
            }
            if (before === "accepted" || before === "accept_failed") {
              expect(challenge.status).toBe(before);
            }
            expect(challengeInvariantViolation(challenge)).toBeNull();
            if (reservation !== null) expect(challenge.acceptance).toBe(reservation);
          }
        },
      ),
    );
  });
});
