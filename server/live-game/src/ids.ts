import type { Color } from "@chess-one/game-values";

declare const gameIdBrand: unique symbol;
declare const playerIdBrand: unique symbol;
declare const commandIdBrand: unique symbol;
declare const controlLeaseIdBrand: unique symbol;

/** Stable id of one live game. Supplied by the caller; the core never generates ids. */
export type GameId = string & { readonly [gameIdBrand]: true };
/** Stable id of a player account or guest. Never a display name. */
export type PlayerId = string & { readonly [playerIdBrand]: true };
/** A client's idempotency key, scoped to one game and one seat. */
export type CommandId = string & { readonly [commandIdBrand]: true };
/** Server-issued controller lease for one seat (DEC-043). */
export type ControlLeaseId = string & { readonly [controlLeaseIdBrand]: true };

/** The side a player occupies in one game. */
export type Seat = Color;

const STABLE_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function isGameId(value: string): value is GameId {
  return STABLE_ID.test(value);
}

export function isPlayerId(value: string): value is PlayerId {
  return STABLE_ID.test(value);
}

export function isCommandId(value: string): value is CommandId {
  return STABLE_ID.test(value);
}

export function isControlLeaseId(value: string): value is ControlLeaseId {
  return STABLE_ID.test(value);
}
