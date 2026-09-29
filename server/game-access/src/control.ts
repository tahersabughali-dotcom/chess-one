import type { AccountDirectory, AuthenticatedSession, SessionId } from "@chess-one/accounts";
import type { UserId } from "@chess-one/identity";
import type {
  ControlDirectory,
  GameId,
  PlayerId,
  ReadyPresence,
  Seat,
} from "@chess-one/live-game-runtime";
import type { GameAccessFactSink } from "./facts.ts";
import { newControlLease } from "./leases.ts";
import { type GameAccessStore, GameAccessStoreError } from "./ports.ts";
import type { ProductionGameAccessResolver } from "./resolver.ts";
import { KeyedSerializer } from "./serializer.ts";
import type {
  AccessResolution,
  ClaimDecision,
  ClaimRefusal,
  ControlRevocation,
  GameAccessDecision,
  ReadyDecision,
  ReadyRefusal,
  ReplayAccess,
  SeatControl,
  SeatControlRecord,
} from "./values.ts";
import type { ControlWatchers } from "./watchers.ts";
import { type Applied, applyLease, gameOpenness, markReady } from "./writer-lease.ts";

export interface ControlServiceOptions {
  readonly store: GameAccessStore;
  readonly resolver: ProductionGameAccessResolver;
  readonly accounts: AccountDirectory;
  readonly writers: ControlDirectory;
  readonly watchers: ControlWatchers;
  readonly facts: GameAccessFactSink;
  readonly reportDefect: (error: unknown) => void;
}

const DENIED: GameAccessDecision = Object.freeze({ kind: "denied" });
const UNAVAILABLE: GameAccessDecision = Object.freeze({ kind: "unavailable" });
const CLAIM_UNAVAILABLE: ClaimDecision = Object.freeze({ kind: "unavailable" });
const NOT_HELD: SeatControl = Object.freeze({ held: false });
const REPLAY_DENIED: ReplayAccess = Object.freeze({ kind: "denied" });
const REPLAY_SESSION_ENDED: ReplayAccess = Object.freeze({ kind: "session_ended" });
const REPLAY_UNAVAILABLE: ReplayAccess = Object.freeze({ kind: "unavailable" });
const READY_UNAVAILABLE: ReadyDecision = Object.freeze({ kind: "unavailable" });

function seatOfResolution(resolution: AccessResolution): Seat | null {
  if (resolution === "player_white") return "white";
  if (resolution === "player_black") return "black";
  return null;
}

/**
 * Game access and seat control, composed from the assignment (who plays
 * which seat), the control record (which session drives the seat, under
 * which lease), and the writer (which lease the live game admits). Every
 * answer is read from the store; nothing here is cached.
 *
 * A control change is two writes: the control record, then the writer's
 * lease. Changes of one game run one at a time in this process, so the
 * writer receives leases in the order the store recorded them. The record
 * is written first; if the writer step fails (or the process stops between
 * them), the old controller has already lost control at the edge and the
 * new one holds a lease the writer does not admit yet, so nobody plays until
 * the holder's next access or claim applies the stored lease again. That is
 * the reconciliation, and it fails closed.
 */
export class GameControlService {
  readonly #store: GameAccessStore;
  readonly #resolver: ProductionGameAccessResolver;
  readonly #accounts: AccountDirectory;
  readonly #writers: ControlDirectory;
  readonly #watchers: ControlWatchers;
  readonly #facts: GameAccessFactSink;
  readonly #reportDefect: (error: unknown) => void;
  readonly #serial = new KeyedSerializer<GameId>();
  readonly #background = new Set<Promise<void>>();

  constructor(options: ControlServiceOptions) {
    this.#store = options.store;
    this.#resolver = options.resolver;
    this.#accounts = options.accounts;
    this.#writers = options.writers;
    this.#watchers = options.watchers;
    this.#facts = options.facts;
    this.#reportDefect = options.reportDefect;
  }

  /** Background revocations still running (bounded by revoked sessions in flight). */
  get pendingRevocations(): number {
    return this.#background.size;
  }

