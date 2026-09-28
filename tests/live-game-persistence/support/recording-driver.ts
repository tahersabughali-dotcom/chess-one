import {
  type CompiledQuery,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type QueryResult,
  type TransactionSettings,
} from "kysely";

/**
 * RECORDING DRIVER, NOT POSTGRESQL. Kysely compiles real PostgreSQL SQL and
 * hands it here; nothing is executed. Each step is recorded, and each query is
 * answered by a scripted responder, which may throw a driver-shaped error.
 * Rows pass through JSON text, as they would over the wire, so the adapter
 * sees untyped data. This shows what the adapter sends and how it reacts; it
 * cannot show PostgreSQL behaviour.
 */
export type Step =
  | { readonly kind: "begin"; readonly settings: TransactionSettings }
  | { readonly kind: "commit" }
  | { readonly kind: "rollback" }
  | { readonly kind: "query"; readonly sql: string; readonly parameters: readonly unknown[] };

export interface ScriptedResult {
  readonly rows?: readonly unknown[];
  readonly numAffectedRows?: bigint;
}

export type Responder = (sql: string, parameters: readonly unknown[]) => ScriptedResult;

/** An error shaped like a pg `DatabaseError`: a SQLSTATE and a message that must never leak. */
export function driverError(code: string | null, message = "secret-host password=hunter2"): Error {
  return Object.assign(new Error(message), code === null ? {} : { code });
}

class RecordingConnection implements DatabaseConnection {
  readonly #driver: RecordingDriver;

  constructor(driver: RecordingDriver) {
    this.#driver = driver;
  }

  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    const parameters = [...compiledQuery.parameters];
    this.#driver.steps.push({ kind: "query", sql: compiledQuery.sql, parameters });
    const scripted = this.#driver.respond(compiledQuery.sql, parameters);
    const rows: R[] = JSON.parse(JSON.stringify(scripted.rows ?? []));
    return scripted.numAffectedRows === undefined
      ? { rows }
      : { rows, numAffectedRows: scripted.numAffectedRows };
  }

  streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error("streaming is not used by the adapter");
  }
}

export class RecordingDriver implements Driver {
  readonly steps: Step[] = [];
  readonly respond: Responder;

  constructor(respond: Responder) {
    this.respond = respond;
  }

  async init(): Promise<void> {}

  async acquireConnection(): Promise<DatabaseConnection> {
    return new RecordingConnection(this);
  }

  async beginTransaction(
    _connection: DatabaseConnection,
    settings: TransactionSettings,
  ): Promise<void> {
    this.steps.push({ kind: "begin", settings: { ...settings } });
  }

  async commitTransaction(): Promise<void> {
    this.steps.push({ kind: "commit" });
  }

  async rollbackTransaction(): Promise<void> {
    this.steps.push({ kind: "rollback" });
  }

  async releaseConnection(): Promise<void> {}

  async destroy(): Promise<void> {}

  queries(): readonly { readonly sql: string; readonly parameters: readonly unknown[] }[] {
    return this.steps.flatMap((step) => (step.kind === "query" ? [step] : []));
  }

  kinds(): readonly string[] {
    return this.steps.map((step) =>
      step.kind === "query" ? step.sql.split(" ").slice(0, 3).join(" ") : step.kind,
    );
  }
}

export function recordingDatabase<DB>(driver: RecordingDriver): Kysely<DB> {
  const dialect: Dialect = {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => driver,
    createIntrospector: (db) => new PostgresIntrospector(db),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  };
  return new Kysely<DB>({ dialect });
}
