import type { GameReference } from "@chess-one/challenge-domain";
import type {
  ChallengeGameCheck,
  ChallengeGameCreation,
  ChallengeGameCreator,
  ChallengeGameLifecycle,
  ChallengeGameSpec,
} from "@chess-one/challenges";

/**
 * - `refused`: nothing stored, a player can no longer play;
 * - `lost`: nothing stored, reported unconfirmed;
 * - `stored_unconfirmed`: stored, reported unconfirmed (a lost reply);
 * - `throw`: nothing stored, the call throws.
 */
export type CreateFault = "refused" | "lost" | "stored_unconfirmed" | "throw";

/** `unknown`: the check proves nothing; `throw`: the call throws. */
export type CheckFault = "unknown" | "throw";

/**
 * TEST ADAPTER: the trusted game creator in memory. It keeps each created
 * spec under its id and never replaces one, like the real creator; faults
 * are queued per method and each is consumed by one call.
 */
export class FakeGameCreator implements ChallengeGameCreator {
  readonly games = new Map<GameReference, ChallengeGameSpec>();
  readonly lifecycles = new Map<GameReference, ChallengeGameLifecycle>();
  readonly createFaults: CreateFault[] = [];
  readonly checkFaults: CheckFault[] = [];
  creates = 0;
  checks = 0;
  /** Called at the start of each `create`, before anything is stored. */
  beforeCreate: (() => Promise<void>) | null = null;

  async create(spec: ChallengeGameSpec): Promise<ChallengeGameCreation> {
    this.creates += 1;
    await this.beforeCreate?.();
    const fault = this.createFaults.shift();
    if (fault === "throw") throw new Error("game creator unreachable");
    if (fault === "refused") return { kind: "refused", reason: "player_unavailable" };
    if (fault === "lost") return { kind: "unconfirmed" };
    const existing = this.games.get(spec.gameId);
    if (existing !== undefined) {
      return sameSpec(existing, spec) ? { kind: "created" } : { kind: "unconfirmed" };
    }
    this.games.set(spec.gameId, spec);
    return fault === "stored_unconfirmed" ? { kind: "unconfirmed" } : { kind: "created" };
  }

  async check(spec: ChallengeGameSpec): Promise<ChallengeGameCheck> {
    this.checks += 1;
    const fault = this.checkFaults.shift();
    if (fault === "throw") throw new Error("game creator unreachable");
    if (fault === "unknown") return "unknown";
    const existing = this.games.get(spec.gameId);
    if (existing === undefined) return "absent";
    return sameSpec(existing, spec) ? "matches" : "mismatch";
  }

  async lifecycle(gameId: GameReference): Promise<ChallengeGameLifecycle> {
    if (!this.games.has(gameId)) return "unknown";
    return this.lifecycles.get(gameId) ?? "awaiting_players";
  }
}

function sameSpec(a: ChallengeGameSpec, b: ChallengeGameSpec): boolean {
  return (
    a.gameId === b.gameId &&
    a.white === b.white &&
    a.black === b.black &&
    a.rulesetId === b.rulesetId &&
    a.timeControl.initialMs === b.timeControl.initialMs &&
    a.timeControl.incrementMs === b.timeControl.incrementMs &&
    a.startDeadlineAt === b.startDeadlineAt
  );
}
