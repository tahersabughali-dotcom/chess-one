import type { SessionAuthority } from "@chess-one/accounts";
import { isPlayerId, type PlayerId } from "@chess-one/live-game-runtime";
import type {
  GameSeatGrant,
  SessionCredentials,
  TrustedSessionContext,
  TrustedSessionResolver,
} from "../session.ts";
import { readSessionCookie, type SessionCookiePolicy } from "./cookie.ts";

/**
 * Which games, seats, and control leases a signed-in player holds. Seats come
 * from game assignment, never from the session or the client. Batch 10 has
 * no matchmaking, so the production resolver is `NO_GAME_ACCESS`; tests
 * supply a `test_only` one.
 */
export interface GameAccessResolver {
  readonly trust: "production" | "test_only";
  grantsFor(playerId: PlayerId): Promise<readonly GameSeatGrant[]>;
}

/** Grants nothing: an authenticated player with no assigned game. */
export const NO_GAME_ACCESS: GameAccessResolver = Object.freeze({
  trust: "production",
  grantsFor: async (): Promise<readonly GameSeatGrant[]> => [],
});

export interface ProductionSessionResolverOptions {
  readonly sessions: SessionAuthority;
  readonly gameAccess: GameAccessResolver;
  readonly cookie: SessionCookiePolicy;
  readonly maxCookieLength: number;
}

/**
 * Cookie, then token digest, then stored session, then account status, then
 * identity: the actor is the account's user id, and nothing the client sends
 * (a header, a query, a message field) can name another. The Authorization
 * header is not a credential here. A missing, malformed, duplicated,
 * unknown, expired, idle, or revoked session, or a disabled or locked
 * account, resolves to null (401 at the upgrade).
 */
export class ProductionTrustedSessionResolver implements TrustedSessionResolver {
  readonly trust: "production" | "test_only";
  readonly #options: ProductionSessionResolverOptions;

  constructor(options: ProductionSessionResolverOptions) {
    this.#options = options;
    this.trust =
      options.gameAccess.trust === "production" && options.cookie.mode === "secure"
        ? "production"
        : "test_only";
  }

  async resolve(credentials: SessionCredentials): Promise<TrustedSessionContext | null> {
    const { sessions, gameAccess, cookie, maxCookieLength } = this.#options;
    const read = readSessionCookie(credentials.cookie, cookie, maxCookieLength);
    if (read.kind !== "token") return null;
    const session = await sessions.authenticate(read.token);
    if (session === null) return null;
    const actorId = session.userId;
    if (!isPlayerId(actorId)) return null;
    const grants = await gameAccess.grantsFor(actorId);
    return {
      actorId,
      grants,
      liveness: {
        check: () => sessions.isSessionActive(session),
        watch: (onEnd) => sessions.watchSession(session, onEnd),
      },
    };
  }
}
