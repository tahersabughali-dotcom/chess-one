import type { SignedIn } from "@chess-one/accounts";
import {
  type AssignmentPolicy,
  GameAccess,
  type GameAccessDecision,
  type GameAccessFact,
  type GameAccessLimits,
  type GameAccessStore,
  type SessionGameAuthority,
} from "@chess-one/game-access";
import {
  type ControlLeaseId,
  type GameId,
  isPlayerId,
  type PlayerId,
  type TimeControl,
} from "@chess-one/live-game-runtime";
import {
  type AccountsHarness,
  type AccountsHarnessOptions,
  accountsHarness,
  registered,
} from "../../accounts/support/harness.ts";
import { duration, GAME_ID, INITIAL_MS } from "../../live-game/support/harness.ts";
import { DefectLog, RecordingFacts } from "../../realtime/support/facts.ts";
import { type RuntimeHarness, runtimeHarness } from "../../realtime/support/runtime.ts";
import { MemoryGameAccessStore } from "./memory-store.ts";

export const TIME_CONTROL: TimeControl = Object.freeze({
  kind: "sudden_death",
  initialMs: duration(INITIAL_MS),
});

export interface GameAccessHarnessOptions {
  readonly store?: GameAccessStore;
  readonly limits?: Partial<GameAccessLimits>;
  readonly assignmentPolicy?: Partial<AssignmentPolicy>;
  readonly accounts?: AccountsHarnessOptions;
  readonly runtime?: RuntimeHarness;
}

export interface GameAccessHarness {
  readonly accounts: AccountsHarness;
  readonly runtime: RuntimeHarness;
  readonly store: GameAccessStore;
  readonly memory: MemoryGameAccessStore | null;
  readonly facts: RecordingFacts<GameAccessFact>;
  readonly defects: DefectLog;
  readonly access: GameAccess;
}

export function gameAccessHarness(options: GameAccessHarnessOptions = {}): GameAccessHarness {
  const accounts = accountsHarness(options.accounts);
  const runtime = options.runtime ?? runtimeHarness();
  const memory = options.store === undefined ? new MemoryGameAccessStore() : null;
  const store = options.store ?? memory ?? new MemoryGameAccessStore();
  const facts = new RecordingFacts<GameAccessFact>();
  const defects = new DefectLog();
  const access = new GameAccess({
    store,
    accounts: accounts.accounts,
    writers: runtime.registry,
    clock: accounts.clock,
    facts,
    reportDefect: defects.report,
    ...(options.limits === undefined ? {} : { limits: options.limits }),
    ...(options.assignmentPolicy === undefined
      ? {}
      : { assignmentPolicy: options.assignmentPolicy }),
  });
  return { accounts, runtime, store, memory, facts, defects, access };
}

export function memoryOf(h: GameAccessHarness): MemoryGameAccessStore {
  if (h.memory === null) throw new Error("the harness runs over another store");
  return h.memory;
}

export function playerOf(signedIn: SignedIn): PlayerId {
  const { userId } = signedIn.account;
  if (!isPlayerId(userId)) throw new Error("a user id is not a player id");
  return userId;
}

/** One session of one player, with the authority the edge would receive for it. */
export interface PlayerSession {
  readonly signedIn: SignedIn;
  readonly playerId: PlayerId;
  readonly authority: SessionGameAuthority;
}

export function sessionOf(h: GameAccessHarness, signedIn: SignedIn): PlayerSession {
  const playerId = playerOf(signedIn);
  const session = { sessionId: signedIn.session.sessionId, userId: signedIn.account.userId };
  return { signedIn, playerId, authority: h.access.forSession(session, playerId) };
}

export interface AssignedPlayers {
  readonly white: PlayerSession;
  readonly black: PlayerSession;
  readonly gameId: GameId;
}

/** Registers two accounts and creates their assigned game (white, black). */
export async function assignedGame(
  h: GameAccessHarness,
  names: readonly [string, string] = ["Alice", "Bob"],
  gameId: GameId = GAME_ID,
): Promise<AssignedPlayers> {
  const white = await registered(h.accounts, names[0]);
  const black = await registered(h.accounts, names[1]);
  const created = await h.access.createAssignedGame({
    gameId,
    white: white.account.userId,
    black: black.account.userId,
    timeControl: TIME_CONTROL,
  });
  if (!created.ok) throw new Error(`game not assigned: ${created.error.kind}`);
  return { white: sessionOf(h, white), black: sessionOf(h, black), gameId };
}

export async function heldLease(
  authority: SessionGameAuthority,
  gameId: GameId = GAME_ID,
): Promise<ControlLeaseId | null> {
  const decision: GameAccessDecision = await authority.access(gameId);
  if (decision.kind !== "player") return null;
  return decision.control.held ? decision.control.controlLeaseId : null;
}

export async function grantedLease(
  authority: SessionGameAuthority,
  gameId: GameId = GAME_ID,
): Promise<ControlLeaseId> {
  const decision = await authority.claim(gameId);
  if (decision.kind !== "granted") {
    throw new Error(
      `claim not granted: ${decision.kind === "refused" ? decision.reason : decision.kind}`,
    );
  }
  return decision.controlLeaseId;
}
