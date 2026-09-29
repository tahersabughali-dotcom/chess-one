/**
 * A strict RFC 8259 parser for small untrusted messages. Unlike `JSON.parse`
 * it rejects duplicate keys, bounds depth, key count, array length, and
 * string length while parsing, and rejects strings that are not well-formed
 * Unicode. Objects are `Map`s, so no key (`__proto__` included) ever touches
 * a prototype.
 */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;
export type JsonObject = ReadonlyMap<string, JsonValue>;

export interface JsonLimits {
  /** 1 allows one object or array with scalar members only. */
  readonly maxDepth: number;
  readonly maxStringLength: number;
  readonly maxObjectKeys: number;
  readonly maxArrayLength: number;
}

export type JsonError =
  | "invalid_json"
  | "duplicate_key"
  | "too_deep"
  | "string_too_long"
  | "too_many_keys"
  | "array_too_long"
  | "malformed_unicode"
  | "number_out_of_range";

export type JsonResult =
  | { readonly ok: true; readonly value: JsonValue }
  | { readonly ok: false; readonly error: JsonError };

class JsonFailure extends Error {
  readonly reason: JsonError;

  constructor(reason: JsonError) {
    super(reason);
    this.reason = reason;
  }
}

const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
const HEX4 = /^[0-9A-Fa-f]{4}$/;

const ESCAPES: ReadonlyMap<string, string> = new Map([
  ['"', '"'],
  ["\\", "\\"],
  ["/", "/"],
  ["b", "\b"],
  ["f", "\f"],
  ["n", "\n"],
  ["r", "\r"],
  ["t", "\t"],
]);

class Parser {
  readonly #text: string;
  readonly #limits: JsonLimits;
  #pos = 0;

  constructor(text: string, limits: JsonLimits) {
    this.#text = text;
    this.#limits = limits;
  }

  document(): JsonValue {
    this.#space();
    const value = this.#value(1);
    this.#space();
    if (this.#pos !== this.#text.length) throw new JsonFailure("invalid_json");
    return value;
  }

  #value(depth: number): JsonValue {
    const char = this.#text[this.#pos];
    switch (char) {
      case "{":
        return this.#object(depth);
      case "[":
        return this.#array(depth);
      case '"':
        return this.#string();
      case "t":
        return this.#literal("true", true);
      case "f":
        return this.#literal("false", false);
      case "n":
        return this.#literal("null", null);
      default:
        return this.#number();
    }
  }

  #object(depth: number): JsonObject {
    if (depth > this.#limits.maxDepth) throw new JsonFailure("too_deep");
    this.#pos += 1;
    const members = new Map<string, JsonValue>();
    this.#space();
    if (this.#text[this.#pos] === "}") {
      this.#pos += 1;
      return members;
    }
    for (;;) {
      this.#space();
      if (this.#text[this.#pos] !== '"') throw new JsonFailure("invalid_json");
      const key = this.#string();
      if (members.has(key)) throw new JsonFailure("duplicate_key");
      this.#space();
      this.#expect(":");
      this.#space();
      members.set(key, this.#value(depth + 1));
      if (members.size > this.#limits.maxObjectKeys) throw new JsonFailure("too_many_keys");
      this.#space();
      if (this.#text[this.#pos] === ",") {
        this.#pos += 1;
        continue;
      }
      this.#expect("}");
      return members;
    }
  }

  #array(depth: number): readonly JsonValue[] {
    if (depth > this.#limits.maxDepth) throw new JsonFailure("too_deep");
    this.#pos += 1;
    const items: JsonValue[] = [];
    this.#space();
    if (this.#text[this.#pos] === "]") {
      this.#pos += 1;
      return items;
    }
    for (;;) {
      this.#space();
      if (items.length >= this.#limits.maxArrayLength) throw new JsonFailure("array_too_long");
      items.push(this.#value(depth + 1));
      this.#space();
      if (this.#text[this.#pos] === ",") {
        this.#pos += 1;
        continue;
      }
      this.#expect("]");
      return items;
    }
  }

  #string(): string {
    this.#pos += 1;
    let out = "";
    for (;;) {
      const char = this.#text[this.#pos];
      if (char === undefined) throw new JsonFailure("invalid_json");
      this.#pos += 1;
      if (char === '"') break;
      if (char === "\\") {
        out += this.#escape();
      } else if (char.charCodeAt(0) < 0x20) {
        throw new JsonFailure("invalid_json");
      } else {
        out += char;
      }
      if (out.length > this.#limits.maxStringLength) throw new JsonFailure("string_too_long");
    }
    if (!out.isWellFormed()) throw new JsonFailure("malformed_unicode");
    return out;
  }

  #escape(): string {
    const code = this.#text[this.#pos];
    this.#pos += 1;
    if (code === "u") {
      const hex = this.#text.slice(this.#pos, this.#pos + 4);
      if (!HEX4.test(hex)) throw new JsonFailure("invalid_json");
      this.#pos += 4;
      return String.fromCharCode(Number.parseInt(hex, 16));
    }
    const escaped = code === undefined ? undefined : ESCAPES.get(code);
    if (escaped === undefined) throw new JsonFailure("invalid_json");
    return escaped;
  }

  #number(): number {
    NUMBER.lastIndex = this.#pos;
    const match = NUMBER.exec(this.#text);
    if (match === null) throw new JsonFailure("invalid_json");
    const value = Number(match[0]);
    if (!Number.isFinite(value)) throw new JsonFailure("number_out_of_range");
    this.#pos += match[0].length;
    return value;
  }

  #literal<T extends boolean | null>(word: string, value: T): T {
    if (!this.#text.startsWith(word, this.#pos)) throw new JsonFailure("invalid_json");
    this.#pos += word.length;
    return value;
  }

  #expect(char: string): void {
    if (this.#text[this.#pos] !== char) throw new JsonFailure("invalid_json");
    this.#pos += 1;
  }

  #space(): void {
    for (;;) {
      const char = this.#text[this.#pos];
      if (char !== " " && char !== "\t" && char !== "\n" && char !== "\r") return;
      this.#pos += 1;
    }
  }
}

export function parseStrictJson(text: string, limits: JsonLimits): JsonResult {
  try {
    return { ok: true, value: new Parser(text, limits).document() };
  } catch (error: unknown) {
    if (error instanceof JsonFailure) return { ok: false, error: error.reason };
    throw error;
  }
}

export function isJsonObject(value: JsonValue): value is JsonObject {
  return value instanceof Map;
}
