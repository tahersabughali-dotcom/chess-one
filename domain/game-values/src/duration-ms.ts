declare const durationMsBrand: unique symbol;

/** A duration in whole milliseconds. A non-negative safe integer. */
export type DurationMs = number & { readonly [durationMsBrand]: true };

export function isDurationMs(value: number): value is DurationMs {
  return Number.isSafeInteger(value) && value >= 0;
}

export function parseDurationMs(value: number): DurationMs | undefined {
  return isDurationMs(value) ? value : undefined;
}
