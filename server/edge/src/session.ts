import type { SeatListing, SessionGameAuthority } from "@chess-one/game-access";
import { type GameId, isGameId, isPlayerId, type PlayerId } from "@chess-one/live-game-runtime";

/** Raw credential headers of the upgrade request. Never logged, never echoed. */
export interface SessionCredentials {
  readonly authorization: string | null;
  readonly cookie: string | null;
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

/**
 * The only source of actor identity, seats, and control for a connection.
 * `games` is what `connection_ready` lists and grants nothing; every seat,
 * control, and claim decision is asked of `authority`, and the transport
 * never picks a seat or a lease itself.
 */
export interface TrustedSessionContext {
  readonly actorId: PlayerId;
  readonly games: readonly SeatListing[];
  readonly authority: SessionGameAuthority;
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
 * Checks a resolver's answer before the transport relies on it: a valid
 * actor, and a bounded listing with valid ids and one seat per game. A
 * resolver that breaks this is a server defect, not a client error.
 */
export function validSession(
  session: TrustedSessionContext,
  maxListed: number,
): readonly SeatListing[] | null {
  if (!isPlayerId(session.actorId) || session.games.length > maxListed) return null;
  const seen = new Set<GameId>();
  const games: SeatListing[] = [];
  for (const { gameId, seat } of session.games) {
    if (!isGameId(gameId) || seen.has(gameId)) return null;
    if (seat !== "white" && seat !== "black") return null;
    seen.add(gameId);
    games.push(Object.freeze({ gameId, seat }));
  }
  return games;
}
