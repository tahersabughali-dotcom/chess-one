import { PostgresAccountsRepository } from "@chess-one/accounts-persistence";
import { PostgresChallengeStore } from "@chess-one/challenges-persistence";
import { describe, expect, it } from "vitest";
import { type AccountsHarness, accountsHarness } from "../accounts/support/harness.ts";
import { type Answer, call, registerOver } from "../accounts/support/http.ts";
import { field } from "../realtime/support/client.ts";
import { type ChallengesSchema, withChallengesSchema } from "./support/db.ts";
import { DAY, MINUTE } from "./support/harness.ts";
import { type ChallengeEdge, challengeEdge } from "./support/http.ts";

const APP = "chess-one-challenges-e2e-test";

function body(opponentUsername: string): unknown {
  return {
    opponentUsername,
    timeControl: { type: "sudden_death", initialMs: 3 * MINUTE, incrementMs: 0 },
    seatPreference: "black",
  };
}

/** One server process: the real edge over PostgreSQL accounts and challenges. */
function server(schema: ChallengesSchema, accounts?: AccountsHarness): ChallengeEdge {
  return challengeEdge({
    accounts:
      accounts ??
      accountsHarness({ repository: new PostgresAccountsRepository(schema.base.accounts()) }),
    store: new PostgresChallengeStore(schema.challenges()),
  });
}

function idOf(answer: Answer): string {
  const id = field(answer.body, "challenge", "challengeId");
  if (typeof id !== "string") throw new Error(`no challenge id: ${answer.status} ${answer.text}`);
  return id;
}

function codeOf(answer: Answer): unknown {
  return field(answer.body, "code");
}

