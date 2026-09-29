/** Epoch milliseconds from the accounts wall clock, as ISO-8601 text for a `timestamptz` parameter. */
export function toTimestamp(epochMs: number): string {
  if (!Number.isSafeInteger(epochMs))
    throw new RangeError("Wall time must be integer milliseconds");
  return new Date(epochMs).toISOString();
}
