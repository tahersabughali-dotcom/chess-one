import { type Color, type DurationMs, isDurationMs, parseDurationMs } from "@chess-one/game-values";

declare const monotonicMsBrand: unique symbol;
declare const wallClockMsBrand: unique symbol;

/**
 * DEC-061, DEC-063: an instant, in whole milliseconds, of the authoritative
 * Live Game writer's own monotonic clock, stamped at ingress before rule
 * processing and before the writer's queue. It is meaningful only inside that
 * writer process: never compare it with another process's monotonic value, a
 * client stamp, or wall clock, and never persist it as a universal timestamp.
 * Recovery after a restart resumes from committed balances, not by comparing
 * the monotonic epochs of different processes.
 */
export type MonotonicMs = number & { readonly [monotonicMsBrand]: true };

/**
 * UTC wall-clock epoch milliseconds. Never decides a move deadline or a flag;
 * its one decision is the pre-game start deadline (`awaiting_players`), which
 * no chess clock is running against.
 */
export type WallClockMs = number & { readonly [wallClockMsBrand]: true };

export function isMonotonicMs(value: number): value is MonotonicMs {
  return Number.isSafeInteger(value) && value >= 0;
}

export function isWallClockMs(value: number): value is WallClockMs {
  return Number.isSafeInteger(value) && value >= 0;
}

/**
 * The only modelled time control: both sides start with the same budget and
 * there is no increment or delay. Other kinds need an approved product policy.
 */
export interface TimeControl {
  readonly kind: "sudden_death";
  readonly initialMs: DurationMs;
}

/** A sudden-death control with `initialMs` for each side, or null for no positive whole budget. */
export function suddenDeath(initialMs: number): TimeControl | null {
  if (!isDurationMs(initialMs) || initialMs === 0) return null;
  return Object.freeze({ kind: "sudden_death", initialMs });
}

/**
 * Server-authoritative clock with integer balances. While `running`, the
 * active side's balance was last settled at `anchorMs`, so its live balance at
 * instant t is `remainingMs[activeSide] - (t - anchorMs)`. The other balance
 * changes only through a committed transition.
 */
export interface ClockState {
  readonly timeControl: TimeControl;
  readonly remainingMs: Readonly<Record<Color, DurationMs>>;
  readonly activeSide: Color;
  readonly running: boolean;
  readonly anchorMs: MonotonicMs;
}

/**
 * LIVE_GAME_EVENT_ORDERING_V1 section 3: a command received at or before the
 * deadline is in time, however long processing takes afterwards; one received
 * after it is late. Elapsed time ends at `received_at`.
 */
export type ReceiptTiming =
  | { readonly timely: true; readonly elapsedMs: DurationMs; readonly remainingMs: DurationMs }
  | { readonly timely: false; readonly elapsedMs: DurationMs };

function clockDefect(message: string): never {
  throw new Error(`Clock defect: ${message}`);
}

const NO_TIME: DurationMs = parseDurationMs(0) ?? clockDefect("zero is not a duration");

function withChanges(clock: ClockState, changes: Partial<ClockState>): ClockState {
  return Object.freeze({ ...clock, ...changes });
}

function balances(white: DurationMs, black: DurationMs): Readonly<Record<Color, DurationMs>> {
  return Object.freeze({ white, black });
}

function withBalance(clock: ClockState, side: Color, ms: DurationMs): ClockState {
  const { white, black } = clock.remainingMs;
  return withChanges(clock, {
    remainingMs: side === "white" ? balances(ms, black) : balances(white, ms),
  });
}

/** `activeSide`'s clock runs from `startedAt`, the moment the trusted caller starts the game. */
export function startClock(
  timeControl: TimeControl,
  startedAt: MonotonicMs,
  activeSide: Color,
): ClockState {
  return Object.freeze({
    timeControl: Object.freeze({ ...timeControl }),
    remainingMs: balances(timeControl.initialMs, timeControl.initialMs),
    activeSide,
    running: true,
    anchorMs: startedAt,
  });
}

function instant(value: number): MonotonicMs {
  return isMonotonicMs(value) ? value : clockDefect("not an instant");
}

const NO_ANCHOR: MonotonicMs = instant(0);

/**
 * The clock of a game awaiting its players: full balances, the first side to
 * move marked active, not running, and no anchor (`anchorMs` 0 means nothing
 * while stopped). The start transition anchors it in the writer's domain.
 */
export function awaitingClock(timeControl: TimeControl, firstToMove: Color): ClockState {
  return Object.freeze({
    timeControl: Object.freeze({ ...timeControl }),
    remainingMs: balances(timeControl.initialMs, timeControl.initialMs),
    activeSide: firstToMove,
    running: false,
    anchorMs: NO_ANCHOR,
  });
}

/** Whether `clock` is exactly an `awaitingClock`. */
export function isAwaitingClock(clock: ClockState): boolean {
  const { initialMs } = clock.timeControl;
  return (
    !clock.running &&
    clock.anchorMs === NO_ANCHOR &&
    clock.remainingMs.white === initialMs &&
    clock.remainingMs.black === initialMs
  );
}

/**
 * Timing of a command received at `receivedAt` against the running clock. A
 * receipt earlier than the anchor means the writer processed commands out of
 * ingress order, which is a programming defect.
 */
export function receiptTiming(clock: ClockState, receivedAt: MonotonicMs): ReceiptTiming {
  if (!clock.running) clockDefect("the clock is stopped");
  const elapsed = receivedAt - clock.anchorMs;
  if (!isDurationMs(elapsed)) clockDefect("receipt precedes the clock anchor");
  const remaining = clock.remainingMs[clock.activeSide] - elapsed;
  return isDurationMs(remaining)
    ? Object.freeze({ timely: true, elapsedMs: elapsed, remainingMs: remaining })
    : Object.freeze({ timely: false, elapsedMs: elapsed });
}

/** Charges the active side up to `receivedAt` and re-anchors there; the receipt must be timely. */
export function chargeToReceipt(clock: ClockState, receivedAt: MonotonicMs): ClockState {
  const timing = receiptTiming(clock, receivedAt);
  if (!timing.timely) clockDefect("charging a late receipt");
  return withChanges(withBalance(clock, clock.activeSide, timing.remainingMs), {
    anchorMs: receivedAt,
  });
}

/** The other side becomes active from the current anchor. */
export function passTurn(clock: ClockState): ClockState {
  return withChanges(clock, { activeSide: clock.activeSide === "white" ? "black" : "white" });
}

export function stopClock(clock: ClockState): ClockState {
  return withChanges(clock, { running: false });
}

/** Adds `ms` to one side's balance, as article 9.5.3 requires for an incorrect claim. */
export function addTime(clock: ClockState, side: Color, ms: DurationMs): ClockState {
  const total = clock.remainingMs[side] + ms;
  if (!isDurationMs(total)) clockDefect("balance overflow");
  return withBalance(clock, side, total);
}

/** The active side's time has run out: its balance is zero and the clock stops at `receivedAt`. */
export function flagActive(clock: ClockState, receivedAt: MonotonicMs): ClockState {
  const timing = receiptTiming(clock, receivedAt);
  if (timing.timely) clockDefect("flagging a timely receipt");
  return withChanges(withBalance(clock, clock.activeSide, NO_TIME), {
    running: false,
    anchorMs: receivedAt,
  });
}
