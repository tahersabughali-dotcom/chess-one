import { err, ok, type Result } from "@chess-one/game-values";
import {
  type ActiveGameState,
  type ClockDomainId,
  type CommandBinding,
  type CommandBindingRecordV1,
  type CommitError,
  type CommitPlan,
  type CommitReceipt,
  type CorruptState,
  type CreateError,
  decodeGameState,
  type EventId,
  encodeBinding,
  encodeGameFinished,
  encodeGameState,
  type GameFinishedV1,
  type GameId,
  isClockDomainId,
  isEventId,
  LIVE_GAME_STATE_FORMAT,
  type LiveGameRepository,
  type LoadError,
  type PersistenceFailure,
  type StoredGame,
} from "@chess-one/live-game";
import { type Kysely, type Selectable, sql, type Transaction } from "kysely";
import type { LiveGameCommandBindingsTable, LiveGameDatabase, LiveGamesTable } from "./schema.ts";

const AGGREGATE_TYPE = "live_game";

/** SQLSTATEs that mean another writer won: unique violation, serialization failure, deadlock. */
const CONFLICT_STATES = new Set(["23505", "40001", "40P01"]);

/** The compare-and-set found another sequence: nothing of the decision may be written. */
class SequenceMoved extends Error {}

/** A value the database returned that the adapter cannot trust; the transaction rolls back. */
class UnexpectedResult extends Error {}

type GameRow = Selectable<LiveGamesTable>;
type BindingRow = Selectable<LiveGameCommandBindingsTable>;

/** The SQLSTATE of a driver error, and nothing else: messages may carry data. */
function sqlState(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  const { code } = error;
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : null;
}

function failure(operation: PersistenceFailure["operation"], error: unknown): PersistenceFailure {
  return { kind: "persistence_failure", operation, code: sqlState(error) };
}

function corruptRow(path: string, reason: string): Result<never, CorruptState> {
  return err({ kind: "corrupt_state", path, reason });
}

