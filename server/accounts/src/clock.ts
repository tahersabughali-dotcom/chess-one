/**
 * Wall-clock time in whole Unix milliseconds. Sessions and tokens expire in
 * wall time because they outlive processes; chess time never uses this.
 */
export interface WallClock {
  now(): number;
}
