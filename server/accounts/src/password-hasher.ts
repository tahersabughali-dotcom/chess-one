import { argon2, argon2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { WorkGate } from "./work-gate.ts";

/**
 * Argon2id cost parameters. `memoryKiB` is the memory cost in KiB, `passes`
 * the time cost, `parallelism` the lane count; salt and tag sizes in bytes.
 */
export interface Argon2idParameters {
  readonly memoryKiB: number;
  readonly passes: number;
  readonly parallelism: number;
  readonly saltBytes: number;
  readonly tagBytes: number;
}

/**
 * RFC 9106 section 4, second recommended option: Argon2id, t=3, p=4,
 * m=64 MiB, 128-bit salt, 256-bit tag. The first option (2 GiB) does not fit
 * a shared server; this one is well above the OWASP minimum.
 */
export const RFC9106_SECOND_RECOMMENDED: Argon2idParameters = Object.freeze({
  memoryKiB: 65_536,
  passes: 3,
  parallelism: 4,
  saltBytes: 16,
  tagBytes: 32,
});

/**
 * OWASP Password Storage Cheat Sheet minimums for Argon2id, as memory (KiB)
 * per number of passes. Production parameters must meet one row.
 */
const OWASP_MINIMUMS: readonly (readonly [passes: number, memoryKiB: number])[] = [
  [1, 47_104],
  [2, 19_456],
  [3, 12_288],
  [4, 9_216],
  [5, 7_168],
];

/** Absolute bounds for any configuration, and for any stored hash we agree to verify. */
const CEILINGS = Object.freeze({
  memoryKiB: 1_048_576,
  passes: 16,
  parallelism: 16,
  saltBytes: 64,
  tagBytes: 64,
});

export type HasherStrength = "production" | "test_only";

export type HashOutcome =
  | { readonly kind: "hashed"; readonly hash: string }
  | { readonly kind: "busy" };

export type VerifyOutcome =
  | { readonly kind: "match"; readonly needsRehash: boolean }
  | { readonly kind: "mismatch" }
  | { readonly kind: "busy" };

export interface PasswordHasher {
  /** `test_only` parameters are below the production floor; production accounts refuse them. */
  readonly strength: HasherStrength;
  hash(password: string): Promise<HashOutcome>;
  /**
   * With `stored` null (no such account, or no password) a dummy hash of the
   * same cost is verified and the outcome is `mismatch`, so the missing
   * account costs the same time as a wrong password.
   */
  verify(password: string, stored: string | null): Promise<VerifyOutcome>;
}

export interface Argon2idHasherOptions {
  readonly parameters: Argon2idParameters;
  /** Concurrent derivations; each holds `memoryKiB` of memory. */
  readonly maxConcurrent: number;
  /** Derivations allowed to wait; beyond that a request is `busy`. */
  readonly maxWaiting: number;
}

export class PasswordHasherConfigError extends Error {
  override readonly name = "PasswordHasherConfigError";
}

interface ParsedHash {
  readonly parameters: Argon2idParameters;
  readonly salt: Uint8Array;
  readonly tag: Uint8Array;
}

const PHC =
  /^\$argon2id\$v=19\$m=([1-9][0-9]{0,9}),t=([1-9][0-9]{0,9}),p=([1-9][0-9]{0,7})\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

const encoder = new TextEncoder();

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64").replace(/=+$/, "");
}

/** Decodes unpadded base64, refusing any text that does not re-encode identically. */
function unbase64(text: string): Uint8Array | null {
  const bytes = Buffer.from(text, "base64");
  return base64(bytes) === text ? bytes : null;
}

export function encodePhc(
  parameters: Argon2idParameters,
  salt: Uint8Array,
  tag: Uint8Array,
): string {
  const { memoryKiB, passes, parallelism } = parameters;
  return `$argon2id$v=19$m=${memoryKiB},t=${passes},p=${parallelism}$${base64(salt)}$${base64(tag)}`;
}

export function parsePhc(text: string): ParsedHash | null {
  const match = PHC.exec(text);
  if (match === null) return null;
  const [, m = "", t = "", p = "", saltText = "", tagText = ""] = match;
  const salt = unbase64(saltText);
  const tag = unbase64(tagText);
  if (salt === null || tag === null) return null;
  const parameters: Argon2idParameters = {
    memoryKiB: Number(m),
    passes: Number(t),
    parallelism: Number(p),
    saltBytes: salt.length,
    tagBytes: tag.length,
  };
  return withinCeilings(parameters, 8, 16) ? { parameters, salt, tag } : null;
}

function withinCeilings(parameters: Argon2idParameters, minSalt: number, minTag: number): boolean {
  const { memoryKiB, passes, parallelism, saltBytes, tagBytes } = parameters;
  const integers = [memoryKiB, passes, parallelism, saltBytes, tagBytes];
  return (
    integers.every((value) => Number.isSafeInteger(value) && value >= 1) &&
    parallelism <= CEILINGS.parallelism &&
    memoryKiB >= 8 * parallelism &&
    memoryKiB <= CEILINGS.memoryKiB &&
    passes <= CEILINGS.passes &&
    saltBytes >= minSalt &&
    saltBytes <= CEILINGS.saltBytes &&
    tagBytes >= minTag &&
    tagBytes <= CEILINGS.tagBytes
  );
}