/** pg returns `bigint` as text; accept only a canonical non-negative safe integer. */
function parseInt8(text: string): number | null {
  if (!/^(0|[1-9]\d*)$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}

function bindingRecord(
  row: BindingRow,
  index: number,
): Result<CommandBindingRecordV1, CorruptState> {
  const path = `bindings[${index}]`;
  if (row.record_format !== LIVE_GAME_STATE_FORMAT) {
    return corruptRow(`${path}.record_format`, "unknown serialization format");
  }
  const boundAtSequence = parseInt8(row.bound_at_sequence);
  if (boundAtSequence === null) return corruptRow(`${path}.bound_at_sequence`, "not a sequence");
  return ok({
    ordinal: row.binding_ordinal,
    seat: row.seat,
    clientCommandId: row.client_command_id,
    fingerprint: row.fingerprint,
    boundAtSequence,
    response: row.response,
  });
}

/** Decodes the stored rows and checks that the typed columns agree with the record. */
function decodeRows(
  game: GameRow,
  bindings: readonly BindingRow[],
): Result<StoredGame, CorruptState> {
  const records: CommandBindingRecordV1[] = [];
  for (const [index, row] of bindings.entries()) {
    const record = bindingRecord(row, index);
    if (!record.ok) return record;
    records.push(record.value);
  }
  const decoded = decodeGameState(game.state, records);
  if (!decoded.ok) return decoded;
  const state = decoded.value;
  const clockDomainId = game.clock_domain_id;
  if (!isClockDomainId(clockDomainId))
    return corruptRow("row.clock_domain_id", "not a clock domain id");
  const encoded = encodeGameState(state);
  const columns: readonly [string, unknown, unknown][] = [
    ["game_id", game.game_id, state.gameId],
    ["state_format", game.state_format, encoded.format],
    ["ruleset_id", game.ruleset_id, state.rulesetId],
    ["white_player_id", game.white_player_id, state.players.white],
    ["black_player_id", game.black_player_id, state.players.black],
    ["sequence", parseInt8(game.sequence), state.sequence],
    ["status_kind", game.status_kind, state.status.kind],
    ["position_fen", game.position_fen, encoded.positionFen],
  ];
  for (const [name, column, value] of columns) {
    if (column !== value)
      return corruptRow(`row.${name}`, "column disagrees with the state record");
  }
  return ok({ state, clockDomainId });
}

function gameColumns(state: ActiveGameState): {
  readonly sequence: number;
  readonly status_kind: string;
  readonly position_fen: string;
  readonly state: string;
} {
  const record = encodeGameState(state);
  return {
    sequence: record.sequence,
    status_kind: state.status.kind,
    position_fen: record.positionFen,
    state: JSON.stringify(record),
  };
}

async function insertBinding(
  trx: Transaction<LiveGameDatabase>,
  gameId: GameId,
  binding: CommandBinding,
  ordinal: number,
): Promise<void> {
  const record = encodeBinding(binding, ordinal);
  await trx
    .insertInto("live_game_command_bindings")
    .values({
      game_id: gameId,
      seat: record.seat,
      client_command_id: record.clientCommandId,
      binding_ordinal: record.ordinal,
      record_format: LIVE_GAME_STATE_FORMAT,
      fingerprint: record.fingerprint,
      bound_at_sequence: record.boundAtSequence,
      response: JSON.stringify(record.response),
    })
    .execute();
}

async function insertEvent(
  trx: Transaction<LiveGameDatabase>,
  event: GameFinishedV1,
): Promise<EventId> {
  const row = await trx
    .insertInto("outbox_events")
    .values({
      event_type: event.eventName,
      event_version: event.eventVersion,
      aggregate_type: AGGREGATE_TYPE,
      aggregate_id: event.gameId,
      aggregate_sequence: event.gameSequence,
      payload: JSON.stringify(encodeGameFinished(event)),
    })
    .returning("event_id")
    .executeTakeFirstOrThrow();
  if (!isEventId(row.event_id)) throw new UnexpectedResult();
  return row.event_id;
}

/**
 * `LiveGameRepository` on PostgreSQL through Kysely. Every statement is built
 * by Kysely with bound parameters. Errors are reported as kinds and SQLSTATEs
 * only; driver messages, SQL, and stored values are never passed on.
 */
export class PostgresLiveGameRepository implements LiveGameRepository {
  readonly #db: Kysely<LiveGameDatabase>;

  constructor(db: Kysely<LiveGameDatabase>) {
    this.#db = db;
  }

  async loadGame(gameId: GameId): Promise<Result<StoredGame, LoadError>> {
    let rows: { readonly game: GameRow; readonly bindings: readonly BindingRow[] } | undefined;
    try {
      rows = await this.#db
        .transaction()
        .setIsolationLevel("repeatable read")
        .setAccessMode("read only")
        .execute(async (trx) => {
          const game = await trx
            .selectFrom("live_games")
            .selectAll()
            .where("game_id", "=", gameId)
            .executeTakeFirst();
          if (game === undefined) return undefined;
          const bindings = await trx
            .selectFrom("live_game_command_bindings")
            .selectAll()
            .where("game_id", "=", gameId)
            .orderBy("binding_ordinal")
            .execute();
          return { game, bindings };
        });
    } catch (error: unknown) {
      return err(failure("load", error));
    }
    if (rows === undefined) return err({ kind: "game_not_found" });
    return decodeRows(rows.game, rows.bindings);
  }

  async createGame(
    state: ActiveGameState,
    clockDomainId: ClockDomainId,
  ): Promise<Result<null, CreateError>> {
    try {
      await this.#db.transaction().execute(async (trx) => {
        await trx
          .insertInto("live_games")
          .values({
            game_id: state.gameId,
            state_format: LIVE_GAME_STATE_FORMAT,
            ruleset_id: state.rulesetId,
            white_player_id: state.players.white,
            black_player_id: state.players.black,
            clock_domain_id: clockDomainId,
            ...gameColumns(state),
          })
          .execute();
        for (const [ordinal, binding] of state.commandBindings.entries()) {
          await insertBinding(trx, state.gameId, binding, ordinal);
        }
      });
      return ok(null);
    } catch (error: unknown) {
      return sqlState(error) === "23505"
        ? err({ kind: "game_already_exists" })
        : err(failure("create", error));
    }
  }

  /**
   * One transaction: compare-and-set the game row on `expectedSequence`, then
   * insert the binding and the outbox rows. Any failure rolls back all of it.
   * A bind-only plan still updates the row (audit time only), so it holds the
   * row lock and proves the sequence it was decided on.
   */
  async commitDecision(
    plan: CommitPlan,
    clockDomainId: ClockDomainId,
  ): Promise<Result<CommitReceipt, CommitError>> {
    try {
      const eventIds = await this.#db.transaction().execute(async (trx) => {
        const changes =
          plan.kind === "transition"
            ? { ...gameColumns(plan.state), clock_domain_id: clockDomainId }
            : {};
        const updated = await trx
          .updateTable("live_games")
          .set({ ...changes, updated_at: sql<string>`now()` })
          .where("game_id", "=", plan.gameId)
          .where("sequence", "=", String(plan.expectedSequence))
          .executeTakeFirst();
        if (updated.numUpdatedRows !== 1n) throw new SequenceMoved();
        if (plan.binding !== null) {
          await insertBinding(trx, plan.gameId, plan.binding, plan.bindingOrdinal);
        }
        const ids: EventId[] = [];
        if (plan.kind === "transition") {
          for (const event of plan.events) ids.push(await insertEvent(trx, event));
        }
        return ids;
      });
      return ok({ eventIds: Object.freeze(eventIds) });
    } catch (error: unknown) {
      const code = sqlState(error);
      if (error instanceof SequenceMoved || (code !== null && CONFLICT_STATES.has(code))) {
        return err({ kind: "concurrency_conflict", expectedSequence: plan.expectedSequence });
      }
      return err(failure("commit", error));
    }
  }
}
