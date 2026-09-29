import type { WallClock } from "./clock.ts";

/** The host's wall clock. The only place in this package that reads time. */
export function createSystemWallClock(): WallClock {
  return { now: () => Date.now() };
}
