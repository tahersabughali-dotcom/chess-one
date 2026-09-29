import {
  canAuthenticate,
  checkNewPassword,
  checkPasswordInput,
  isAccountStatus,
  isCanonicalEmail,
  isCanonicalUsername,
  isUserId,
  PASSWORD_POLICY,
  type PasswordContext,
  parseEmail,
  parseLoginIdentifier,
  parseUsername,
} from "@chess-one/identity";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

function context(username: string, email: string): PasswordContext {
  const name = parseUsername(username);
  const address = parseEmail(email);
  if (!name.ok || !address.ok) throw new Error("bad fixture");
  return { username: name.value.canonical, email: address.value.canonical };
}

const CONTEXT = context("Taher", "taher@example.test");

describe("TST-AUTH-ID usernames", () => {
  it("TST-AUTH-ID-001 Taher, taher, and TAHER are one canonical name; the display form is kept exactly", () => {
    const forms = ["Taher", "taher", "TAHER"].map(parseUsername);
    expect(forms.map((form) => form.ok && form.value.canonical)).toEqual([
      "taher",
      "taher",
      "taher",
    ]);
    expect(forms.map((form) => form.ok && form.value.display)).toEqual(["Taher", "taher", "TAHER"]);
  });

  it("TST-AUTH-ID-002 the alphabet is ASCII letters, digits, _ and -, 3 to 24 long, alphanumeric at both ends, no double separators, no reserved names", () => {
    const cases: readonly (readonly [string, string])[] = [
      ["ab", "too_short"],
      ["a".repeat(25), "too_long"],
      ["tahér", "invalid_characters"],
      ["ta her", "invalid_characters"],
      [" taher", "invalid_characters"],
      ["taher\u200b", "invalid_characters"],
      ["tаher", "invalid_characters"],
      ["ta.her", "invalid_characters"],
      ["ta@her", "invalid_characters"],
      ["_taher", "invalid_edge"],
      ["taher-", "invalid_edge"],
      ["ta__her", "consecutive_separators"],
      ["ta-_her", "consecutive_separators"],
      ["Admin", "reserved"],
      ["SUPPORT", "reserved"],
      ["chess-one", "reserved"],
    ];
    for (const [input, reason] of cases) {
      expect(parseUsername(input), input).toEqual({ ok: false, reason });
    }
    for (const input of ["abc", "a".repeat(24), "Ta-her_99", "0x0"]) {
      expect(parseUsername(input).ok, input).toBe(true);
    }
  });

  it("TST-AUTH-ID-003 property: any accepted username is its own display, and its canonical form is ASCII lowercase within the stored pattern", () => {
    const glyph = fc.constantFrom(..."aZ9_-.é@ \u0130\u212a".split(""));
    fc.assert(
      fc.property(fc.array(glyph, { minLength: 0, maxLength: 30 }), (chars) => {
        const input = chars.join("");
        const parsed = parseUsername(input);
        if (!parsed.ok) return;
        expect(parsed.value.display).toBe(input);
        expect(isCanonicalUsername(parsed.value.canonical)).toBe(true);
        expect(parsed.value.canonical).toMatch(/^[a-z0-9][a-z0-9_-]{1,22}[a-z0-9]$/);
        expect(parsed.value.canonical).toBe(input.toLowerCase());
      }),
      { numRuns: 2_000 },
    );
  });
});

