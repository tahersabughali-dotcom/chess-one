import type { SessionId } from "@chess-one/accounts";
import {
  type Assignment,
  type ControlChange,
  type GameAccessStore,
  GameAccessStoreError,
  type NewAssignment,
  type SeatControlRecord,
  type SeatListing,
} from "@chess-one/game-access";
import type { GameId, PlayerId, Seat } from "@chess-one/live-game-runtime";

export type StoreOperation =
  | "reserveAssignment"
  | "confirmAssignment"
  | "discardPendingAssignment"
  | "findAssignment"
  | "seatsOf"
  | "findControl"
  | "transferControl"
  | "controlsHeldBySession"
  | "controlsHeldForUser";

interface StoredAssignment {
  readonly assignment: Assignment;
  readonly order: number;
}

const SEATS: readonly Seat[] = ["white", "black"];

function controlKey(gameId: GameId, seat: Seat): string {
  return `${seat}\u0000${gameId}`;
}

/**
 * TEST DOUBLE of the game-access tables with the PostgreSQL semantics the
 * service relies on: one reservation per game id, compare-and-set on the
 * control version, and confirmed assignments never deleted. Faults are
 * injected per operation; `beforeTransfer` runs inside a transfer before
 * its compare, so another writer can really move the version under it.
 */
export class MemoryGameAccessStore implements GameAccessStore {
  readonly #assignments = new Map<GameId, StoredAssignment>();
  readonly #controls = new Map<string, SeatControlRecord>();
  readonly #faults = new Map<StoreOperation, "unavailable" | "corrupt" | "defect">();
  #order = 0;
  calls = 0;
  beforeTransfer: (() => Promise<void>) | null = null;

  /** The next call of `operation` throws. */
  failNext(operation: StoreOperation, kind: "unavailable" | "corrupt" | "defect"): void {
    this.#faults.set(operation, kind);
  }

  /** Writes a control record as is, bypassing every check (corruption tests). */
  overwriteControl(record: SeatControlRecord): void {
    this.#controls.set(controlKey(record.gameId, record.seat), Object.freeze({ ...record }));
  }

  removeControl(gameId: GameId, seat: Seat): void {
    this.#controls.delete(controlKey(gameId, seat));
  }

  control(gameId: GameId, seat: Seat): SeatControlRecord | undefined {
    return this.#controls.get(controlKey(gameId, seat));
  }

  async reserveAssignment(assignment: NewAssignment): Promise<"reserved" | "already_assigned"> {
    this.#enter("reserveAssignment");
    if (this.#assignments.has(assignment.gameId)) return "already_assigned";
    if (assignment.players.white === assignment.players.black) {
      throw new GameAccessStoreError("unavailable", "23514");
    }
    this.#order += 1;
    this.#assignments.set(assignment.gameId, {
      assignment: Object.freeze({
        gameId: assignment.gameId,
        players: Object.freeze({ ...assignment.players }),
        state: "pending",
      }),
      order: this.#order,
    });
    for (const seat of SEATS) {
      this.#controls.set(
        controlKey(assignment.gameId, seat),
        Object.freeze({
          gameId: assignment.gameId,
          seat,
          controllingSessionId: null,
          controlLeaseId: assignment.leases[seat],
          version: 0,
        }),
      );
    }
    return "reserved";
  }

  async confirmAssignment(gameId: GameId): Promise<boolean> {
    this.#enter("confirmAssignment");
    const stored = this.#assignments.get(gameId);
    if (stored === undefined || stored.assignment.state !== "pending") return false;
    this.#assignments.set(gameId, {
      assignment: Object.freeze({ ...stored.assignment, state: "confirmed" }),
      order: stored.order,
    });
    return true;
  }

  async discardPendingAssignment(gameId: GameId): Promise<boolean> {
    this.#enter("discardPendingAssignment");
    const stored = this.#assignments.get(gameId);
    if (stored === undefined || stored.assignment.state !== "pending") return false;
    this.#assignments.delete(gameId);
    for (const seat of SEATS) this.#controls.delete(controlKey(gameId, seat));
    return true;
  }

  async findAssignment(gameId: GameId): Promise<Assignment | null> {
    this.#enter("findAssignment");
    return this.#assignments.get(gameId)?.assignment ?? null;
  }

  async seatsOf(playerId: PlayerId, limit: number): Promise<readonly SeatListing[]> {
    this.#enter("seatsOf");
    const listed: { readonly listing: SeatListing; readonly order: number }[] = [];
    for (const { assignment, order } of this.#assignments.values()) {
      for (const seat of SEATS) {
        if (assignment.players[seat] === playerId) {
          listed.push({ listing: { gameId: assignment.gameId, seat }, order });
        }
      }
    }
    return listed
      .sort((a, b) => b.order - a.order)
      .slice(0, limit)
      .map((entry) => entry.listing);
  }

  async findControl(gameId: GameId, seat: Seat): Promise<SeatControlRecord | null> {
    this.#enter("findControl");
    return this.#controls.get(controlKey(gameId, seat)) ?? null;
  }

  async transferControl(change: ControlChange): Promise<SeatControlRecord | null> {
    this.#enter("transferControl");
    const interleave = this.beforeTransfer;
    this.beforeTransfer = null;
    if (interleave !== null) await interleave();
    const key = controlKey(change.gameId, change.seat);
    const current = this.#controls.get(key);
    if (current === undefined || current.version !== change.expectedVersion) return null;
    const next: SeatControlRecord = Object.freeze({
      gameId: change.gameId,
      seat: change.seat,
      controllingSessionId: change.sessionId,
      controlLeaseId: change.controlLeaseId,
      version: current.version + 1,
    });
    this.#controls.set(key, next);
    return next;
  }

  async controlsHeldBySession(sessionId: SessionId): Promise<readonly SeatControlRecord[]> {
    this.#enter("controlsHeldBySession");
    return [...this.#controls.values()].filter(
      (record) => record.controllingSessionId === sessionId,
    );
  }

  async controlsHeldForUser(playerId: PlayerId): Promise<readonly SeatControlRecord[]> {
    this.#enter("controlsHeldForUser");
    return [...this.#controls.values()].filter((record) => {
      const assignment = this.#assignments.get(record.gameId)?.assignment;
      return record.controllingSessionId !== null && assignment?.players[record.seat] === playerId;
    });
  }

  #enter(operation: StoreOperation): void {
    this.calls += 1;
    const fault = this.#faults.get(operation);
    if (fault === undefined) return;
    this.#faults.delete(operation);
    if (fault === "defect") throw new Error(`injected ${operation} defect`);
    throw new GameAccessStoreError(fault, fault === "corrupt" ? "injected" : "08006");
  }
}
