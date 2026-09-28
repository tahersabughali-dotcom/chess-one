/**
 * Strict readers for persisted records. A persisted value is untrusted input:
 * every reader either returns the exact expected shape or throws
 * `CorruptRecord` with the path of the offending field. Nothing is coerced,
 * defaulted, or repaired. Reasons never repeat stored values, which include
 * control-lease ids.
 */
export class CorruptRecord extends Error {
  readonly path: string;
  readonly reason: string;

  constructor(path: string, reason: string) {
    super(`corrupt persisted record at ${path}: ${reason}`);
    this.path = path;
    this.reason = reason;
  }
}

export function corrupt(path: string, reason: string): never {
  throw new CorruptRecord(path, reason);
}

export type RecordFields = ReadonlyMap<string, unknown>;

/** A plain object with exactly `keys`: a missing or unexpected field is corruption. */
export function readObject(value: unknown, path: string, keys: readonly string[]): RecordFields {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    corrupt(path, "not an object");
  }
  const entries: [string, unknown][] = Object.entries(value);
  const fields = new Map(entries);
  for (const key of fields.keys()) {
    if (!keys.includes(key)) corrupt(`${path}.${key}`, "unexpected field");
  }
  for (const key of keys) {
    if (!fields.has(key)) corrupt(`${path}.${key}`, "missing field");
  }
  return fields;
}

/** One field of an object whose other fields depend on it, such as a `kind` tag. */
export function peek(value: unknown, path: string, key: string): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    corrupt(path, "not an object");
  }
  const entries: [string, unknown][] = Object.entries(value);
  return new Map(entries).get(key);
}

export function readArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) corrupt(path, "not an array");
  const items: unknown[] = value;
  return items;
}

export function readString(value: unknown, path: string): string {
  return typeof value === "string" ? value : corrupt(path, "not a string");
}

export function readBoolean(value: unknown, path: string): boolean {
  return typeof value === "boolean" ? value : corrupt(path, "not a boolean");
}

/** A non-negative safe integer. */
export function readCount(value: unknown, path: string): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : corrupt(path, "not a non-negative safe integer");
}

export function readNullable<T>(
  value: unknown,
  path: string,
  read: (value: unknown, path: string) => T,
): T | null {
  return value === null ? null : read(value, path);
}

/** A string accepted by `guard`, which narrows it to a branded or literal type. */
export function readGuarded<T extends string>(
  value: unknown,
  path: string,
  guard: (value: string) => value is T,
): T {
  const text = readString(value, path);
  return guard(text) ? text : corrupt(path, "unexpected value");
}

/** A guard for a closed set of literals, built from a record so the set stays exhaustive. */
export function literalGuard<T extends string>(
  members: Readonly<Record<T, true>>,
): (value: string) => value is T {
  return (value: string): value is T => Object.hasOwn(members, value);
}

export function field(fields: RecordFields, name: string): unknown {
  return fields.get(name);
}
