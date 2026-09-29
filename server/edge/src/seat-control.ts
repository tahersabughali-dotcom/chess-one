import type {
  ClaimDecision,
  ControlNotice,
  GameAccessDecision,
  ReadyDecision,
  ReplayAccess,
  SeatControl,
  SessionGameAuthority,
} from "@chess-one/game-access";
import type { ControlLeaseId, GameId, ReadyPresence, Seat } from "@chess-one/live-game-runtime";
import type { ControlRevokedCode } from "./protocol/server-messages.ts";

const NOT_HELD: SeatControl = Object.freeze({ held: false });

/**
 * What one connection knows about its session's seat in one game. `control`
 * is a cache of the control record, refreshed by every sync, claim, and
 * notice; the writer checks the lease on every command regardless. The
 * lease never leaves the server.
 */
export interface SeatEntry {
  readonly gameId: GameId;
  readonly seat: Seat;
  control: SeatControl;
  claiming: number;
  readonly unwatch: () => void;
}

function hold(entry: SeatEntry, lease: ControlLeaseId): boolean {
  if (entry.control.held && entry.control.controlLeaseId === lease) return false;
  entry.control = Object.freeze({ held: true, controlLeaseId: lease });
  return true;
}

function drop(entry: SeatEntry): boolean {
  if (!entry.control.held) return false;
  entry.control = NOT_HELD;
  return true;
}

export type SeatLookup =
  | { readonly kind: "seat"; readonly entry: SeatEntry }
  | { readonly kind: "denied" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "limit" };

export type SeatEvent =
  | { readonly kind: "granted"; readonly entry: SeatEntry }
  | { readonly kind: "revoked"; readonly entry: SeatEntry; readonly code: ControlRevokedCode };

export type ClaimLookup =
  | { readonly kind: "granted"; readonly entry: SeatEntry }
  | { readonly kind: "refused"; readonly decision: Exclude<ClaimDecision, { kind: "granted" }> }
  | { readonly kind: "limit" };

const DENIED: SeatLookup = Object.freeze({ kind: "denied" });
const UNAVAILABLE: SeatLookup = Object.freeze({ kind: "unavailable" });
const LIMIT: SeatLookup = Object.freeze({ kind: "limit" });

/**
 * The seats of one connection, at most `maxGames` (entries and lookups in
 * flight together). Lookups of one game share one request, so commands
 * waiting on it run in the order they arrived. A denial is never cached:
 * a game assigned later becomes reachable without reconnecting.
 */
export class ConnectionSeats {
  readonly #authority: SessionGameAuthority;
  readonly #maxGames: number;
  readonly #notify: (event: SeatEvent) => void;
  readonly #entries = new Map<GameId, SeatEntry>();
  readonly #pending = new Map<GameId, Promise<SeatLookup>>();
  #closed = false;

  constructor(
    authority: SessionGameAuthority,
    maxGames: number,
    notify: (event: SeatEvent) => void,
  ) {
    this.#authority = authority;
    this.#maxGames = maxGames;
    this.#notify = notify;
  }

  known(gameId: GameId): SeatEntry | undefined {
    return this.#entries.get(gameId);
  }

  /** A lookup of the seat is already running; callers must wait for it to keep their order. */
  resolving(gameId: GameId): Promise<SeatLookup> | undefined {
    return this.#pending.get(gameId);
  }

  /** Asks game access now (sync, first command), sharing a lookup already in flight. */
  lookup(gameId: GameId): Promise<SeatLookup> {
    const running = this.#pending.get(gameId);
    if (running !== undefined) return running;
    if (!this.#entries.has(gameId) && this.#occupied() >= this.#maxGames) {
      return Promise.resolve(LIMIT);
    }
    const lookup = this.#authority.access(gameId).then(
      (decision) => this.#decided(gameId, decision),
      (error: unknown) => {
        this.#pending.delete(gameId);
        throw error;
      },
    );
    this.#pending.set(gameId, lookup);
    return lookup;
  }

  async claim(gameId: GameId): Promise<ClaimLookup> {
    const existing = this.#entries.get(gameId);
    if (existing === undefined && this.#occupied() >= this.#maxGames) return { kind: "limit" };
    if (existing !== undefined) existing.claiming += 1;
    let decision: ClaimDecision;
    try {
      decision = await this.#authority.claim(gameId);
    } finally {
      if (existing !== undefined) existing.claiming -= 1;
    }
    if (decision.kind !== "granted") return { kind: "refused", decision };
    const entry = this.#entryFor(gameId, decision.seat);
    if (entry === null) return { kind: "limit" };
    hold(entry, decision.controlLeaseId);
    return { kind: "granted", entry };
  }

  /** Asks game access, freshly, whether this session may read its seat's stored decisions. */
  replayAccess(gameId: GameId): Promise<ReplayAccess> {
    return this.#authority.replayAccess(gameId);
  }

  /** Declares this session's seat ready on the connection whose presence this is. */
  ready(gameId: GameId, presence: ReadyPresence): Promise<ReadyDecision> {
    return this.#authority.ready(gameId, presence);
  }

  /** The writer refused `lease`: this session no longer controls the seat. */
  lost(entry: SeatEntry, lease: ControlLeaseId): void {
    if (entry.control.held && entry.control.controlLeaseId === lease) drop(entry);
  }

  close(): void {
    this.#closed = true;
    for (const entry of this.#entries.values()) entry.unwatch();
    this.#entries.clear();
  }

  #occupied(): number {
    let occupied = this.#entries.size;
    for (const gameId of this.#pending.keys()) if (!this.#entries.has(gameId)) occupied += 1;
    return occupied;
  }

  #decided(gameId: GameId, decision: GameAccessDecision): SeatLookup {
    this.#pending.delete(gameId);
    if (decision.kind === "denied") return DENIED;
    if (decision.kind === "unavailable") return UNAVAILABLE;
    const entry = this.#entryFor(gameId, decision.seat);
    if (entry === null) return this.#closed ? UNAVAILABLE : LIMIT;
    if (decision.control.held) hold(entry, decision.control.controlLeaseId);
    else drop(entry);
    return { kind: "seat", entry };
  }

  #entryFor(gameId: GameId, seat: Seat): SeatEntry | null {
    if (this.#closed) return null;
    const existing = this.#entries.get(gameId);
    if (existing !== undefined && existing.seat === seat) return existing;
    if (existing !== undefined) {
      existing.unwatch();
      this.#entries.delete(gameId);
    }
    if (this.#occupied() >= this.#maxGames) return null;
    let entry: SeatEntry | null = null;
    const unwatch = this.#authority.watchControl(gameId, seat, (notice) => {
      if (entry !== null) this.#noticed(entry, notice);
    });
    entry = { gameId, seat, control: NOT_HELD, claiming: 0, unwatch };
    this.#entries.set(gameId, entry);
    return entry;
  }

  #noticed(entry: SeatEntry, notice: ControlNotice): void {
    if (this.#entries.get(entry.gameId) !== entry) return;
    if (notice.kind === "held") {
      if (hold(entry, notice.controlLeaseId) && entry.claiming === 0) {
        this.#notify({ kind: "granted", entry });
      }
      return;
    }
    if (!drop(entry)) return;
    const code = notice.kind === "taken" ? "CONTROL_TRANSFERRED" : "CONTROL_RELEASED";
    this.#notify({ kind: "revoked", entry, code });
  }
}