describe("TST-CHAL-E2E direct challenges over HTTP and PostgreSQL", () => {
  it("TST-CHAL-E2E-001 register, challenge by username, list, read, refuse a stranger, decline, cancel, expire, restart", async () => {
    await withChallengesSchema(APP, {}, async (schema) => {
      const first = server(schema);
      try {
        const a = await registerOver(first.auth, "PlayerA");
        const b = await registerOver(first.auth, "PlayerB");
        const c = await registerOver(first.auth, "PlayerC");

        const create = await call(first.auth, "POST", "/challenges", {
          cookie: a.cookie,
          body: body("playerb"),
        });
        expect(create.status).toBe(201);
        const id = idOf(create);
        expect(field(create.body, "challenge", "challenged", "username")).toBe("PlayerB");

        const incoming = await call(first.auth, "GET", "/challenges?direction=incoming", {
          cookie: b.cookie,
        });
        const listed = field(incoming.body, "challenges");
        expect(Array.isArray(listed) && listed.map((item) => field(item, "challengeId"))).toEqual([
          id,
        ]);
        const outgoing = await call(first.auth, "GET", "/challenges?direction=outgoing", {
          cookie: a.cookie,
        });
        const sent = field(outgoing.body, "challenges");
        expect(
          Array.isArray(sent) &&
            sent.map((item) => [field(item, "challengeId"), field(item, "viewerRole")]),
        ).toEqual([[id, "challenger"]]);

        const read = await call(first.auth, "GET", `/challenges/${id}`, { cookie: b.cookie });
        expect(field(read.body, "challenge")).toMatchObject({
          status: "pending",
          viewerRole: "challenged",
          challenger: { username: "PlayerA" },
          seatPreference: "black",
          timeControl: { type: "sudden_death", initialMs: 180_000, incrementMs: 0 },
        });

        const stranger = await call(first.auth, "GET", `/challenges/${id}`, { cookie: c.cookie });
        expect([stranger.status, codeOf(stranger)]).toEqual([404, "CHALLENGE_NOT_FOUND"]);
        const strangerDecline = await call(first.auth, "POST", `/challenges/${id}/decline`, {
          cookie: c.cookie,
          body: {},
        });
        expect([strangerDecline.status, codeOf(strangerDecline)]).toEqual([
          404,
          "CHALLENGE_NOT_FOUND",
        ]);

        const decline = await call(first.auth, "POST", `/challenges/${id}/decline`, {
          cookie: b.cookie,
          body: {},
        });
        expect(field(decline.body, "challenge", "status")).toBe("declined");
        const seenByA = await call(first.auth, "GET", `/challenges/${id}`, { cookie: a.cookie });
        expect(field(seenByA.body, "challenge", "status")).toBe("declined");

        const second = idOf(
          await call(first.auth, "POST", "/challenges", {
            cookie: a.cookie,
            body: body("PlayerB"),
          }),
        );
        const cancel = await call(first.auth, "POST", `/challenges/${second}/cancel`, {
          cookie: a.cookie,
          body: {},
        });
        expect(field(cancel.body, "challenge", "status")).toBe("cancelled");
        const late = await call(first.auth, "POST", `/challenges/${second}/decline`, {
          cookie: b.cookie,
          body: {},
        });
        expect([late.status, codeOf(late)]).toEqual([409, "CHALLENGE_NOT_PENDING"]);

        const third = idOf(
          await call(first.auth, "POST", "/challenges", {
            cookie: b.cookie,
            body: body("PlayerA"),
          }),
        );
        first.h.accounts.clock.advance(DAY);
        const expired = await call(first.auth, "POST", `/challenges/${third}/decline`, {
          cookie: a.cookie,
          body: {},
        });
        expect([expired.status, codeOf(expired)]).toEqual([409, "CHALLENGE_EXPIRED"]);
        const empty = await call(first.auth, "GET", "/challenges?direction=incoming", {
          cookie: a.cookie,
        });
        expect(field(empty.body, "challenges")).toEqual([]);

        const restarted = server(schema, first.h.accounts);
        try {
          for (const [challengeId, status] of [
            [id, "declined"],
            [second, "cancelled"],
            [third, "expired"],
          ]) {
            const answer = await call(restarted.auth, "GET", `/challenges/${challengeId}`, {
              cookie: a.cookie,
            });
            expect(field(answer.body, "challenge", "status"), status).toBe(status);
          }
          expect(restarted.auth.defects.errors).toEqual([]);
        } finally {
          await restarted.close();
        }
        expect(first.auth.defects.errors).toEqual([]);
      } finally {
        await first.close();
      }
    });
  });

  it("TST-CHAL-E2E-002 five concurrent declines and cancels across two server processes: one winner, a stable result", async () => {
    await withChallengesSchema(APP, {}, async (schema) => {
      const one = server(schema);
      const two = server(schema, one.h.accounts);
      try {
        const a = await registerOver(one.auth, "PlayerA");
        const b = await registerOver(one.auth, "PlayerB");
        const id = idOf(
          await call(one.auth, "POST", "/challenges", { cookie: a.cookie, body: body("PlayerB") }),
        );
        const answers = await Promise.all([
          call(one.auth, "POST", `/challenges/${id}/decline`, { cookie: b.cookie, body: {} }),
          call(two.auth, "POST", `/challenges/${id}/decline`, { cookie: b.cookie, body: {} }),
          call(one.auth, "POST", `/challenges/${id}/cancel`, { cookie: a.cookie, body: {} }),
          call(two.auth, "POST", `/challenges/${id}/cancel`, { cookie: a.cookie, body: {} }),
          call(two.auth, "POST", `/challenges/${id}/decline`, { cookie: b.cookie, body: {} }),
        ]);
        const final = await call(one.auth, "GET", `/challenges/${id}`, { cookie: a.cookie });
        const status = field(final.body, "challenge", "status");
        expect(["declined", "cancelled"]).toContain(status);
        const winningAction = status === "declined" ? "decline" : "cancel";
        answers.forEach((answer, index) => {
          const action = index === 2 || index === 3 ? "cancel" : "decline";
          if (action === winningAction) {
            expect(answer.status, `${action} ${index}`).toBe(200);
            expect(field(answer.body, "challenge", "status")).toBe(status);
          } else {
            expect([answer.status, codeOf(answer)], `${action} ${index}`).toEqual([
              409,
              "CHALLENGE_NOT_PENDING",
            ]);
          }
        });
        expect(one.auth.defects.errors).toEqual([]);
        expect(two.auth.defects.errors).toEqual([]);
      } finally {
        await two.close();
        await one.close();
      }
    });
  });
});
