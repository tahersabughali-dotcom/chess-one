import {
  Argon2idHasher,
  AttemptLimiter,
  argon2idSelfTest,
  encodePhc,
  isSecretToken,
  isSessionId,
  meetsProductionFloor,
  newSecretToken,
  PasswordHasherConfigError,
  parsePhc,
  RFC9106_SECOND_RECOMMENDED,
  tokenDigest,
  WorkGate,
} from "@chess-one/accounts";
import { isUserId, type UserId } from "@chess-one/identity";
import { describe, expect, it } from "vitest";
import { accountsHarness, registered, TEST_ARGON2, testHasher } from "./support/harness.ts";

function userId(value: string): UserId {
  if (!isUserId(value)) throw new Error("bad user id");
  return value;
}

describe("TST-AUTH-HASH Argon2id password hashing", () => {
  it("TST-AUTH-HASH-001 the runtime's Argon2id passes the RFC 9106 known-answer test", () => {
    expect(argon2idSelfTest()).toBe(true);
  });

  it("TST-AUTH-HASH-002 each hash has its own random salt; verify matches the password and nothing else", async () => {
    const hasher = testHasher();
    const first = await hasher.hash("correct horse battery staple");
    const second = await hasher.hash("correct horse battery staple");
    if (first.kind !== "hashed" || second.kind !== "hashed") throw new Error("busy");
    expect(first.hash).not.toBe(second.hash);
    expect(parsePhc(first.hash)?.salt).not.toEqual(parsePhc(second.hash)?.salt);
    expect(first.hash).toMatch(
      /^\$argon2id\$v=19\$m=8,t=1,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/,
    );
    expect(first.hash).not.toContain("correct");
    expect(await hasher.verify("correct horse battery staple", first.hash)).toEqual({
      kind: "match",
      needsRehash: false,
    });
    expect(await hasher.verify("correct horse battery stapl", first.hash)).toEqual({
      kind: "mismatch",
    });
    expect(await hasher.verify("Correct horse battery staple", first.hash)).toEqual({
      kind: "mismatch",
    });
  });

  it("TST-AUTH-HASH-003 no truncation, trimming, or normalization: the 256th code point, surrounding spaces, and NFC vs NFD all matter", async () => {
    const hasher = testHasher();
    const long = `${"p".repeat(255)}\u{1F600}`;
    const hashed = await hasher.hash(long);
    if (hashed.kind !== "hashed") throw new Error("busy");
    expect(await hasher.verify(`${"p".repeat(255)}\u{1F601}`, hashed.hash)).toEqual({
      kind: "mismatch",
    });
    const spaced = await hasher.hash(" passphrase with spaces ");
    if (spaced.kind !== "hashed") throw new Error("busy");
    expect(await hasher.verify("passphrase with spaces", spaced.hash)).toEqual({
      kind: "mismatch",
    });
    const nfc = "caf\u00e9 au lait please";
    const composed = await hasher.hash(nfc);
    if (composed.kind !== "hashed") throw new Error("busy");
    expect(await hasher.verify(nfc.normalize("NFD"), composed.hash)).toEqual({ kind: "mismatch" });
    expect(await hasher.verify(nfc, composed.hash)).toMatchObject({ kind: "match" });
  });

  it("TST-AUTH-HASH-004 a hash made with other parameters still verifies and reports needsRehash", async () => {
    const old = testHasher({ ...TEST_ARGON2, memoryKiB: 16 });
    const current = testHasher();
    const stored = await old.hash("correct horse battery staple");
    if (stored.kind !== "hashed") throw new Error("busy");
    expect(await current.verify("correct horse battery staple", stored.hash)).toEqual({
      kind: "match",
      needsRehash: true,
    });
    expect(await current.verify("wrong horse battery staple", stored.hash)).toEqual({
      kind: "mismatch",
    });
  });

  it("TST-AUTH-HASH-005 verify with no stored hash runs a real derivation against the dummy hash and reports mismatch", async () => {
    const hasher = testHasher();
    const before = hasher.derivations;
    expect(await hasher.verify("anything at all", null)).toEqual({ kind: "mismatch" });
    expect(hasher.derivations).toBe(before + 1);
  });

  it("TST-AUTH-HASH-006 the production floor follows OWASP; RFC 9106's second option meets it and test parameters do not", () => {
    expect(meetsProductionFloor(RFC9106_SECOND_RECOMMENDED)).toBe(true);
    expect(
      meetsProductionFloor({ ...RFC9106_SECOND_RECOMMENDED, memoryKiB: 19_456, passes: 2 }),
    ).toBe(true);
    expect(
      meetsProductionFloor({ ...RFC9106_SECOND_RECOMMENDED, memoryKiB: 19_455, passes: 2 }),
    ).toBe(false);
    expect(meetsProductionFloor({ ...RFC9106_SECOND_RECOMMENDED, saltBytes: 8 })).toBe(false);
    expect(meetsProductionFloor({ ...RFC9106_SECOND_RECOMMENDED, tagBytes: 16 })).toBe(false);
    expect(meetsProductionFloor(TEST_ARGON2)).toBe(false);
    expect(testHasher().strength).toBe("test_only");
  });

  it("TST-AUTH-HASH-007 out-of-range parameters and limits are configuration errors", () => {
    const bad = [
      { ...TEST_ARGON2, memoryKiB: 4 },
      { ...TEST_ARGON2, parallelism: 2, memoryKiB: 8 },
      { ...TEST_ARGON2, saltBytes: 8 },
      { ...TEST_ARGON2, passes: 0 },
      { ...TEST_ARGON2, memoryKiB: 2_000_000 },
      { ...TEST_ARGON2, passes: 1.5 },
    ];
    for (const parameters of bad) {
      expect(() => new Argon2idHasher({ parameters, maxConcurrent: 1, maxWaiting: 1 })).toThrow(
        PasswordHasherConfigError,
      );
    }
    expect(
      () => new Argon2idHasher({ parameters: TEST_ARGON2, maxConcurrent: 0, maxWaiting: 1 }),
    ).toThrow(PasswordHasherConfigError);
  });

  it("TST-AUTH-HASH-008 PHC parsing is strict: canonical base64 only, bounded parameters, argon2id v19 only", () => {
    const salt = new Uint8Array(16).fill(7);
    const tag = new Uint8Array(32).fill(9);
    const phc = encodePhc(TEST_ARGON2, salt, tag);
    const parsed = parsePhc(phc);
    expect(parsed?.parameters).toEqual(TEST_ARGON2);
    expect([...(parsed?.salt ?? [])]).toEqual([...salt]);
    expect([...(parsed?.tag ?? [])]).toEqual([...tag]);
    for (const text of [
      phc.replace("argon2id", "argon2i"),
      phc.replace("v=19", "v=16"),
      phc.replace("m=8", "m=08"),
      phc.replace("m=8", "m=9999999999"),
      `${phc}=`,
      `${phc}$`,
      encodePhc(TEST_ARGON2, new Uint8Array(4), tag),
      encodePhc(TEST_ARGON2, salt, new Uint8Array(8)),
      "",
    ]) {
      expect(parsePhc(text), text).toBeNull();
    }
  });

  it("TST-AUTH-HASH-009 hashing is bounded: past the waiting limit a request is busy, not queued", async () => {
    const hasher = testHasher(TEST_ARGON2, { maxConcurrent: 1, maxWaiting: 1 });
    const outcomes = await Promise.all(
      Array.from({ length: 6 }, () => hasher.hash("correct horse battery staple")),
    );
    expect(outcomes.map((outcome) => outcome.kind)).toEqual([
      "hashed",
      "hashed",
      "busy",
      "busy",
      "busy",
      "busy",
    ]);
  });

  it("TST-AUTH-HASH-010 an unparsable stored hash is a defect, never a silent mismatch", async () => {
    await expect(testHasher().verify("password password", "plaintext")).rejects.toThrow(
      /not a supported PHC string/,
    );
  });
});