  /**
   * What `session` may do in `gameId`. Control is held only when the control
   * record names this very session; a reconnect of that session keeps it
   * with the same lease, and any other session of the same user sees the
   * seat but not control. Access never takes control.
   */
  async access(
    session: AuthenticatedSession,
    playerId: PlayerId,
    gameId: GameId,
  ): Promise<GameAccessDecision> {
    const resolution = await this.#resolver.resolve(playerId, gameId);
    const seat = seatOfResolution(resolution);
    if (seat === null) return this.#denied(gameId, resolution);
    try {
      return await this.#serial.run(gameId, async (): Promise<GameAccessDecision> => {
        const control = await this.#control(gameId, seat);
        if (control.controllingSessionId !== session.sessionId) {
          return { kind: "player", seat, control: NOT_HELD };
        }
        await applyLease(this.#writers, gameId, seat, control.controlLeaseId);
        return {
          kind: "player",
          seat,
          control: { held: true, controlLeaseId: control.controlLeaseId },
        };
      });
    } catch (error: unknown) {
      this.#storeFailed("resolve", error);
      return UNAVAILABLE;
    }
  }

  /**
   * Historical replay needs a participant, not a controller: the seat comes
   * from the assignment, and the session is rechecked in the store, since a
   * replay is rare and must not outlive a revocation made elsewhere. The
   * control record is not read: any active session of the player may ask.
   */
  async replayAccess(
    session: AuthenticatedSession,
    playerId: PlayerId,
    gameId: GameId,
  ): Promise<ReplayAccess> {
    const resolution = await this.#resolver.resolve(playerId, gameId);
    const seat = seatOfResolution(resolution);
    if (seat === null) {
      return this.#denied(gameId, resolution).kind === "unavailable"
        ? REPLAY_UNAVAILABLE
        : REPLAY_DENIED;
    }
    const active = await this.#sessionActive(session);
    if (active === "unavailable") return REPLAY_UNAVAILABLE;
    return active ? { kind: "player", seat } : REPLAY_SESSION_ENDED;
  }

  /**
   * Explicit takeover of the seat by `session`: a new lease, the session as
   * holder, and the previous holder's lease refused by the writer from the
   * moment the rotation is queued. The holder claiming again keeps its lease.
   */
  async claim(
    session: AuthenticatedSession,
    playerId: PlayerId,
    gameId: GameId,
  ): Promise<ClaimDecision> {
    const resolution = await this.#resolver.resolve(playerId, gameId);
    if (resolution === "unavailable") return this.#claimUnavailable(gameId);
    const seat = seatOfResolution(resolution);
    if (seat === null) {
      this.#denied(gameId, resolution);
      return this.#refused(gameId, "no_access");
    }
    try {
      return await this.#serial.run(gameId, () => this.#claimSeat(session, gameId, seat));
    } catch (error: unknown) {
      this.#storeFailed("claim", error);
      return this.#claimUnavailable(gameId);
    }
  }

  /**
   * The session's player declares its seat ready. Checked here, at the
   * request: the seat is the player's, the session and the account are
   * active, and this session holds the seat's control, whose stored lease is
   * applied to the writer first. The writer then decides, at its turn, on a
   * fresh load: the game still awaiting, the lease still the seat's, the
   * presence still open, and the deadline not passed. Serialized with the
   * game's control changes, so a takeover lands wholly before or after it.
   */
  async ready(
    session: AuthenticatedSession,
    playerId: PlayerId,
    gameId: GameId,
    presence: ReadyPresence,
  ): Promise<ReadyDecision> {
    const resolution = await this.#resolver.resolve(playerId, gameId);
    if (resolution === "unavailable") return this.#readyUnavailable(gameId);
    const seat = seatOfResolution(resolution);
    if (seat === null) {
      this.#denied(gameId, resolution);
      return this.#readyRefused(gameId, "no_access");
    }
    try {
      return await this.#serial.run(gameId, () => this.#readySeat(session, gameId, seat, presence));
    } catch (error: unknown) {
      this.#storeFailed("resolve", error);
      return this.#readyUnavailable(gameId);
    }
  }

  async #readySeat(
    session: AuthenticatedSession,
    gameId: GameId,
    seat: Seat,
    presence: ReadyPresence,
  ): Promise<ReadyDecision> {
    const active = await this.#sessionActive(session);
    if (active === "unavailable") return this.#readyUnavailable(gameId);
    if (!active) return this.#readyRefused(gameId, "session_ended");
    const standing = await this.#standing(session.userId);
    if (standing === "unavailable") return this.#readyUnavailable(gameId);
    if (standing !== "active") return this.#readyRefused(gameId, "session_ended");
    const control = await this.#control(gameId, seat);
    if (control.controllingSessionId !== session.sessionId) {
      return this.#readyRefused(gameId, "control_not_held");
    }
    const applied = await applyLease(this.#writers, gameId, seat, control.controlLeaseId);
    if (applied === "not_applied") return this.#readyUnavailable(gameId);
    const outcome = await markReady(this.#writers, gameId, seat, control.controlLeaseId, presence);
    switch (outcome.kind) {
      case "ready":
        return { kind: "ready", seat, readiness: outcome.readiness };
      case "started":
        return { kind: "started", seat };
      case "refused":
        return { kind: "refused", reason: outcome.reason };
      case "recovery_required":
      case "unavailable":
        return this.#readyUnavailable(gameId);
    }
  }

  /** Drops every seat `sessionId` controls: logout, revocation, expiry. */
  async releaseSession(sessionId: SessionId, reason: ControlRevocation): Promise<void> {
    const held = await this.#store.controlsHeldBySession(sessionId);
    await Promise.all(
      held.map((record) =>
        this.#serial.run(record.gameId, async () => {
          const current = await this.#control(record.gameId, record.seat);
          if (current.controllingSessionId === sessionId) await this.#release(current, reason);
        }),
      ),
    );
  }

  /** Drops every seat of the user's games that any session controls: account closed. */
  async releaseUser(playerId: PlayerId, reason: ControlRevocation): Promise<void> {
    const held = await this.#store.controlsHeldForUser(playerId);
    await Promise.all(
      held.map((record) =>
        this.#serial.run(record.gameId, async () => {
          const current = await this.#control(record.gameId, record.seat);
          if (current.controllingSessionId !== null) await this.#release(current, reason);
        }),
      ),
    );
  }

  /** Runs a revocation started by a synchronous notice; failures are reported, never dropped. */
  inBackground(work: () => Promise<void>): void {
    const task = work().then(
      () => undefined,
      (error: unknown) => {
        if (error instanceof GameAccessStoreError) this.#storeFailed("revoke", error);
        else this.#reportDefect(error);
      },
    );
    this.#background.add(task);
    task.then(() => this.#background.delete(task));
  }

  /** Resolves once every background revocation started so far has settled. */
  async settled(): Promise<void> {
    while (this.#background.size > 0) await Promise.all([...this.#background]);
  }

  async #claimSeat(
    session: AuthenticatedSession,
    gameId: GameId,
    seat: Seat,
  ): Promise<ClaimDecision> {
    const active = await this.#sessionActive(session);
    if (active === "unavailable") return this.#claimUnavailable(gameId);
    if (!active) return this.#refused(gameId, "session_ended");
    const openness = await gameOpenness(this.#writers, gameId);
    if (openness === "unavailable") return this.#claimUnavailable(gameId);
    if (openness === "closed") return this.#refused(gameId, "game_closed");
    const current = await this.#control(gameId, seat);
    if (current.controllingSessionId === session.sessionId) {
      return this.#granted(gameId, seat, current, false);
    }
    const lease = newControlLease();
    const taken = await this.#store.transferControl({
      gameId,
      seat,
      expectedVersion: current.version,
      sessionId: session.sessionId,
      controlLeaseId: lease,
    });
    if (taken === null) {
      this.#facts.record({ name: "game_control_conflict", gameId, seat });
      return this.#refused(gameId, "conflict");
    }
    // Queued now, so the writer refuses the old lease before anyone is told.
    const applying = applyLease(this.#writers, gameId, seat, lease);
    this.#watchers.changed(gameId, seat, session.sessionId, lease);
    if (current.controllingSessionId !== null) {
      this.#facts.record({
        name: "game_control_revoked",
        gameId,
        seat,
        reason: "claimed_by_other_session",
      });
    }
    const stillActive = await this.#sessionActive(session);
    const applied = await applying;
    if (stillActive !== true) {
      await this.#release(taken, "session_ended");
      return stillActive === "unavailable"
        ? this.#claimUnavailable(gameId)
        : this.#refused(gameId, "session_ended");
    }
    return this.#granted(gameId, seat, taken, true, applied);
  }

  async #granted(
    gameId: GameId,
    seat: Seat,
    control: SeatControlRecord,
    rotated: boolean,
    applied?: Applied,
  ): Promise<ClaimDecision> {
    const outcome =
      applied ?? (await applyLease(this.#writers, gameId, seat, control.controlLeaseId));
    if (outcome === "not_applied") return this.#claimUnavailable(gameId);
    this.#facts.record({ name: "game_control_claimed", gameId, seat, rotated });
    return { kind: "granted", seat, controlLeaseId: control.controlLeaseId };
  }

  /** The seat is left with no controller and a fresh lease nobody holds. */
  async #release(current: SeatControlRecord, reason: ControlRevocation): Promise<void> {
    const { gameId, seat } = current;
    const lease = newControlLease();
    const released = await this.#store.transferControl({
      gameId,
      seat,
      expectedVersion: current.version,
      sessionId: null,
      controlLeaseId: lease,
    });
    if (released === null) {
      this.#facts.record({ name: "game_control_conflict", gameId, seat });
      return;
    }
    const applying = applyLease(this.#writers, gameId, seat, lease);
    this.#watchers.changed(gameId, seat, null, lease);
    this.#facts.record({ name: "game_control_revoked", gameId, seat, reason });
    if ((await applying) === "not_applied") {
      this.#facts.record({ name: "game_access_unavailable", operation: "revoke", cause: "writer" });
    }
  }

  async #control(gameId: GameId, seat: Seat): Promise<SeatControlRecord> {
    const control = await this.#store.findControl(gameId, seat);
    if (control === null) throw new GameAccessStoreError("corrupt", "game_seat_control.missing");
    return control;
  }

  async #sessionActive(session: AuthenticatedSession): Promise<boolean | "unavailable"> {
    try {
      return await this.#accounts.isSessionActive(session);
    } catch (error: unknown) {
      this.#reportDefect(error);
      return "unavailable";
    }
  }

  async #standing(userId: UserId): Promise<"active" | "inactive" | "unavailable"> {
    try {
      const standing = await this.#accounts.accountStanding(userId);
      return standing?.status === "active" ? "active" : "inactive";
    } catch (error: unknown) {
      this.#reportDefect(error);
      return "unavailable";
    }
  }

  #readyRefused(gameId: GameId, reason: ReadyRefusal): ReadyDecision {
    this.#facts.record({ name: "game_ready_denied", gameId, reason });
    return { kind: "refused", reason };
  }

  #readyUnavailable(gameId: GameId): ReadyDecision {
    this.#facts.record({ name: "game_ready_denied", gameId, reason: "unavailable" });
    return READY_UNAVAILABLE;
  }

  #denied(gameId: GameId, resolution: AccessResolution): GameAccessDecision {
    if (resolution === "unavailable") return UNAVAILABLE;
    const reason = resolution === "game_not_found" ? "game_not_found" : "no_access";
    this.#facts.record({ name: "game_access_denied", gameId, reason });
    return DENIED;
  }

  #refused(gameId: GameId, reason: ClaimRefusal): ClaimDecision {
    this.#facts.record({ name: "game_control_denied", gameId, reason });
    return { kind: "refused", reason };
  }

  #claimUnavailable(gameId: GameId): ClaimDecision {
    this.#facts.record({ name: "game_control_denied", gameId, reason: "unavailable" });
    return CLAIM_UNAVAILABLE;
  }

  /** Store failures fail closed and are reported; any other error is a defect and is rethrown. */
  #storeFailed(operation: "resolve" | "claim" | "revoke", error: unknown): void {
    if (!(error instanceof GameAccessStoreError)) throw error;
    const cause = error.kind === "corrupt" ? "store_corrupt" : "store_unavailable";
    this.#facts.record({ name: "game_access_unavailable", operation, cause });
    this.#reportDefect(error);
  }
}
