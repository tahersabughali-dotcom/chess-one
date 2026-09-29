import type { ControlLeaseId, Seat } from "@chess-one/live-game";
import type { Readiness, ReadyPresence } from "./writer-port.ts";

interface ReadyMark {
  readonly lease: ControlLeaseId;
  readonly presence: ReadyPresence;
}

const NOBODY: Readiness = Object.freeze({ white: false, black: false });

/**
 * The ready marks of one game awaiting its players, in its writer's memory
 * only: at most one per seat, so never more than two. A mark is valid while
 * its lease is still the seat's lease and its presence is open. Nothing
 * here is stored; a restart starts with no mark.
 */
export class ReadyMarks {
  readonly #marks = new Map<Seat, ReadyMark>();

  get size(): number {
    return this.#marks.size;
  }

  /** True when this made a change (a new mark, or another lease or presence). */
  mark(seat: Seat, lease: ControlLeaseId, presence: ReadyPresence): boolean {
    const existing = this.#marks.get(seat);
    if (existing?.lease === lease && existing.presence === presence) return false;
    this.#marks.set(seat, Object.freeze({ lease, presence }));
    return true;
  }

  /** Drops the seat's mark when `stale` says so; true when one was dropped. */
  clearIf(seat: Seat, stale: (lease: ControlLeaseId, presence: ReadyPresence) => boolean): boolean {
    const existing = this.#marks.get(seat);
    if (existing === undefined || !stale(existing.lease, existing.presence)) return false;
    this.#marks.delete(seat);
    return true;
  }

  clear(): void {
    this.#marks.clear();
  }

  /** Each seat's mark judged by `valid`, which sees the mark's lease and presence. */
  readiness(
    valid: (seat: Seat, lease: ControlLeaseId, presence: ReadyPresence) => boolean,
  ): Readiness {
    if (this.#marks.size === 0) return NOBODY;
    const judge = (seat: Seat): boolean => {
      const mark = this.#marks.get(seat);
      return mark !== undefined && valid(seat, mark.lease, mark.presence);
    };
    return Object.freeze({ white: judge("white"), black: judge("black") });
  }
}
