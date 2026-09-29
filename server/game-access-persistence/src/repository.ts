import { isSessionId, type SessionId } from "@chess-one/accounts";
import {
  type Assignment,
  CONTROL_LEASE_FORMAT,
  type ControlChange,
  type GameAccessStore,
  GameAccessStoreError,
  type NewAssignment,
  type SeatControlRecord,
  type SeatListing,
} from "@chess-one/game-access";
import {
  type ControlLeaseId,
  type GameId,
  isControlLeaseId,
  isGameId,
  isPlayerId,
  type PlayerId,
  type Seat,
} from "@chess-one/live-game-runtime";
import { type Kysely, sql } from "kysely";
import type { GameAccessDatabase } from "./schema.ts";

/** A value the database returned that the adapter cannot trust. */
class MalformedRow extends Error {
  readonly column: string;

  constructor(column: string) {
    super(`malformed ${column}`);
    this.column = column;
  }
}

function sqlState(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  const { code } = error;
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : null;
}

/**
 * Every store call: a malformed row becomes `corrupt` (naming the column),
 * any driver failure `unavailable` (with its SQLSTATE); never a driver
 * message, SQL text, or stored value.
 */
async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error: unknown) {
    if (error instanceof GameAccessStoreError) throw error;
    if (error instanceof MalformedRow) throw new GameAccessStoreError("corrupt", error.column);
    throw new GameAccessStoreError("unavailable", sqlState(error));
  }
}

/** A lookup by key returns at most one row; two mean a lost key constraint. */
function only<T>(rows: readonly T[], column: string): readonly T[] {
  if (rows.length > 1) throw new MalformedRow(column);
  return rows;
}

function gameIdOf(value: string, column: string): GameId {
  if (!isGameId(value)) throw new MalformedRow(column);
  return value;
}

function playerIdOf(value: string, column: string): PlayerId {
  if (!isPlayerId(value)) throw new MalformedRow(column);
  return value;
}

function seatOfRow(value: string): Seat {
  if (value === "white" || value === "black") return value;
  throw new MalformedRow("game_seat_control.seat");
}

function sessionIdOf(value: string | null): SessionId | null {
  if (value === null) return null;
  if (!isSessionId(value)) throw new MalformedRow("game_seat_control.controlling_session_id");
  return value;
}

function leaseOf(value: string): ControlLeaseId {
  if (!CONTROL_LEASE_FORMAT.test(value) || !isControlLeaseId(value)) {
    throw new MalformedRow("game_seat_control.control_lease_id");
  }
  return value;
}

function versionOf(value: string): number {
  const version = /^(0|[1-9][0-9]{0,15})$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(version)) throw new MalformedRow("game_seat_control.control_version");
  return version;
}

interface AssignmentRow {
  readonly game_id: string;
  readonly white_user_id: string;
  readonly black_user_id: string;
  readonly state: string;
}

function assignmentOf(row: AssignmentRow): Assignment {
  const white = playerIdOf(row.white_user_id, "game_assignments.white_user_id");
  const black = playerIdOf(row.black_user_id, "game_assignments.black_user_id");
  if (white === black) throw new MalformedRow("game_assignments.players");
  if (row.state !== "pending" && row.state !== "confirmed") {
    throw new MalformedRow("game_assignments.state");
  }
  return Object.freeze({
    gameId: gameIdOf(row.game_id, "game_assignments.game_id"),
    players: Object.freeze({ white, black }),
    state: row.state,
  });
}

interface ControlRow {
  readonly game_id: string;
  readonly seat: string;
  readonly controlling_session_id: string | null;
  readonly control_lease_id: string;
  readonly control_version: string;
}

function controlOf(row: ControlRow): SeatControlRecord {
  return Object.freeze({
    gameId: gameIdOf(row.game_id, "game_seat_control.game_id"),
    seat: seatOfRow(row.seat),
    controllingSessionId: sessionIdOf(row.controlling_session_id),
    controlLeaseId: leaseOf(row.control_lease_id),
    version: versionOf(row.control_version),
  });
}

interface CheckedControlRow extends ControlRow {
  readonly white_user_id: string;
  readonly black_user_id: string;
  readonly holder_user_id: string | null;
}

/** A holder must be a session of the seat's own player; anything else is corrupt, never control. */
function checkedControlOf(row: CheckedControlRow): SeatControlRecord {
  const control = controlOf(row);
  if (control.controllingSessionId !== null) {
    const seatUser = control.seat === "white" ? row.white_user_id : row.black_user_id;
    if (row.holder_user_id !== seatUser) {
      throw new MalformedRow("game_seat_control.controlling_session_id");
    }
  }
  return control;
}

const CONTROL_COLUMNS: readonly [
  "game_id",
  "seat",
  "controlling_session_id",
  "control_lease_id",
  "control_version",
] = ["game_id", "seat", "controlling_session_id", "control_lease_id", "control_version"];

/**
 * The game-access tables on PostgreSQL. Every method is one statement or one
 * transaction. Reads join the assignment and the holder's session so a
 * control row can be checked against the seat's player before it is used.
 */
export class PostgresGameAccessStore implements GameAccessStore {
  readonly #db: Kysely<GameAccessDatabase>;

  constructor(db: Kysely<GameAccessDatabase>) {
    this.#db = db;
  }

