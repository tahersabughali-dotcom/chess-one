import type { GameSequence, Result } from "@chess-one/game-values";
import type { ActiveGameState, CommandBinding } from "../active-game.ts";
import type { GameFinishedV1 } from "../events.ts";
import type { GameId } from "../ids.ts";
import type { CorruptState } from "./state-codec.ts";

declare const clockDomainBrand: unique symbol;
declare const eventIdBrand: unique symbol;

/**
 * Opaque id of one writer's monotonic clock domain (DEC-063), for example one
 * process boot, supplied by the trusted writer host. Monotonic instants in a
 * stored clock are meaningful only inside the domain that stored them.
 */
export type ClockDomainId = string & { readonly [clockDomainBrand]: true };

/** Durable outbox event id, assigned by the persistence adapter (LIVE-CONTRACT-003). */
export type EventId = string & { readonly [eventIdBrand]: true };

export function isClockDomainId(value: string): value is ClockDomainId {
  return /^[A-Za-z0-9._:-]{1,128}$/.test(value);
}

export function isEventId(value: string): value is EventId {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

/** A game as stored, with the clock domain of the transition that last wrote it. */
export interface StoredGame {
  readonly state: ActiveGameState;
  readonly clockDomainId: ClockDomainId;
}

/** A database or driver failure. `code` is the SQLSTATE when known; no message or data. */
export interface PersistenceFailure {
  readonly kind: "persistence_failure";
  readonly operation: "load" | "create" | "commit";
  readonly code: string | null;
}

/** The stored sequence is no longer the one the decision was made on, or a binding raced. */
export interface ConcurrencyConflict {
  readonly kind: "concurrency_conflict";
  readonly expectedSequence: GameSequence;
}

export interface GameNotFound {
  readonly kind: "game_not_found";
}

export interface GameAlreadyExists {
  readonly kind: "game_already_exists";
}

export type LoadError = GameNotFound | CorruptState | PersistenceFailure;
export type CreateError = GameAlreadyExists | PersistenceFailure;
export type CommitError = ConcurrencyConflict | PersistenceFailure;

/**
 * What one decision must write, atomically:
 * - `bind_only`: a binding rejection. The state is unchanged; the stored
 *   sequence must still be `expectedSequence`.
 * - `transition`: a committed transition. The state row moves from
 *   `expectedSequence` to `state.sequence` (one more), with its binding, if
 *   any, and its events, in the same transaction.
 * - `control`: a control-lease rotation. Only `controlLeases` differs; the
 *   stored sequence must still be `expectedSequence`, and the stored clock
 *   domain is kept, so a rotation never re-anchors a paused clock.
 */
export type CommitPlan =
  | {
      readonly kind: "bind_only";
      readonly gameId: GameId;
      readonly expectedSequence: GameSequence;
      readonly binding: CommandBinding;
      readonly bindingOrdinal: number;
    }
  | {
      readonly kind: "transition";
      readonly gameId: GameId;
      readonly expectedSequence: GameSequence;
      readonly state: ActiveGameState;
      readonly binding: CommandBinding | null;
      readonly bindingOrdinal: number;
      readonly events: readonly GameFinishedV1[];
    }
  | {
      readonly kind: "control";
      readonly gameId: GameId;
      readonly expectedSequence: GameSequence;
      readonly state: ActiveGameState;
    };

export interface CommitReceipt {
  readonly eventIds: readonly EventId[];
}

/**
 * The Live Game repository contract, in aggregate terms. The adapter must
 * make each `commitDecision` one transaction that writes all of the plan or
 * nothing, and must compare the stored sequence before writing.
 */
export interface LiveGameRepository {
  loadGame(gameId: GameId): Promise<Result<StoredGame, LoadError>>;
  createGame(
    state: ActiveGameState,
    clockDomainId: ClockDomainId,
  ): Promise<Result<null, CreateError>>;
  commitDecision(
    plan: CommitPlan,
    clockDomainId: ClockDomainId,
  ): Promise<Result<CommitReceipt, CommitError>>;
}

function planDefect(message: string): never {
  throw new Error(`Live game persistence defect: ${message}`);
}

/** Every own field other than `field` is the same value, including fields added later. */
function unchangedExcept(
  previous: ActiveGameState,
  next: ActiveGameState,
  field: "commandBindings" | "controlLeases",
): boolean {
  const before = new Map(Object.entries(previous));
  const after = new Map(Object.entries(next));
  const names = new Set([...before.keys(), ...after.keys()]);
  names.delete(field);
  return [...names].every((name) => before.get(name) === after.get(name));
}

/** The game's identity is stored once and never rewritten by a transition. */
function sameGame(previous: ActiveGameState, next: ActiveGameState): boolean {
  return (
    next.gameId === previous.gameId &&
    next.rulesetId === previous.rulesetId &&
    next.players.white === previous.players.white &&
    next.players.black === previous.players.black
  );
}

/**
 * The write a decision needs, or null when it changed nothing. The live-game
 * core only ever appends at most one binding and moves the sequence by at
 * most one; anything else is a defect, never silently persisted.
 */
export function planCommit(
  previous: ActiveGameState,
  next: ActiveGameState,
  events: readonly GameFinishedV1[],
): CommitPlan | null {
  if (next === previous) {
    if (events.length > 0) planDefect("events without a state change");
    return null;
  }
  const before = previous.commandBindings;
  const after = next.commandBindings;
  if (after.length - before.length > 1 || after.length < before.length) {
    planDefect("a decision appends at most one binding");
  }
  if (before.some((binding, index) => after[index] !== binding)) {
    planDefect("stored bindings changed");
  }
  const binding = after[before.length] ?? null;
  const common = { gameId: previous.gameId, expectedSequence: previous.sequence };
  if (next.sequence === previous.sequence) {
    if (
      !unchangedExcept(previous, next, "commandBindings") ||
      binding === null ||
      events.length > 0
    ) {
      planDefect("a change without a sequence step");
    }
    return { kind: "bind_only", ...common, binding, bindingOrdinal: before.length };
  }
  if (next.sequence !== previous.sequence + 1) planDefect("the sequence moves by one");
  if (!sameGame(previous, next)) planDefect("a transition changed the game identity");
  if (
    next.controlLeases.white !== previous.controlLeases.white ||
    next.controlLeases.black !== previous.controlLeases.black
  ) {
    planDefect("a decision changed a control lease");
  }
  if (events.some((event) => event.gameSequence !== next.sequence)) {
    planDefect("an event of another sequence");
  }
  return {
    kind: "transition",
    ...common,
    state: next,
    binding,
    bindingOrdinal: before.length,
    events,
  };
}

/**
 * The write of a control-lease rotation. Decisions never change a lease
 * (`planCommit` refuses it as a defect); only this plan does, and it
 * changes nothing else.
 */
export function planLeaseRotation(previous: ActiveGameState, next: ActiveGameState): CommitPlan {
  if (next.sequence !== previous.sequence) planDefect("a rotation moved the sequence");
  if (next.commandBindings !== previous.commandBindings) planDefect("a rotation changed bindings");
  if (!unchangedExcept(previous, next, "controlLeases")) {
    planDefect("a rotation changed more than the leases");
  }
  const { white, black } = next.controlLeases;
  if (white === black) planDefect("a rotation shares one lease between seats");
  if (white === previous.controlLeases.white && black === previous.controlLeases.black) {
    planDefect("a rotation changed no lease");
  }
  return {
    kind: "control",
    gameId: previous.gameId,
    expectedSequence: previous.sequence,
    state: next,
  };
}