export function meetsProductionFloor(parameters: Argon2idParameters): boolean {
  return (
    parameters.saltBytes >= 16 &&
    parameters.tagBytes >= 32 &&
    OWASP_MINIMUMS.some(
      ([passes, memoryKiB]) => parameters.passes >= passes && parameters.memoryKiB >= memoryKiB,
    )
  );
}

function sameParameters(a: Argon2idParameters, b: Argon2idParameters): boolean {
  return (
    a.memoryKiB === b.memoryKiB &&
    a.passes === b.passes &&
    a.parallelism === b.parallelism &&
    a.saltBytes === b.saltBytes &&
    a.tagBytes === b.tagBytes
  );
}

function derive(
  message: Uint8Array,
  salt: Uint8Array,
  parameters: Argon2idParameters,
): Promise<Uint8Array> {
  const done = Promise.withResolvers<Uint8Array>();
  argon2(
    "argon2id",
    {
      message,
      nonce: salt,
      parallelism: parameters.parallelism,
      tagLength: parameters.tagBytes,
      memory: parameters.memoryKiB,
      passes: parameters.passes,
    },
    (error, key) => (error === null ? done.resolve(key) : done.reject(error)),
  );
  return done.promise;
}

/**
 * Known-answer check of the runtime's Argon2id against RFC 9106 section 5.3.
 * A Node build without Argon2 (for example one linked to an OpenSSL older
 * than 3.2) or a wrong implementation fails here, at startup.
 */
const RFC9106_ARGON2ID_TAG = "0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659";

export function argon2idSelfTest(): boolean {
  const tag = argon2Sync("argon2id", {
    message: new Uint8Array(32).fill(1),
    nonce: new Uint8Array(16).fill(2),
    secret: new Uint8Array(8).fill(3),
    associatedData: new Uint8Array(12).fill(4),
    parallelism: 4,
    tagLength: 32,
    memory: 32,
    passes: 3,
  });
  return Buffer.from(tag).toString("hex") === RFC9106_ARGON2ID_TAG;
}

/**
 * Argon2id through `node:crypto` (Node 24.7+, OpenSSL). Hashes are PHC
 * strings (`$argon2id$v=19$m=..,t=..,p=..$salt$tag`), so each carries its own
 * parameters: raising the configuration later marks older hashes
 * `needsRehash` at their next successful login, with no forced reset.
 */
export class Argon2idHasher implements PasswordHasher {
  readonly strength: HasherStrength;
  readonly parameters: Argon2idParameters;
  readonly #gate: WorkGate;
  readonly #dummy: ParsedHash;
  #derivations = 0;

  constructor(options: Argon2idHasherOptions) {
    const { parameters, maxConcurrent, maxWaiting } = options;
    if (!withinCeilings(parameters, 16, 16)) {
      throw new PasswordHasherConfigError("Argon2id parameters are out of range");
    }
    if (![maxConcurrent, maxWaiting].every((n) => Number.isSafeInteger(n) && n >= 1 && n <= 1024)) {
      throw new PasswordHasherConfigError("Hashing concurrency limits are out of range");
    }
    if (!argon2idSelfTest()) {
      throw new PasswordHasherConfigError("The runtime's Argon2id failed the RFC 9106 check");
    }
    this.parameters = Object.freeze({ ...parameters });
    this.strength = meetsProductionFloor(parameters) ? "production" : "test_only";
    this.#gate = new WorkGate(maxConcurrent, maxWaiting);
    const salt = randomBytes(parameters.saltBytes);
    const tag = argon2Sync("argon2id", {
      message: randomBytes(32),
      nonce: salt,
      parallelism: parameters.parallelism,
      tagLength: parameters.tagBytes,
      memory: parameters.memoryKiB,
      passes: parameters.passes,
    });
    this.#dummy = { parameters: this.parameters, salt, tag };
  }

  /** Argon2id derivations run so far, dummy ones included. */
  get derivations(): number {
    return this.#derivations;
  }

  async hash(password: string): Promise<HashOutcome> {
    const message = messageOf(password);
    const salt = randomBytes(this.parameters.saltBytes);
    const result = await this.#gate.run(() => this.#derive(message, salt, this.parameters));
    if (!result.ok) return { kind: "busy" };
    return { kind: "hashed", hash: encodePhc(this.parameters, salt, result.value) };
  }

  async verify(password: string, stored: string | null): Promise<VerifyOutcome> {
    const message = messageOf(password);
    const target = stored === null ? this.#dummy : parsePhc(stored);
    if (target === null) throw new Error("A stored password hash is not a supported PHC string");
    const result = await this.#gate.run(() =>
      this.#derive(message, target.salt, target.parameters),
    );
    if (!result.ok) return { kind: "busy" };
    const derived = result.value;
    const equal = derived.length === target.tag.length && timingSafeEqual(derived, target.tag);
    if (stored === null || !equal) return { kind: "mismatch" };
    return { kind: "match", needsRehash: !sameParameters(target.parameters, this.parameters) };
  }

  #derive(
    message: Uint8Array,
    salt: Uint8Array,
    parameters: Argon2idParameters,
  ): Promise<Uint8Array> {
    this.#derivations += 1;
    return derive(message, salt, parameters);
  }
}

/** UTF-8 of the password exactly as given; ill-formed text never reaches the hash. */
function messageOf(password: string): Uint8Array {
  if (!password.isWellFormed()) throw new Error("An ill-formed password reached the hasher");
  return encoder.encode(password);
}
