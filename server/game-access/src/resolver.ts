import type { GameId, PlayerId } from "@chess-one/live-game-runtime";
import type { GameAccessStore } from "./ports.ts";
import { type AccessResolution, seatOf } from "./values.ts";

/**
 * AUTH-GAME-ACCESS-001: user id and game id to a seat, from the durable
 * assignment and nothing else: not the session, not the connection, not a
 * seat or player id the client sends. A store failure is `unavailable`,
 * never a guess.
 */
export class ProductionGameAccessResolver {
  readonly trust = "production";
  readonly #store: GameAccessStore;
  readonly #onFailure: (error: unknown) => void;

  constructor(store: GameAccessStore, onFailure: (error: unknown) => void) {
    this.#store = store;
    this.#onFailure = onFailure;
  }

  async resolve(playerId: PlayerId, gameId: GameId): Promise<AccessResolution> {
    try {
      const assignment = await this.#store.findAssignment(gameId);
      if (assignment === null) return "game_not_found";
      const seat = seatOf(assignment, playerId);
      if (seat === null) return "no_access";
      return seat === "white" ? "player_white" : "player_black";
    } catch (error: unknown) {
      this.#onFailure(error);
      return "unavailable";
    }
  }
}
