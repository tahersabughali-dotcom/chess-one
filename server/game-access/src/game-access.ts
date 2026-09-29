import {
  type AccountDirectory,
  AttemptLimiter,
  type AuthenticatedSession,
  type Outcome,
  type RevocationReason,
  type SessionEndListener,
  type SessionId,
  type WallClock,
} from "@chess-one/accounts";
import type { AccountStatus, UserId } from "@chess-one/identity";
import {
  type ControlDirectory,
  type GameId,
  isPlayerId,
  type PlayerId,
} from "@chess-one/live-game-runtime";
import {
  type AssignedGame,
  type AssignedGameError,
  type AssignedGameRequest,
  type AssignmentDeps,
  type AssignmentPolicy,
  createAssignedGame,
  DEFAULT_ASSIGNMENT_POLICY,
  type ReconciliationOutcome,
  reconcileAssignment,
} from "./assignments.ts";
import { GameControlService } from "./control.ts";
import type { GameAccessFactSink } from "./facts.ts";
import { type GameAccessStore, GameAccessStoreError } from "./ports.ts";
import { ProductionGameAccessResolver } from "./resolver.ts";
import type { GameAccessProvider, SessionGameAuthority } from "./session-authority.ts";
import type { AccessResolution, ClaimDecision, SeatListing } from "./values.ts";
import { ControlWatchers } from "./watchers.ts";

export interface GameAccessLimits {
  /** Seats listed in `connection_ready`, newest first. */
  readonly maxListedSeats: number;
  /** Control-change watchers across all connections of this process. */
  readonly maxControlWatchers: number;
  /** Claims one session may make at once, then one more every `claimRefillEveryMs`. */
  readonly claimBurst: number;
  readonly claimRefillEveryMs: number;
  /** Sessions tracked by the claim limiter (least recently used evicted first). */
  readonly maxClaimLimiterKeys: number;
}

export const DEFAULT_GAME_ACCESS_LIMITS: GameAccessLimits = Object.freeze({
  maxListedSeats: 64,
  maxControlWatchers: 65_536,
  claimBurst: 5,
  claimRefillEveryMs: 2_000,
  maxClaimLimiterKeys: 50_000,
});

export interface GameAccessConfig {
  readonly store: GameAccessStore;
  readonly accounts: AccountDirectory;
  readonly writers: ControlDirectory;
  readonly clock: WallClock;
  readonly facts: GameAccessFactSink;
  readonly reportDefect: (error: unknown) => void;
  readonly limits?: Partial<GameAccessLimits>;
  readonly assignmentPolicy?: Partial<AssignmentPolicy>;
}

const RATE_LIMITED: ClaimDecision = Object.freeze({ kind: "refused", reason: "rate_limited" });
const NO_WATCH = (): void => undefined;

function positiveInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Game access limit ${name} must be a positive integer`);
  }
  return value;
}

function limitsOf(overrides: Partial<GameAccessLimits> | undefined): GameAccessLimits {
  const merged = { ...DEFAULT_GAME_ACCESS_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(merged)) positiveInteger(name, value);
  return Object.freeze(merged);
}

/**
 * The composition root of game access: the production resolver, seat
 * control, trusted game creation, and the accounts hook that drops control
 * when sessions or accounts end. Accounts learns nothing about games; it
 * only calls the listener this registers.
 */
export class GameAccess implements GameAccessProvider {
  readonly trust = "production";
  readonly #store: GameAccessStore;
  readonly #clock: WallClock;
  readonly #facts: GameAccessFactSink;
  readonly #reportDefect: (error: unknown) => void;
  readonly #limits: GameAccessLimits;
  readonly #resolver: ProductionGameAccessResolver;
  readonly #watchers: ControlWatchers;
  readonly #control: GameControlService;
  readonly #claims: AttemptLimiter;
  readonly #assignments: AssignmentDeps;
  readonly #unlisten: () => void;

  constructor(config: GameAccessConfig) {
    this.#store = config.store;
    this.#clock = config.clock;
    this.#facts = config.facts;
    this.#reportDefect = config.reportDefect;
    this.#limits = limitsOf(config.limits);
    this.#resolver = new ProductionGameAccessResolver(config.store, (error) =>
      this.#storeFailed("resolve", error),
    );
    this.#watchers = new ControlWatchers(this.#limits.maxControlWatchers, config.reportDefect);
    this.#control = new GameControlService({
      store: config.store,
      resolver: this.#resolver,
      accounts: config.accounts,
      writers: config.writers,
      watchers: this.#watchers,
      facts: config.facts,
      reportDefect: config.reportDefect,
    });
    this.#claims = new AttemptLimiter(
      { burst: this.#limits.claimBurst, refillEveryMs: this.#limits.claimRefillEveryMs },
      this.#limits.maxClaimLimiterKeys,
    );
    this.#assignments = {
      store: config.store,
      accounts: config.accounts,
      writers: config.writers,
      facts: config.facts,
      reportDefect: config.reportDefect,
      policy: Object.freeze({ ...DEFAULT_ASSIGNMENT_POLICY, ...config.assignmentPolicy }),
    };
    const listener: SessionEndListener = {
      sessionsEnded: (
        _userId: UserId,
        sessionIds: readonly SessionId[],
        reason: RevocationReason,
      ) => {
        const revocation = reason === "account_disabled" ? "account_closed" : "session_revoked";
        for (const sessionId of sessionIds) {
          this.#control.inBackground(() => this.#control.releaseSession(sessionId, revocation));
        }
      },
      accountClosed: (userId: UserId, _status: AccountStatus) => {
        if (isPlayerId(userId)) this.revokeControlsForUser(userId);
      },
    };
    this.#unlisten = config.accounts.onSessionsEnded(listener);
  }

  get controlWatchers(): number {
    return this.#watchers.size;
  }

  get pendingRevocations(): number {
    return this.#control.pendingRevocations;
  }

  /** The trusted internal creation of an assigned game (no public endpoint). */
  createAssignedGame(
    request: AssignedGameRequest,
  ): Promise<Outcome<AssignedGame, AssignedGameError>> {
    return createAssignedGame(this.#assignments, request);
  }

  reconcileAssignment(gameId: GameId): Promise<ReconciliationOutcome> {
    return reconcileAssignment(this.#assignments, gameId);
  }

  resolve(playerId: PlayerId, gameId: GameId): Promise<AccessResolution> {
    return this.#resolver.resolve(playerId, gameId);
  }

  async seatsOf(playerId: PlayerId): Promise<readonly SeatListing[]> {
    try {
      return await this.#store.seatsOf(playerId, this.#limits.maxListedSeats);
    } catch (error: unknown) {
      this.#storeFailed("list", error);
      return [];
    }
  }

  forSession(session: AuthenticatedSession, playerId: PlayerId): SessionGameAuthority {
    const control = this.#control;
    const authority: SessionGameAuthority = {
      access: (gameId) => control.access(session, playerId, gameId),
      claim: (gameId) => {
        if (!this.#claims.take(session.sessionId, this.#clock.now()).allowed) {
          this.#facts.record({ name: "game_control_denied", gameId, reason: "rate_limited" });
          return Promise.resolve(RATE_LIMITED);
        }
        return control.claim(session, playerId, gameId);
      },
      replayAccess: (gameId) => control.replayAccess(session, playerId, gameId),
      watchControl: (gameId, seat, onChange) =>
        this.#watchers.watch(gameId, seat, session.sessionId, onChange) ?? NO_WATCH,
      sessionEnded: () => {
        control.inBackground(() => control.releaseSession(session.sessionId, "session_ended"));
      },
    };
    return Object.freeze(authority);
  }

  /** Logout, logout-all, and revocation of one session: its seats lose their controller. */
  revokeControlsForSession(sessionId: SessionId): void {
    this.#control.inBackground(() => this.#control.releaseSession(sessionId, "session_revoked"));
  }

  /** Disabled or locked account: every seat of the user loses its controller. No resignation. */
  revokeControlsForUser(playerId: PlayerId): void {
    this.#control.inBackground(() => this.#control.releaseUser(playerId, "account_closed"));
  }

  /** Resolves once every revocation started so far has settled. */
  settled(): Promise<void> {
    return this.#control.settled();
  }

  dispose(): void {
    this.#unlisten();
  }

  /** Store failures fail closed and are reported; any other error is a defect and is rethrown. */
  #storeFailed(operation: "resolve" | "list", error: unknown): void {
    if (!(error instanceof GameAccessStoreError)) throw error;
    const cause = error.kind === "corrupt" ? "store_corrupt" : "store_unavailable";
    this.#facts.record({ name: "game_access_unavailable", operation, cause });
    this.#reportDefect(error);
  }
}