describe("TST-AUTH-TOKEN opaque tokens", () => {
  it("TST-AUTH-TOKEN-001 tokens are 256-bit CSPRNG values in base64url: no repeats across many draws", () => {
    const tokens = Array.from({ length: 2_000 }, () => newSecretToken());
    expect(new Set(tokens).size).toBe(tokens.length);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(isSecretToken(token)).toBe(true);
      expect(Buffer.from(token, "base64url")).toHaveLength(32);
    }
    const positions = new Set(tokens.map((token) => token.charAt(0)));
    expect(positions.size).toBeGreaterThan(50);
  });

  it("TST-AUTH-TOKEN-002 digests are SHA-256 under a purpose label: 32 bytes, never the token, never shared across purposes", () => {
    const token = newSecretToken();
    const session = Buffer.from(tokenDigest("session", token));
    const reset = Buffer.from(tokenDigest("password_reset", token));
    expect(session).toHaveLength(32);
    expect(session.equals(reset)).toBe(false);
    expect(session.toString("utf8")).not.toContain(token);
    expect(session.toString("base64url")).not.toBe(token);
  });

  it("TST-AUTH-TOKEN-003 malformed token shapes are refused before any lookup", () => {
    const token = newSecretToken();
    for (const value of [
      "",
      token.slice(1),
      `${token}A`,
      `${token.slice(0, 42)}B`,
      `${token.slice(0, 42)}=`,
      token.replace(/./, "+"),
    ]) {
      expect(isSecretToken(value), value).toBe(false);
    }
    expect(isSessionId("3f1c2a4e-9b7d-4c1e-8a2b-5d6e7f809a1b")).toBe(true);
    expect(isSessionId("not-a-session")).toBe(false);
  });
});

