import {
  type ActiveGameState,
  type CommandDecision,
  type GameFinishedV1,
  processDeadline,
} from "@chess-one/live-game";
import {
  ms,
  newGame,
  offerCommand,
  playMoves,
  respondCommand,
  START_MS,
  submit,
} from "../../live-game/support/harness.ts";

/**
 * Persisted-state fixtures, each reached through the real live-game core so
 * every one is a state the writer can actually store.
 */
export interface Fixture {
  readonly name: string;
  readonly state: ActiveGameState;
  readonly time: number;
}

function accepted(decision: CommandDecision): ActiveGameState {
  if (decision.response.code !== "Accepted") {
    throw new Error(`fixture step was ${decision.response.code} (${decision.response.detail})`);
  }
  return decision.nextState;
}

/** Three moves, plus a bound `InvalidState` rejection (a promotion on a non-promoting move). */
export function activeWithBindings(): Fixture {
  const played = playMoves(newGame(), ["e2e4", "e7e5", "g1f3"]);
  const rejected = submit(
    played.state,
    {
      command: "SubmitMoveCommand.v1",
      contractVersion: "1",
      gameId: played.state.gameId,
      clientCommandId: "black-3-bad-promotion",
      controlLeaseId: played.state.controlLeases.black,
      expectedGameSequence: played.state.sequence,
      fromSquare: "b8",
      toSquare: "c6",
      promotionPiece: "q",
    },
    played.time + 10,
  );
  if (rejected.response.code !== "InvalidState") throw new Error("expected a bound rejection");
  return { name: "active with bindings", state: rejected.nextState, time: played.time + 10 };
}

/** After 1. e4 e5, black has offered a draw that white has not answered. */
export function pendingOffer(): Fixture {
  const played = playMoves(newGame(), ["e2e4", "e7e5"]);
  const time = played.time + 10;
  const state = accepted(submit(played.state, offerCommand(played.state, "black"), time, "black"));
  return { name: "pending offer", state, time };
}

/** The offer was declined: no pending offer, but this committed move has used its offer. */
export function declinedOffer(): Fixture {
  const offered = pendingOffer();
  const time = offered.time + 10;
  const state = accepted(
    submit(offered.state, respondCommand(offered.state, "white", "decline"), time, "white"),
  );
  return { name: "declined offer", state, time };
}

/** Fool's mate: finished, black wins by checkmate, with its one event. */
export function checkmate(): Fixture & { readonly events: readonly GameFinishedV1[] } {
  const before = playMoves(newGame(), ["f2f3", "e7e5", "g2g4"]);
  const time = before.time + 10;
  const decision = submit(
    before.state,
    {
      command: "SubmitMoveCommand.v1",
      contractVersion: "1",
      gameId: before.state.gameId,
      clientCommandId: "black-3-d8h4",
      controlLeaseId: before.state.controlLeases.black,
      expectedGameSequence: before.state.sequence,
      fromSquare: "d8",
      toSquare: "h4",
    },
    time,
  );
  return { name: "checkmate", state: accepted(decision), time, events: decision.events };
}

/** The pending offer was accepted: a draw by agreement. */
export function drawAgreed(): Fixture {
  const offered = pendingOffer();
  const time = offered.time + 10;
  const state = accepted(
    submit(offered.state, respondCommand(offered.state, "white", "accept"), time, "white"),
  );
  return { name: "draw agreed", state, time };
}

/** White flags at the start: the opponent's mating capability is UNKNOWN (DEC-064). */
export function unresolvedFlag(): Fixture {
  const game = newGame({ initialMs: 1_000 });
  const time = START_MS + 1_001;
  const decision = processDeadline(game, ms(time));
  if (!decision.flagged) throw new Error("expected a flag");
  return { name: "unresolved flag", state: decision.nextState, time };
}

export function allFixtures(): readonly Fixture[] {
  return [
    { name: "new game", state: newGame(), time: START_MS },
    activeWithBindings(),
    pendingOffer(),
    declinedOffer(),
    checkmate(),
    drawAgreed(),
    unresolvedFlag(),
  ];
}