describe("TST-AUTH-ID email addresses", () => {
  it("TST-AUTH-ID-004 only surrounding whitespace is trimmed and case is folded; dots and +tags are kept (no provider rules)", () => {
    const parsed = parseEmail("  Taher.Ali+Chess@Example.TEST \t");
    expect(parsed).toEqual({
      ok: true,
      value: { display: "Taher.Ali+Chess@Example.TEST", canonical: "taher.ali+chess@example.test" },
    });
    const plain = parseEmail("taherali@example.test");
    expect(plain.ok && plain.value.canonical).not.toBe(parsed.ok && parsed.value.canonical);
  });

  it("TST-AUTH-ID-005 malformed, non-ASCII, and oversized addresses are refused", () => {
    const cases: readonly (readonly [string, string])[] = [
      ["", "empty"],
      ["   ", "empty"],
      [`${"a".repeat(64)}@${"b".repeat(186)}.test`, "too_long"],
      ["tähir@example.test", "unsupported_characters"],
      ["a b@example.test", "unsupported_characters"],
      ["taher", "invalid_format"],
      ["a@b@example.test", "invalid_format"],
      [`${"a".repeat(65)}@example.test`, "invalid_local_part"],
      [".taher@example.test", "invalid_local_part"],
      ["ta..her@example.test", "invalid_local_part"],
      ['"t"@example.test', "invalid_local_part"],
      ["taher@localhost", "invalid_domain"],
      ["taher@example.123", "invalid_domain"],
      ["taher@-example.test", "invalid_domain"],
      ["taher@[127.0.0.1]", "invalid_domain"],
    ];
    for (const [input, reason] of cases) {
      expect(parseEmail(input), input).toEqual({ ok: false, reason });
    }
  });

  it("TST-AUTH-ID-006 property: an accepted address's canonical form is the lowercase of its display and passes the stored-form check", () => {
    const local = fc.stringMatching(/^[A-Za-z0-9+_]{1,20}$/);
    const label = fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{0,10}$/);
    fc.assert(
      fc.property(local, label, label, fc.constantFrom("", " ", "\t"), (l, d, t, pad) => {
        const parsed = parseEmail(`${pad}${l}@${d}.${t}${pad}`);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.value.canonical).toBe(parsed.value.display.toLowerCase());
        expect(isCanonicalEmail(parsed.value.canonical)).toBe(true);
      }),
      { numRuns: 1_000 },
    );
  });
});

