import type { UserId } from "@chess-one/identity";
import type { SessionId } from "./tokens.ts";

interface Watcher {
  readonly sessionId: SessionId;
  readonly userId: UserId;
  readonly onEnd: () => void;
}

/**
 * In-process notice that sessions ended, so holders of long-lived
 * connections (the realtime edge) drop them at once instead of at their next
 * recheck. It holds one entry per live watcher and nothing else, so its size
 * is the number of open connections. Other processes learn of a revocation
 * only through their periodic recheck (AUTH-REVOCATION-BROADCAST-001).
 */
export class SessionRevocations {
  readonly #bySession = new Map<SessionId, Set<Watcher>>();
  readonly #byUser = new Map<UserId, Set<Watcher>>();

  get size(): number {
    let count = 0;
    for (const watchers of this.#bySession.values()) count += watchers.size;
    return count;
  }

  /** Calls `onEnd` at most once, when the session or all of the user's sessions end. */
  watch(sessionId: SessionId, userId: UserId, onEnd: () => void): () => void {
    const watcher: Watcher = { sessionId, userId, onEnd };
    add(this.#bySession, sessionId, watcher);
    add(this.#byUser, userId, watcher);
    return () => this.#remove(watcher);
  }

  sessionsEnded(sessionIds: readonly SessionId[]): void {
    for (const sessionId of sessionIds) {
      for (const watcher of [...(this.#bySession.get(sessionId) ?? [])]) this.#end(watcher);
    }
  }

  userEnded(userId: UserId): void {
    for (const watcher of [...(this.#byUser.get(userId) ?? [])]) this.#end(watcher);
  }

  #end(watcher: Watcher): void {
    this.#remove(watcher);
    watcher.onEnd();
  }

  #remove(watcher: Watcher): void {
    remove(this.#bySession, watcher.sessionId, watcher);
    remove(this.#byUser, watcher.userId, watcher);
  }
}

function add<K>(index: Map<K, Set<Watcher>>, key: K, watcher: Watcher): void {
  const set = index.get(key) ?? new Set<Watcher>();
  set.add(watcher);
  index.set(key, set);
}

function remove<K>(index: Map<K, Set<Watcher>>, key: K, watcher: Watcher): void {
  const set = index.get(key);
  if (set === undefined) return;
  set.delete(watcher);
  if (set.size === 0) index.delete(key);
}
