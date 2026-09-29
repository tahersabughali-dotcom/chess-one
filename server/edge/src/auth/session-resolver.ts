import type { SessionAuthority } from "@chess-one/accounts";
import type { GameAccessProvider } from "@chess-one/game-access";
import { isPlayerId } from "@chess-one/live-game-runtime";
import type {
  SessionCredentials,
  TrustedSessionContext,
  TrustedSessionResolver,
} from "../session.ts";
import { readSessionCookie, type SessionCookiePolicy } from "./cookie.ts";

export interface ProductionSessionResolverOptions {
  readonly sessions: SessionAuthority;
  /** Seats and control come from game access, never from the session or the client. */
  readonly gameAccess: GameAccessProvider;
  readonly cookie: SessionCookiePolicy;
  readonly maxCookieLength: number;
}

/**
 * Cookie, then token digest, then stored session, then account status, then
 * identity: the actor is the account's user id, and nothing the client sends
 * (a header, a query, a message field) can name another. The Authorization
 * header is not a credential here. A missing, malformed, duplicated,
 * unknown, expired, idle, or revoked session, or a disabled or locked
 * account, resolves to null (401 at the upgrade). The session's game
 * authority answers every seat and control question afterwards.
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
    return {
      actorId,
      games: await gameAccess.seatsOf(actorId),
      authority: gameAccess.forSession(session, actorId),
      liveness: {
        check: () => sessions.isSessionActive(session),
        watch: (onEnd) => sessions.watchSession(session, onEnd),
      },
    };
  }
}