describe("TST-AUTH-LIMIT bounded in-memory structures", () => {
  it("TST-AUTH-LIMIT-001 the limiter allows a burst, then one attempt per refill interval, with an exact retry time", () => {
    const limiter = new AttemptLimiter({ burst: 3, refillEveryMs: 1_000 }, 100);
    expect([0, 0, 0].map((t) => limiter.take("k", t).allowed)).toEqual([true, true, true]);
    expect(limiter.take("k", 0)).toEqual({ allowed: false, retryAfterMs: 1_000 });
    expect(limiter.take("k", 400)).toEqual({ allowed: false, retryAfterMs: 600 });
    expect(limiter.take("k", 1_000)).toEqual({ allowed: true });
    expect(limiter.take("other", 1_000)).toEqual({ allowed: true });
  });

  it("TST-AUTH-LIMIT-002 the limiter never holds more than maxKeys buckets, however many keys arrive", () => {
    const limiter = new AttemptLimiter({ burst: 1, refillEveryMs: 60_000 }, 50);
    for (let i = 0; i < 10_000; i += 1) limiter.take(`key-${i}`, i);
    expect(limiter.size).toBeLessThanOrEqual(50);
  });

  it("TST-AUTH-LIMIT-003 the work gate caps running and waiting tasks", async () => {
    const gate = new WorkGate(1, 1);
    const release = Promise.withResolvers<void>();
    const first = gate.run(() => release.promise.then(() => 1));
    const second = gate.run(async () => 2);
    const third = await gate.run(async () => 3);
    expect(third).toEqual({ ok: false });
    expect([gate.active, gate.waiting]).toEqual([1, 1]);
    release.resolve();
    expect(await first).toEqual({ ok: true, value: 1 });
    expect(await second).toEqual({ ok: true, value: 2 });
    expect([gate.active, gate.waiting]).toEqual([0, 0]);
  });

  it("TST-AUTH-LIMIT-004 revocation watchers are removed when they fire or unsubscribe, so the registry holds only open connections", async () => {
    const h = accountsHarness();
    const signed = await registered(h, "watcher");
    const session = { sessionId: signed.session.sessionId, userId: signed.session.userId };
    let ended = 0;
    const unwatch = h.accounts.watchSession(session, () => {
      ended += 1;
    });
    h.accounts.watchSession(session, () => {
      ended += 1;
    })();
    expect(h.accounts.watcherCount).toBe(1);
    await h.accounts.logout(signed.session.token);
    expect(ended).toBe(1);
    expect(h.accounts.watcherCount).toBe(0);
    unwatch();
    expect(h.accounts.watcherCount).toBe(0);
    h.accounts.watchSession(
      { ...session, userId: userId("3f1c2a4e-9b7d-4c1e-8a2b-5d6e7f809a1b") },
      () => {
        ended += 1;
      },
    );
    expect(h.accounts.watcherCount).toBe(1);
  });
});
