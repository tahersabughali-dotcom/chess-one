import { REALTIME_PATH, REALTIME_PROTOCOL } from "@chess-one/edge";
import { WebSocket } from "ws";

/** The one browser origin every test edge allows. */
export const ORIGIN = "http://127.0.0.1:5173";

const WAIT_MS = 5_000;

/** Reads `path` out of parsed JSON without trusting its shape. */
export function field(value: unknown, ...path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) return undefined;
    current = new Map<string, unknown>(Object.entries(current)).get(key);
  }
  return current;
}

export function typeOf(message: unknown): unknown {
  return field(message, "type");
}

export interface ClientOptions {
  /** Bearer token; null sends no Authorization header. */
  readonly token: string | null;
  /** Origin header; null sends none. Defaults to the allowed origin. */
  readonly origin?: string | null;
  readonly protocols?: readonly string[];
  readonly path?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface Closure {
  readonly code: number;
  readonly reason: string;
}

export type Opened =
  | { readonly kind: "open"; readonly client: TestClient }
  | { readonly kind: "refused"; readonly status: number; readonly body: unknown };

/** A real `ws` client with an inbox that tests read in arrival order. */
export class TestClient {
  readonly socket: WebSocket;
  /** Every message received, in order, never consumed. */
  readonly received: unknown[] = [];
  readonly closed: Promise<Closure>;
  readonly #unread: unknown[] = [];
  readonly #waiters = new Set<() => void>();
  #closure: Closure | null = null;

  constructor(socket: WebSocket) {
    this.socket = socket;
    const closed = Promise.withResolvers<Closure>();
    this.closed = closed.promise;
    socket.on("message", (data, isBinary) => {
      const text = !isBinary && Buffer.isBuffer(data) ? data.toString("utf8") : null;
      const message: unknown = text === null ? { type: "__binary__" } : JSON.parse(text);
      this.received.push(message);
      this.#unread.push(message);
      this.#notify();
    });
    socket.on("close", (code, reason) => {
      this.#closure = { code, reason: reason.toString("utf8") };
      closed.resolve(this.#closure);
      this.#notify();
    });
    socket.on("error", () => {
      this.#notify();
    });
  }

  #notify(): void {
    for (const waiter of [...this.#waiters]) waiter();
  }

  get isClosed(): boolean {
    return this.#closure !== null;
  }

  /** Types of every message received so far. */
  types(): unknown[] {
    return this.received.map(typeOf);
  }

  /** Consumes the first unread message of `type`, waiting for it if needed. */
  next(type: string, timeoutMs = WAIT_MS): Promise<unknown> {
    return this.nextWhere((message) => typeOf(message) === type, timeoutMs, type);
  }

  /** Consumes the first unread message `matches` accepts, waiting for it if needed. */
  nextWhere(
    matches: (message: unknown) => boolean,
    timeoutMs = WAIT_MS,
    type = "matching message",
  ): Promise<unknown> {
    const take = (): { found: true; message: unknown } | { found: false } => {
      const index = this.#unread.findIndex(matches);
      if (index < 0) return { found: false };
      const [message] = this.#unread.splice(index, 1);
      return { found: true, message };
    };
    const now = take();
    if (now.found) return Promise.resolve(now.message);
    const waiting = Promise.withResolvers<unknown>();
    const timer = setTimeout(() => {
      this.#waiters.delete(check);
      waiting.reject(
        new Error(`no ${type} within ${timeoutMs} ms; received ${JSON.stringify(this.types())}`),
      );
    }, timeoutMs);
    const check = (): void => {
      const later = take();
      if (later.found) {
        clearTimeout(timer);
        this.#waiters.delete(check);
        waiting.resolve(later.message);
      } else if (this.#closure !== null) {
        clearTimeout(timer);
        this.#waiters.delete(check);
        waiting.reject(new Error(`closed ${this.#closure.code} before ${type}`));
      }
    };
    this.#waiters.add(check);
    return waiting.promise;
  }

  /** Unread messages of `type`, without waiting. */
  unread(type: string): unknown[] {
    return this.#unread.filter((message) => typeOf(message) === type);
  }

  send(value: unknown): void {
    this.socket.send(JSON.stringify(value));
  }

  sendRaw(data: string | Buffer, binary = false): void {
    this.socket.send(data, { binary });
  }

  async hello(): Promise<unknown> {
    this.send({ type: "hello", protocol: REALTIME_PROTOCOL });
    return this.next("connection_ready");
  }

  async sync(gameId: string, requestId = "sync-1"): Promise<unknown> {
    this.send({ type: "sync_game", requestId, gameId });
    return this.next("game_snapshot");
  }

  async close(): Promise<Closure> {
    if (this.#closure === null) this.socket.close(1000);
    return this.closed;
  }
}

/** Opens a WebSocket to the edge; an HTTP refusal is returned, not thrown. */
export function openClient(baseUrl: string, options: ClientOptions): Promise<Opened> {
  const headers = new Map<string, string>(Object.entries(options.headers ?? {}));
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  if (origin !== null) headers.set("origin", origin);
  if (options.token !== null) headers.set("authorization", `Bearer ${options.token}`);
  const socket = new WebSocket(
    `${baseUrl}${options.path ?? REALTIME_PATH}`,
    [...(options.protocols ?? [REALTIME_PROTOCOL])],
    { headers: Object.fromEntries(headers), perMessageDeflate: false },
  );
  const opened = Promise.withResolvers<Opened>();
  const client = new TestClient(socket);
  socket.once("open", () => opened.resolve({ kind: "open", client }));
  socket.once("unexpected-response", (request, response) => {
    const chunks: Buffer[] = [];
    response.on("data", (chunk: Buffer) => chunks.push(chunk));
    response.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      const body: unknown = text === "" ? null : JSON.parse(text);
      opened.resolve({ kind: "refused", status: response.statusCode ?? 0, body });
      request.destroy();
    });
  });
  socket.once("error", (error) => opened.reject(error));
  return opened.promise;
}

/** Opens a client that must be accepted. */
export async function connect(baseUrl: string, options: ClientOptions): Promise<TestClient> {
  const opened = await openClient(baseUrl, options);
  if (opened.kind !== "open") {
    throw new Error(`refused ${opened.status}: ${JSON.stringify(opened.body)}`);
  }
  return opened.client;
}

/** Opens a client and completes `hello`. */
export async function ready(baseUrl: string, token: string): Promise<TestClient> {
  const client = await connect(baseUrl, { token });
  await client.hello();
  return client;
}
