import { newSecretToken } from "@chess-one/accounts";
import {
  clearedSessionCookieHeader,
  type EdgeConfig,
  EdgeConfigError,
  type GameAccessResolver,
  LOOPBACK_SESSION_COOKIE,
  NO_GAME_ACCESS,
  ProductionTrustedSessionResolver,
  readSessionCookie,
  resolveEdgeConfig,
  SECURE_SESSION_COOKIE,
  type SessionCookiePolicy,
  sessionCookieHeader,
  sessionCookiePolicy,
} from "@chess-one/edge";
import { describe, expect, it } from "vitest";
import { DefectLog, RecordingFacts } from "../realtime/support/facts.ts";
import { runtimeHarness } from "../realtime/support/runtime.ts";
import { ManualClock } from "../realtime/support/time.ts";
import { accountsHarness } from "./support/harness.ts";
import { TestGameAccess } from "./support/http.ts";

const SECURE = sessionCookiePolicy("secure");
const LOOPBACK = sessionCookiePolicy("insecure_loopback");

describe("TST-AUTH-COOKIE the session cookie", () => {
  it("TST-AUTH-COOKIE-001 production cookies are __Host-, Secure, HttpOnly, SameSite=Lax, Path=/, with no Domain", () => {
    const token = newSecretToken();
    const header = sessionCookieHeader(SECURE, token, 2_592_000);
    expect(header).toBe(
      `${SECURE_SESSION_COOKIE}=${token}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`,
    );
    expect(header).not.toMatch(/Domain=/i);
    expect(clearedSessionCookieHeader(SECURE)).toBe(
      `${SECURE_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
    );
  });

  it("TST-AUTH-COOKIE-002 the loopback test cookie drops only Secure (and so the __Host- prefix)", () => {
    const token = newSecretToken();
    expect(sessionCookieHeader(LOOPBACK, token, 60)).toBe(
      `${LOOPBACK_SESSION_COOKIE}=${token}; Path=/; Max-Age=60; HttpOnly; SameSite=Lax`,
    );
    expect(() => sessionCookieHeader(LOOPBACK, "bad token", 60)).toThrow();
  });

  it("TST-AUTH-COOKIE-003 the parser finds the session token among other cookies", () => {
    const token = newSecretToken();
    expect(readSessionCookie(null, SECURE, 4_096)).toEqual({ kind: "absent" });
    expect(readSessionCookie("", SECURE, 4_096)).toEqual({ kind: "absent" });
    expect(readSessionCookie("theme=dark; lang=ar", SECURE, 4_096)).toEqual({ kind: "absent" });
    expect(
      readSessionCookie(`theme=dark;${SECURE_SESSION_COOKIE}=${token};  lang="ar"`, SECURE, 4_096),
    ).toEqual({ kind: "token", token });
    expect(readSessionCookie(`${LOOPBACK_SESSION_COOKIE}=${token}`, SECURE, 4_096)).toEqual({
      kind: "absent",
    });
  });

  it("TST-AUTH-COOKIE-004 the parser fails closed on duplicates, malformed pairs, bad token shapes, and oversize headers", () => {
    const token = newSecretToken();
    const other = newSecretToken();
    const name = SECURE_SESSION_COOKIE;
    const cases: readonly (readonly [string, string])[] = [
      [`${name}=${token}; ${name}=${other}`, "duplicate"],
      [`${name}=${token}; ${name}=${token}`, "duplicate"],
      [`${name}=${token}; broken`, "malformed"],
      [`${name}=${token}; =value`, "malformed"],
      [`${name}=${token}; na me=x`, "malformed"],
      [`${name}=${token}; a=b,c`, "malformed"],
      [`${name}=${token.slice(1)}`, "malformed"],
      [`${name}="${token}"`, "malformed"],
      [`${name}=${token}x`, "malformed"],
      [`${name}=`, "malformed"],
    ];
    for (const [header, reason] of cases) {
      expect(readSessionCookie(header, SECURE, 4_096), header).toEqual({
        kind: "rejected",
        reason,
      });
    }
    expect(readSessionCookie(`${name}=${token}; pad=${"x".repeat(5_000)}`, SECURE, 4_096)).toEqual({
      kind: "rejected",
      reason: "too_large",
    });
  });

  it("TST-AUTH-COOKIE-005 production refuses insecure cookies; the resolver is production only with Secure cookies and production game access", () => {
    const h = accountsHarness();
    const resolver = (
      cookie: SessionCookiePolicy,
      gameAccess: GameAccessResolver = NO_GAME_ACCESS,
    ) =>
      new ProductionTrustedSessionResolver({
        sessions: h.accounts,
        gameAccess,
        cookie,
        maxCookieLength: 4_096,
      });
    expect(resolver(SECURE).trust).toBe("production");
    expect(resolver(LOOPBACK).trust).toBe("test_only");
    expect(resolver(SECURE, new TestGameAccess()).trust).toBe("test_only");
    const base: EdgeConfig = {
      environment: "production",
      allowedOrigins: ["https://play.example"],
      sessionResolver: resolver(SECURE),
      writers: runtimeHarness().registry,
      clock: new ManualClock(0),
      facts: new RecordingFacts(),
      reportDefect: new DefectLog().report,
    };
    expect(() =>
      resolveEdgeConfig({ ...base, auth: { accounts: h.accounts, cookie: "insecure_loopback" } }),
    ).toThrow(EdgeConfigError);
    expect(
      resolveEdgeConfig({ ...base, auth: { accounts: h.accounts, cookie: "secure" } }).auth?.cookie,
    ).toEqual(SECURE);
    expect(() => resolveEdgeConfig({ ...base, sessionResolver: resolver(LOOPBACK) })).toThrow(
      /production session resolver/,
    );
  });
});
