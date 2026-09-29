import type { AccountStatus, UserId } from "@chess-one/identity";
import type { SessionEndListener } from "./extensions.ts";
import type { RevocationReason } from "./ports.ts";
import type { SessionId } from "./tokens.ts";

interface Watcher {
  readonly sessionId: SessionId;
  readonly userId: UserId;
  readonly onEnd: () => void;
}

/** Listeners are composition-time wiring (one per layer above accounts), never per request. */
const MAX_LISTENERS = 8;

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
  readonly #listeners = new Set<SessionEndListener>();
  readonly #reportDefect: (error: unknown) => void;

  constructor(reportDefect: (error: unknown) => void) {
    this.#reportDefect = reportDefect;
  }

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

  listen(listener: SessionEndListener): () => void {
    if (this.#listeners.size >= MAX_LISTENERS && !this.#listeners.has(listener)) {
      throw new Error("Too many session end listeners");
    }
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  sessionsEnded(userId: UserId, sessionIds: readonly SessionId[], reason: RevocationReason): void {
    for (const sessionId of sessionIds) {
      for (const watcher of [...(this.#bySession.get(sessionId) ?? [])]) this.#end(watcher);
    }
    this.#tell((listener) => listener.sessionsEnded(userId, sessionIds, reason));
  }

  userEnded(userId: UserId, status: AccountStatus): void {
    for (const watcher of [...(this.#byUser.get(userId) ?? [])]) this.#end(watcher);
    this.#tell((listener) => listener.accountClosed(userId, status));
  }

  #tell(call: (listener: SessionEndListener) => void): void {
    for (const listener of [...this.#listeners]) {
      try {
        call(listener);
      } catch (error: unknown) {
        this.#reportDefect(error);
      }
    }
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