describe("TST-AUTH-ID passwords", () => {
  it("TST-AUTH-ID-007 15 to 256 code points; passphrases with spaces are fine; nothing is trimmed", () => {
    expect(PASSWORD_POLICY).toEqual({ minLength: 15, maxLength: 256 });
    expect(checkNewPassword("x".repeat(14), CONTEXT)).toEqual({ ok: false, reason: "too_short" });
    expect(checkNewPassword("x".repeat(15), CONTEXT)).toEqual({ ok: true });
    expect(checkNewPassword("x".repeat(256), CONTEXT)).toEqual({ ok: true });
    expect(checkNewPassword("x".repeat(257), CONTEXT)).toEqual({ ok: false, reason: "too_long" });
    expect(checkNewPassword("fourteen chars", CONTEXT)).toEqual({ ok: false, reason: "too_short" });
    expect(checkNewPassword("fifteen letters", CONTEXT)).toEqual({ ok: true });
    expect(checkNewPassword("abc ".repeat(64), CONTEXT)).toEqual({ ok: true });
    expect(checkNewPassword(`${"abc ".repeat(64)}d`, CONTEXT)).toEqual({
      ok: false,
      reason: "too_long",
    });
    expect(checkNewPassword("   padded pass   ", CONTEXT)).toEqual({ ok: true });
    expect(checkNewPassword("          short", CONTEXT)).toEqual({ ok: true });
    expect(checkNewPassword("         short", CONTEXT)).toEqual({ ok: false, reason: "too_short" });
    expect(checkNewPassword(" ".repeat(14), CONTEXT)).toEqual({ ok: false, reason: "too_short" });
  });

  it("TST-AUTH-ID-008 length counts code points, not UTF-16 units: 256 emoji fit, 257 do not; ill-formed text and controls are refused", () => {
    const emoji = "\u{1F600}";
    expect(checkNewPassword(emoji.repeat(15), CONTEXT)).toEqual({ ok: true });
    expect(checkNewPassword(emoji.repeat(14), CONTEXT)).toEqual({ ok: false, reason: "too_short" });
    expect(checkNewPassword(emoji.repeat(256), CONTEXT)).toEqual({ ok: true });
    expect(checkNewPassword(emoji.repeat(257), CONTEXT)).toEqual({
      ok: false,
      reason: "too_long",
    });
    expect(checkNewPassword(`long enough pass\ud800`, CONTEXT)).toEqual({
      ok: false,
      reason: "malformed_unicode",
    });
    for (const control of ["\u0000", "\n", "\u001f", "\u007f", "\u0085"]) {
      expect(checkNewPassword(`long enough${control}pass`, CONTEXT)).toEqual({
        ok: false,
        reason: "control_characters",
      });
    }
  });

  it("TST-AUTH-ID-009 a new password may not be the username or email in any case", () => {
    const withLongName = context("TaherTheGreatest", "taher@example.test");
    for (const password of ["tahERthegreATEST", "TAHER@EXAMPLE.TEST"]) {
      expect(checkNewPassword(password, withLongName)).toEqual({
        ok: false,
        reason: "matches_account_identifier",
      });
    }
  });

  it("TST-AUTH-ID-010 login input only needs to be encodable and bounded, so accounts made under an older minimum still sign in", () => {
    expect(checkPasswordInput("short")).toEqual({ ok: true });
    expect(checkPasswordInput("")).toEqual({ ok: false, reason: "too_short" });
    expect(checkPasswordInput("x".repeat(257))).toEqual({ ok: false, reason: "too_long" });
    expect(checkPasswordInput("a\udc00b")).toEqual({ ok: false, reason: "malformed_unicode" });
  });

  it("TST-AUTH-ID-011 property: the policy never changes the password; NFC and NFD forms of a password are both accepted as different inputs", () => {
    fc.assert(
      fc.property(fc.string({ unit: "grapheme", minLength: 15, maxLength: 64 }), (password) => {
        const before = password;
        checkNewPassword(password, CONTEXT);
        expect(password).toBe(before);
      }),
    );
    const nfc = "caf\u00e9 au lait please";
    const nfd = nfc.normalize("NFD");
    expect(nfd).not.toBe(nfc);
    expect(checkNewPassword(nfc, CONTEXT)).toEqual({ ok: true });
    expect(checkNewPassword(nfd, CONTEXT)).toEqual({ ok: true });
  });
});

describe("TST-AUTH-ID identifiers and statuses", () => {
  it("TST-AUTH-ID-012 a login identifier with @ is an email, without it a username; anything else is unknown", () => {
    expect(parseLoginIdentifier("TAHER")).toEqual({ kind: "username", canonical: "taher" });
    expect(parseLoginIdentifier(" Taher@Example.test ")).toEqual({
      kind: "email",
      canonical: "taher@example.test",
    });
    expect(parseLoginIdentifier("admin")).toEqual({ kind: "username", canonical: "admin" });
    for (const input of ["", "ab", "ta her", "a@b", "x".repeat(300)]) {
      expect(parseLoginIdentifier(input), input).toEqual({ kind: "unknown" });
    }
  });

  it("TST-AUTH-ID-013 user ids are random v4 UUIDs in lowercase; only active accounts authenticate", () => {
    expect(isUserId("3f1c2a4e-9b7d-4c1e-8a2b-5d6e7f809a1b")).toBe(true);
    expect(isUserId("3F1C2A4E-9B7D-4C1E-8A2B-5D6E7F809A1B")).toBe(false);
    expect(isUserId("taher")).toBe(false);
    expect(isUserId("3f1c2a4e-9b7d-1c1e-8a2b-5d6e7f809a1b")).toBe(false);
    expect(["active", "disabled", "locked", "banned"].map(isAccountStatus)).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(canAuthenticate("active")).toBe(true);
    expect(canAuthenticate("disabled")).toBe(false);
    expect(canAuthenticate("locked")).toBe(false);
  });
});
