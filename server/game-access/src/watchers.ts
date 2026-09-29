import type { SessionId } from "@chess-one/accounts";
import type { ControlLeaseId, GameId, Seat } from "@chess-one/live-game-runtime";
import type { ControlNotice } from "./values.ts";

interface Watcher {
  readonly key: string;
  readonly sessionId: SessionId;
  readonly onChange: (notice: ControlNotice) => void;
}

const TAKEN: ControlNotice = Object.freeze({ kind: "taken" });
const RELEASED: ControlNotice = Object.freeze({ kind: "released" });

function keyOf(gameId: GameId, seat: Seat): string {
  return `${seat}\u0000${gameId}`;
}

/**
 * In-process notice of control changes, one entry per watching connection
 * and seat, so a connection that lost control stops sending commands at once.
 * It is a courtesy, never the authority: a lost notice changes nothing,
 * because the writer refuses the old lease anyway. At most `capacity`
 * watchers; beyond it `watch` declines and the connection learns of a
 * change at its next request.
 */
export class ControlWatchers {
  readonly #bySeat = new Map<string, Set<Watcher>>();
  readonly #capacity: number;
  readonly #reportDefect: (error: unknown) => void;
  #size = 0;

  constructor(capacity: number, reportDefect: (error: unknown) => void) {
    this.#capacity = capacity;
    this.#reportDefect = reportDefect;
  }

  get size(): number {
    return this.#size;
  }

  /** Returns the unsubscribe, or null when the registry is full. */
  watch(
    gameId: GameId,
    seat: Seat,
    sessionId: SessionId,
    onChange: (notice: ControlNotice) => void,
  ): (() => void) | null {
    if (this.#size >= this.#capacity) return null;
    const watcher: Watcher = { key: keyOf(gameId, seat), sessionId, onChange };
    const set = this.#bySeat.get(watcher.key) ?? new Set<Watcher>();
    set.add(watcher);
    this.#bySeat.set(watcher.key, set);
    this.#size += 1;
    return () => this.#remove(watcher);
  }

  /** The seat is now held by `holder` (null: by nobody) under `lease`. */
  changed(gameId: GameId, seat: Seat, holder: SessionId | null, lease: ControlLeaseId): void {
    const held: ControlNotice = Object.freeze({ kind: "held", controlLeaseId: lease });
    const lost = holder === null ? RELEASED : TAKEN;
    for (const watcher of [...(this.#bySeat.get(keyOf(gameId, seat)) ?? [])]) {
      try {
        watcher.onChange(watcher.sessionId === holder ? held : lost);
      } catch (error: unknown) {
        this.#reportDefect(error);
      }
    }
  }

  #remove(watcher: Watcher): void {
    const set = this.#bySeat.get(watcher.key);
    if (set === undefined || !set.delete(watcher)) return;
    this.#size -= 1;
    if (set.size === 0) this.#bySeat.delete(watcher.key);
  }
}
