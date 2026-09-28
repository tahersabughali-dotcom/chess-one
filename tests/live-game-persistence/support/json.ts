/** JSON values, for building corrupted copies of persisted records in tests. */
export type Json =
  | null
  | boolean
  | number
  | string
  | readonly Json[]
  | { readonly [key: string]: Json };

export const REMOVE: unique symbol = Symbol("remove");

export type Path = readonly (string | number)[];

/** A deep copy through JSON text, exactly what a database round trip preserves. */
export function viaJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value));
}

function isObject(node: Json): node is { readonly [key: string]: Json } {
  return typeof node === "object" && node !== null && !Array.isArray(node);
}

/** A copy of `node` with the value at `path` replaced, or removed with `REMOVE`. */
export function edit(node: Json, path: Path, value: Json | typeof REMOVE): Json {
  const [head, ...rest] = path;
  if (head === undefined) {
    if (value === REMOVE) throw new Error("cannot remove the root");
    return value;
  }
  const last = rest.length === 0;
  if (Array.isArray(node) && typeof head === "number") {
    const items: readonly Json[] = node;
    if (last && value === REMOVE) return items.filter((_, index) => index !== head);
    const child = items[head];
    if (child === undefined) throw new Error(`no element ${head}`);
    return items.map((item, index) => (index === head ? edit(child, rest, value) : item));
  }
  if (isObject(node) && typeof head === "string") {
    if (last) {
      return value === REMOVE
        ? Object.fromEntries(Object.entries(node).filter(([key]) => key !== head))
        : { ...node, [head]: value };
    }
    const child = node[head];
    if (child === undefined) throw new Error(`no field ${head}`);
    return { ...node, [head]: edit(child, rest, value) };
  }
  throw new Error(`path ${path.join(".")} does not fit the value`);
}

/** The value at `path`, for tests that derive a corruption from the stored value. */
export function read(node: Json, path: Path): Json {
  let current: Json = node;
  for (const step of path) {
    if (Array.isArray(current) && typeof step === "number") {
      const items: readonly Json[] = current;
      const next = items[step];
      if (next === undefined) throw new Error(`no element ${step}`);
      current = next;
    } else if (isObject(current) && typeof step === "string") {
      const next = current[step];
      if (next === undefined) throw new Error(`no field ${step}`);
      current = next;
    } else {
      throw new Error(`path ${path.join(".")} does not fit the value`);
    }
  }
  return current;
}
