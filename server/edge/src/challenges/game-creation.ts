import type {
  ChallengeGameCheck,
  ChallengeGameCreation,
  ChallengeGameCreator,
  ChallengeGameLifecycle,
  ChallengeGameSpec,
} from "@chess-one/challenges";
import type { AssignedGameRequest, GameAccess } from "@chess-one/game-access";
import { isGameId, isRulesetId, isWallClockMs, suddenDeath } from "@chess-one/live-game-runtime";

/**
 * The server-trusted values of an accepted challenge as an assigned game
 * request, or null when any is outside what the live game accepts. Nothing
 * here comes from a browser: the spec is the stored reservation.
 */
function requestOf(spec: ChallengeGameSpec): AssignedGameRequest | null {
  const { gameId, rulesetId, timeControl, startDeadlineAt } = spec;
  if (!isGameId(gameId) || !isRulesetId(rulesetId) || !isWallClockMs(startDeadlineAt)) return null;
  if (timeControl.type !== "sudden_death" || timeControl.incrementMs !== 0) return null;
  const control = suddenDeath(timeControl.initialMs);
  if (control === null) return null;
  return Object.freeze({
    gameId,
    white: spec.white,
    black: spec.black,
    timeControl: control,
    rulesetId,
    startDeadlineAtWallMs: startDeadlineAt,
  });
}

const UNCONFIRMED: ChallengeGameCreation = Object.freeze({ kind: "unconfirmed" });
const PLAYER_UNAVAILABLE: ChallengeGameCreation = Object.freeze({
  kind: "refused",
  reason: "player_unavailable",
});

/**
 * The challenge application's game creator, over game access's trusted
 * assigned-game creation: the game is created awaiting its players, with no
 * controller on either seat, and no clock running. Composition only; the
 * challenge application never sees game access.
 */
export function challengeGameCreator(access: GameAccess): ChallengeGameCreator {
  return Object.freeze({
    async create(spec: ChallengeGameSpec): Promise<ChallengeGameCreation> {
      const request = requestOf(spec);
      if (request === null) return UNCONFIRMED;
      const created = await access.createAssignedGame(request);
      if (created.ok) return Object.freeze({ kind: "created" });
      switch (created.error.kind) {
        case "same_user":
        case "user_not_found":
        case "user_not_active":
        case "email_not_verified":
          return PLAYER_UNAVAILABLE;
        case "game_already_assigned":
        case "start_refused":
        case "creation_unconfirmed":
        case "unavailable":
          return UNCONFIRMED;
      }
    },
    async check(spec: ChallengeGameSpec): Promise<ChallengeGameCheck> {
      const request = requestOf(spec);
      if (request === null) return "mismatch";
      return access.checkAssignedGame(request);
    },
    async lifecycle(gameId: string): Promise<ChallengeGameLifecycle> {
      if (!isGameId(gameId)) return "unknown";
      const lifecycle = await access.gameLifecycle(gameId);
      return lifecycle === "paused" || lifecycle === "unavailable" ? "unknown" : lifecycle;
    },
  });
}
