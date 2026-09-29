import { err, ok, type Result } from "@chess-one/game-values";
import {
  type ActiveGameState,
  type ClockDomainId,
  type CommitError,
  type CommitPlan,
  type CommitReceipt,
  type CreateError,
  decodeGameState,
  type EventId,
  encodeBinding,
  encodeGameFinished,
  encodeGameState,
  type GameId,
  isEventId,
  type LiveGameRepository,
  type LoadError,
  type StoredGame,
} from "@chess-one/live-game";

/**
 * CONTRACT TEST DOUBLE, NOT POSTGRESQL. It stores only JSON text, exactly
 * the records the adapter writes, and decodes them on every load, so each
 * load behaves like a load after a restart. Commits are applied whole or not
 * at all with a sequence compare. It proves the writer's orchestration
 * against the repository contract; it says nothing about PostgreSQL
 * transactions, locking, or constraints, which only the `*.db.test.ts` suite
 * can show.
 */
export interface StoredText {
  readonly record: string;
  readonly bindings: readonly string[];
  readonly clockDomainId: ClockDomainId;
}

export interface OutboxText {
  readonly eventId: EventId;
  readonly gameId: string;
  readonly aggregateSequence: number;
  readonly eventType: string;
  readonly payload: string;
}

export class ContractRepository implements LiveGameRepository {
  readonly games = new Map<string, StoredText>();
  readonly outbox: OutboxText[] = [];
  /** Every call, in order, so tests can prove that nothing was written. */
  readonly calls: string[] = [];
  #nextEvent = 1;

  /** A second repository over the same stored text, as after a process restart. */
  restarted(): ContractRepository {
    const copy = new ContractRepository();
    for (const [id, text] of this.games) copy.games.set(id, text);
    copy.outbox.push(...this.outbox);
    copy.#nextEvent = this.#nextEvent;
    return copy;
  }

  writes(): readonly string[] {
    return this.calls.filter((call) => call !== "load");
  }

  async loadGame(gameId: GameId): Promise<Result<StoredGame, LoadError>> {
    this.calls.push("load");
    const stored = this.games.get(gameId);
    if (stored === undefined) return err({ kind: "game_not_found" });
    const decoded = decodeGameState(
      JSON.parse(stored.record),
      stored.bindings.map((binding) => JSON.parse(binding)),
    );
    return decoded.ok
      ? ok({ state: decoded.value, clockDomainId: stored.clockDomainId })
      : err(decoded.error);
  }

  async createGame(
    state: ActiveGameState,
    clockDomainId: ClockDomainId,
  ): Promise<Result<null, CreateError>> {
    this.calls.push("create");
    if (this.games.has(state.gameId)) return err({ kind: "game_already_exists" });
    this.games.set(state.gameId, {
      record: JSON.stringify(encodeGameState(state)),
      bindings: state.commandBindings.map((binding, index) =>
        JSON.stringify(encodeBinding(binding, index)),
      ),
      clockDomainId,
    });
    return ok(null);
  }

  async commitDecision(
    plan: CommitPlan,
    clockDomainId: ClockDomainId,
  ): Promise<Result<CommitReceipt, CommitError>> {
    this.calls.push(`commit:${plan.kind}`);
    const stored = this.games.get(plan.gameId);
    const current = stored === undefined ? null : JSON.parse(stored.record).sequence;
    if (stored === undefined || current !== plan.expectedSequence) {
      return err({ kind: "concurrency_conflict", expectedSequence: plan.expectedSequence });
    }
    if (plan.kind === "control") {
      this.games.set(plan.gameId, {
        ...stored,
        record: JSON.stringify(encodeGameState(plan.state)),
      });
      return ok({ eventIds: [] });
    }
    if (stored.bindings.length !== plan.bindingOrdinal) {
      return err({ kind: "concurrency_conflict", expectedSequence: plan.expectedSequence });
    }
    const bindings =
      plan.binding === null
        ? stored.bindings
        : [...stored.bindings, JSON.stringify(encodeBinding(plan.binding, plan.bindingOrdinal))];
    const eventIds: EventId[] = [];
    if (plan.kind === "transition") {
      for (const event of plan.events) {
        const eventId = `00000000-0000-4000-8000-${String(this.#nextEvent).padStart(12, "0")}`;
        if (!isEventId(eventId)) throw new Error("test event id");
        this.#nextEvent += 1;
        eventIds.push(eventId);
        this.outbox.push({
          eventId,
          gameId: event.gameId,
          aggregateSequence: event.gameSequence,
          eventType: event.eventName,
          payload: JSON.stringify(encodeGameFinished(event)),
        });
      }
    }
    this.games.set(plan.gameId, {
      record:
        plan.kind === "transition" ? JSON.stringify(encodeGameState(plan.state)) : stored.record,
      bindings,
      clockDomainId: plan.kind === "transition" ? clockDomainId : stored.clockDomainId,
    });
    return ok({ eventIds });
  }
}
