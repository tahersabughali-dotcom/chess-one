import { formatFen, type RulesetId } from "@chess-one/chess-rules";
import type { GameSequence } from "@chess-one/game-values";
import type { ActiveGameState } from "./active-game.ts";
import type { ClockState, WallClockMs } from "./clock.ts";
import type { CommandName } from "./commands.ts";
import type { CommandId, GameId, PlayerId, Seat } from "./ids.ts";
import type { GameResult } from "./result.ts";

/** The command that closed the game. */
export interface CommandFinishProvenance {
  readonly command: CommandName;
  readonly seat: Seat;
  readonly clientCommandId: CommandId;
}

/** The writer's own deadline check closed the game: no client command, no seat binding. */
export interface DeadlineFinishProvenance {
  readonly writerDeadline: true;
  readonly flaggedSide: Seat;
}

export type FinishProvenance = CommandFinishProvenance | DeadlineFinishProvenance;

/**
 * Domain shape of `game.finished.v1` (CONTRACT_CATALOG_V1 section 5), produced
 * only in the decision that commits a final result, so at most once per game.
 * It is not published here: the durable commit, outbox, and `event_id`
 * assignment are later work. `occurredAtWallClockMs` is trusted audit time
 * and never affects the result.
 */
export interface GameFinishedV1 {
  readonly eventName: "game.finished";
  readonly eventVersion: 1;
  readonly producer: "live_game_authority";
  readonly gameId: GameId;
  readonly gameSequence: GameSequence;
  readonly rulesetId: RulesetId;
  readonly playerIds: Readonly<Record<Seat, PlayerId>>;
  readonly result: GameResult;
  readonly finalPositionFen: string;
  readonly finalClock: ClockState;
  readonly occurredAtWallClockMs: WallClockMs | null;
  readonly provenance: FinishProvenance;
}

export function gameFinished(
  state: ActiveGameState,
  result: GameResult,
  provenance: FinishProvenance,
  occurredAt: WallClockMs | null,
): GameFinishedV1 {
  return Object.freeze({
    eventName: "game.finished",
    eventVersion: 1,
    producer: "live_game_authority",
    gameId: state.gameId,
    gameSequence: state.sequence,
    rulesetId: state.rulesetId,
    playerIds: state.players,
    result,
    finalPositionFen: formatFen(state.position),
    finalClock: state.clock,
    occurredAtWallClockMs: occurredAt,
    provenance: Object.freeze({ ...provenance }),
  });
}