  reserveAssignment(assignment: NewAssignment): Promise<"reserved" | "already_assigned"> {
    const { gameId, players, leases } = assignment;
    return guard(() =>
      this.#db.transaction().execute(async (trx): Promise<"reserved" | "already_assigned"> => {
        const inserted = await trx
          .insertInto("game_assignments")
          .values({
            game_id: gameId,
            white_user_id: players.white,
            black_user_id: players.black,
            state: "pending",
          })
          .onConflict((conflict) => conflict.column("game_id").doNothing())
          .returning("game_id")
          .executeTakeFirst();
        if (inserted === undefined) return "already_assigned";
        await trx
          .insertInto("game_seat_control")
          .values([
            {
              game_id: gameId,
              seat: "white",
              controlling_session_id: null,
              control_lease_id: leases.white,
              control_version: 0,
            },
            {
              game_id: gameId,
              seat: "black",
              controlling_session_id: null,
              control_lease_id: leases.black,
              control_version: 0,
            },
          ])
          .execute();
        return "reserved";
      }),
    );
  }

  confirmAssignment(gameId: GameId): Promise<boolean> {
    return guard(async () => {
      const result = await this.#db
        .updateTable("game_assignments")
        .set({ state: "confirmed", confirmed_at: sql<string>`clock_timestamp()` })
        .where("game_id", "=", gameId)
        .where("state", "=", "pending")
        .executeTakeFirst();
      return result.numUpdatedRows > 0n;
    });
  }

  discardPendingAssignment(gameId: GameId): Promise<boolean> {
    return guard(async () => {
      const result = await this.#db
        .deleteFrom("game_assignments")
        .where("game_id", "=", gameId)
        .where("state", "=", "pending")
        .executeTakeFirst();
      return result.numDeletedRows > 0n;
    });
  }

  findAssignment(gameId: GameId): Promise<Assignment | null> {
    return guard(async () => {
      const rows = await this.#db
        .selectFrom("game_assignments")
        .select(["game_id", "white_user_id", "black_user_id", "state"])
        .where("game_id", "=", gameId)
        .limit(2)
        .execute();
      const [row] = only(rows, "game_assignments.game_id");
      return row === undefined ? null : assignmentOf(row);
    });
  }

  seatsOf(playerId: PlayerId, limit: number): Promise<readonly SeatListing[]> {
    return guard(async () => {
      const { rows } = await sql<{ game_id: string; seat: string }>`
        SELECT game_id, seat FROM (
          (SELECT game_id, 'white' AS seat, created_at FROM game_assignments
            WHERE white_user_id = ${playerId} ORDER BY created_at DESC LIMIT ${limit})
          UNION ALL
          (SELECT game_id, 'black' AS seat, created_at FROM game_assignments
            WHERE black_user_id = ${playerId} ORDER BY created_at DESC LIMIT ${limit})
        ) AS seats
        ORDER BY created_at DESC, game_id
        LIMIT ${limit}
      `.execute(this.#db);
      return rows.map((row) =>
        Object.freeze({
          gameId: gameIdOf(row.game_id, "game_assignments.game_id"),
          seat: seatOfRow(row.seat),
        }),
      );
    });
  }

  findControl(gameId: GameId, seat: Seat): Promise<SeatControlRecord | null> {
    return guard(async () => {
      const rows = await this.#checkedControls()
        .where("c.game_id", "=", gameId)
        .where("c.seat", "=", seat)
        .limit(2)
        .execute();
      const [row] = only(rows, "game_seat_control.seat");
      return row === undefined ? null : checkedControlOf(row);
    });
  }

  transferControl(change: ControlChange): Promise<SeatControlRecord | null> {
    return guard(async () => {
      const row = await this.#db
        .updateTable("game_seat_control")
        .set({
          controlling_session_id: change.sessionId,
          control_lease_id: change.controlLeaseId,
          control_version: change.expectedVersion + 1,
          updated_at: sql<string>`clock_timestamp()`,
        })
        .where("game_id", "=", change.gameId)
        .where("seat", "=", change.seat)
        .where("control_version", "=", String(change.expectedVersion))
        .returning(CONTROL_COLUMNS)
        .executeTakeFirst();
      if (row === undefined) return null;
      const control = controlOf(row);
      if (control.version !== change.expectedVersion + 1) {
        throw new MalformedRow("game_seat_control.control_version");
      }
      return control;
    });
  }

  controlsHeldBySession(sessionId: SessionId): Promise<readonly SeatControlRecord[]> {
    return guard(async () => {
      const rows = await this.#checkedControls()
        .where("c.controlling_session_id", "=", sessionId)
        .execute();
      return rows.map(checkedControlOf);
    });
  }

  controlsHeldForUser(playerId: PlayerId): Promise<readonly SeatControlRecord[]> {
    return guard(async () => {
      const rows = await this.#checkedControls()
        .where("c.controlling_session_id", "is not", null)
        .where((eb) =>
          eb.or([
            eb.and([eb("c.seat", "=", "white"), eb("a.white_user_id", "=", playerId)]),
            eb.and([eb("c.seat", "=", "black"), eb("a.black_user_id", "=", playerId)]),
          ]),
        )
        .execute();
      return rows.map(checkedControlOf);
    });
  }

  #checkedControls() {
    return this.#db
      .selectFrom("game_seat_control as c")
      .innerJoin("game_assignments as a", "a.game_id", "c.game_id")
      .leftJoin("user_sessions as s", "s.session_id", "c.controlling_session_id")
      .select([
        "c.game_id",
        "c.seat",
        "c.controlling_session_id",
        "c.control_lease_id",
        "c.control_version",
        "a.white_user_id",
        "a.black_user_id",
        "s.user_id as holder_user_id",
      ]);
  }
}
