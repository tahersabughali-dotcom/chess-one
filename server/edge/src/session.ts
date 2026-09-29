import {
  type ControlLeaseId,
  type GameId,
  isControlLeaseId,
  isGameId,
  isPlayerId,
  type PlayerId,
  type Seat,
} from "@chess-one/live-game-runtime";

/** Raw credential headers of the upgrade request. Never logged, never echoed. */
export interface SessionCredentials {
  readonly authorization: string | null;
  readonly cookie: string | null;
}

/**
 * One game this session may act in: the seat and the control lease the
 * trusted issuer bound to it. The transport never grants or replaces a lease;
 * the live-game core still checks it against the game's current lease.
 */
export interface GameSeatGrant {
  readonly gameId: GameId;
  readonly seat: Seat;
  readonly controlLeaseId: ControlLeaseId;
}

/**
 * How an open connection learns that its session ended. `watch` is told at
 * once when this process revokes the session; `check` is the periodic
 * recheck that also catches revocations made elsewhere. Neither runs per
 * message, so command receipt never waits on the session store.
 */
export interface SessionLiveness {
  check(): Promise<boolean>;
  /** Calls `onEnd` at most once; returns the unsubscribe. */
  watch(onEnd: () => void): () => void;
}

/** The only source of actor identity and seats for a connection. */
export interface TrustedSessionContext {
  readonly actorId: PlayerId;
  readonly grants: readonly GameSeatGrant[];
  /** Absent for sessions that cannot end while connected (test resolvers). */
  readonly liveness?: SessionLiveness;
}

/**
 * Resolves credentials into a trusted session, or null when they prove
 * nothing. `trust` states what the resolver is for: a production endpoint
 * refuses to start with a `test_only` resolver.
 */
export interface TrustedSessionResolver {
  readonly trust: "production" | "test_only";
  resolve(credentials: SessionCredentials): Promise<TrustedSessionContext | null>;
}

/**
 * Checks a resolver's answer before the transport relies on it: valid ids,
 * a bounded grant list, and one grant per game. A resolver that breaks this
 * is a server defect, not a client error.
 */
export function validSession(
  session: TrustedSessionContext,
  maxGrants: number,
): ReadonlyMap<GameId, GameSeatGrant> | null {
  if (!isPlayerId(session.actorId) || session.grants.length > maxGrants) return null;
  const grants = new Map<GameId, GameSeatGrant>();
  for (const grant of session.grants) {
    if (!isGameId(grant.gameId) || !isControlLeaseId(grant.controlLeaseId)) return null;
    if (grant.seat !== "white" && grant.seat !== "black") return null;
    if (grants.has(grant.gameId)) return null;
    grants.set(grant.gameId, Object.freeze({ ...grant }));
  }
  return grants;
}
