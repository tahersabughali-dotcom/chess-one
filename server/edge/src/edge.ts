import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import Fastify, { type FastifyInstance } from "fastify";
import { WebSocketServer } from "ws";
import { registerAuthRoutes } from "./auth/routes.ts";
import { type EdgeConfig, type ResolvedEdgeConfig, resolveEdgeConfig } from "./config.ts";
import { CLOSE_NORMAL, RealtimeConnection } from "./connection.ts";
import type { UpgradeRejection } from "./facts.ts";
import { REALTIME_PROTOCOL } from "./protocol/client-messages.ts";
import { type SessionCredentials, type TrustedSessionContext, validSession } from "./session.ts";

/** The one realtime endpoint. The version lives in the subprotocol, not the path. */
export const REALTIME_PATH = "/realtime";

type UpgradeHead = Parameters<WebSocketServer["handleUpgrade"]>[2];

const STATUS_TEXT: Readonly<Record<number, string>> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  503: "Service Unavailable",
};

export interface ListenAddress {
  readonly host: string;
  readonly port: number;
}

export interface RealtimeEdge {
  readonly app: FastifyInstance;
  readonly connectionCount: number;
  listen(address: ListenAddress): Promise<ListenAddress>;
  /** Closes every connection with 1000, waits for them, then closes the server. */
  close(): Promise<void>;
}

interface Rejection {
  readonly status: number;
  readonly reason: UpgradeRejection;
}

function reject(status: number, reason: UpgradeRejection): Rejection {
  return { status, reason };
}

function header(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name];
  return typeof value === "string" ? value : null;
}

function offeredProtocols(request: IncomingMessage): readonly string[] {
  return (header(request, "sec-websocket-protocol") ?? "").split(",").map((item) => item.trim());
}

/**
 * Everything that can be decided before the session: path, method, upgrade
 * header, protocol version, origin, capacity, and credential size.
 */
function precheck(
  request: IncomingMessage,
  config: ResolvedEdgeConfig,
  open: number,
): Rejection | SessionCredentials {
  if (request.url !== REALTIME_PATH) return reject(404, "not_found");
  if (request.method !== "GET" || header(request, "upgrade")?.toLowerCase() !== "websocket") {
    return reject(400, "bad_upgrade");
  }
  if (!offeredProtocols(request).includes(REALTIME_PROTOCOL)) {
    return reject(400, "unsupported_protocol_version");
  }
  const origin = header(request, "origin");
  if (origin === null || !config.allowedOrigins.has(origin)) {
    return reject(403, "origin_not_allowed");
  }
  if (open >= config.limits.maxConnections) return reject(503, "server_busy");
  const authorization = header(request, "authorization");
  const cookie = header(request, "cookie");
  const max = config.limits.maxCredentialLength;
  if ((authorization?.length ?? 0) > max || (cookie?.length ?? 0) > max) {
    return reject(400, "credential_too_large");
  }
  return { authorization, cookie };
}

const REJECTION_CODES: Readonly<Record<UpgradeRejection, string>> = {
  shutting_down: "SERVER_SHUTTING_DOWN",
  not_found: "NOT_FOUND",
  bad_upgrade: "BAD_UPGRADE",
  unsupported_protocol_version: "UNSUPPORTED_PROTOCOL_VERSION",
  origin_not_allowed: "ORIGIN_NOT_ALLOWED",
  credential_too_large: "CREDENTIAL_TOO_LARGE",
  unauthenticated: "UNAUTHENTICATED",
  session_unavailable: "SESSION_UNAVAILABLE",
  server_busy: "SERVER_BUSY",
};

/** Answers the upgrade with a plain HTTP error; no WebSocket is ever opened. */
function refuseUpgrade(socket: Duplex, rejection: Rejection): void {
  if (socket.destroyed) return;
  const body = JSON.stringify({ code: REJECTION_CODES[rejection.reason] });
  socket.once("finish", () => socket.destroy());
  socket.end(
    `HTTP/1.1 ${rejection.status} ${STATUS_TEXT[rejection.status] ?? "Error"}\r\n` +
      "Connection: close\r\nContent-Type: application/json\r\n" +
      `Content-Length: ${body.length}\r\n\r\n${body}`,
  );
}

/**
 * Response headers for every HTTP answer. This host serves JSON only, never
 * a document, so the CSP forbids everything; it is not a policy for a web
 * client, which will need its own. HSTS is sent in production only, where
 * every origin is https.
 */
const SECURITY_HEADERS: readonly (readonly [string, string])[] = [
  ["cache-control", "no-store"],
  ["x-content-type-options", "nosniff"],
  ["referrer-policy", "no-referrer"],
  ["x-frame-options", "DENY"],
  ["content-security-policy", "default-src 'none'; frame-ancestors 'none'"],
  ["cross-origin-resource-policy", "same-origin"],
];
const HSTS = "max-age=31536000";

type Resolution = { readonly session: TrustedSessionContext | null } | { readonly timedOut: true };

/** An upgrade waiting for its session; `close` waits for every one to settle. */
interface Admission {
  settled: Promise<void>;
}

/**
 * Creates the Fastify host and the WebSocket endpoint. The configuration is
 * checked first and fails closed; nothing listens until `listen`.
 */
export function createRealtimeEdge(input: EdgeConfig): RealtimeEdge {
  const config = resolveEdgeConfig(input);
  const { limits, facts } = config;
  const app = Fastify({ logger: false, bodyLimit: 1_024, return503OnClosing: true });
  const sockets = new WebSocketServer({
    noServer: true,
    clientTracking: false,
    perMessageDeflate: false,
    maxPayload: limits.maxMessageBytes,
    // Text is decoded by the connection, which answers MALFORMED_UNICODE instead of closing with 1007.
    skipUTF8Validation: true,
    handleProtocols: (protocols) => (protocols.has(REALTIME_PROTOCOL) ? REALTIME_PROTOCOL : false),
  });
  const connections = new Map<string, RealtimeConnection>();
  const admissions = new Set<Admission>();
  let nextConnection = 1;
  let closing = false;

  app.addHook("onSend", async (_request, reply, payload) => {
    for (const [name, value] of SECURITY_HEADERS) reply.header(name, value);
    if (config.environment === "production") reply.header("strict-transport-security", HSTS);
    return payload;
  });

  app.get(REALTIME_PATH, async (_request, reply) =>
    reply.code(426).header("upgrade", "websocket").send({ code: "UPGRADE_REQUIRED" }),
  );

  if (config.auth !== null) {
    registerAuthRoutes(app, {
      accounts: config.auth.accounts,
      cookie: config.auth.cookie,
      allowedOrigins: config.allowedOrigins,
      maxCookieLength: limits.maxCredentialLength,
      facts,
      reportDefect: config.reportDefect,
    });
  }

  const refuse = (socket: Duplex, rejection: Rejection): void => {
    facts.record({ name: "upgrade_rejected", status: rejection.status, reason: rejection.reason });
    refuseUpgrade(socket, rejection);
  };

  const resolveSession = async (credentials: SessionCredentials): Promise<Resolution> => {
    const timeout = Promise.withResolvers<Resolution>();
    const timer = setTimeout(
      () => timeout.resolve({ timedOut: true }),
      limits.sessionResolveTimeoutMs,
    );
    try {
      const resolved = config.sessionResolver
        .resolve(credentials)
        .then((session): Resolution => ({ session }));
      return await Promise.race([resolved, timeout.promise]);
    } finally {
      clearTimeout(timer);
    }
  };

  const admit = async (
    request: IncomingMessage,
    socket: Duplex,
    head: UpgradeHead,
    credentials: SessionCredentials,
    onSocketError: () => void,
  ): Promise<void> => {
    let resolution: Resolution;
    try {
      resolution = await resolveSession(credentials);
    } catch (error: unknown) {
      config.reportDefect(error);
      refuse(socket, reject(503, "session_unavailable"));
      return;
    }
    if ("timedOut" in resolution) {
      refuse(socket, reject(503, "session_unavailable"));
      return;
    }
    const { session } = resolution;
    if (session === null) {
      refuse(socket, reject(401, "unauthenticated"));
      return;
    }
    const grants = validSession(session, limits.maxGrantsPerSession);
    if (grants === null) {
      config.reportDefect(new Error("The session resolver returned an invalid session"));
      refuse(socket, reject(503, "session_unavailable"));
      return;
    }
    if (closing) {
      refuse(socket, reject(503, "shutting_down"));
      return;
    }
    if (socket.destroyed) return;
    sockets.handleUpgrade(request, socket, head, (ws) => {
      socket.off("error", onSocketError);
      const id = `connection-${nextConnection}`;
      nextConnection += 1;
      const connection = new RealtimeConnection({
        id,
        socket: ws,
        session,
        grants,
        config,
        onClosed: (closed) => connections.delete(closed.id),
      });
      connections.set(id, connection);
      facts.record({ name: "connection_opened" });
      if (closing) connection.close(CLOSE_NORMAL, "server_shutdown");
    });
  };

  const onUpgrade = (request: IncomingMessage, socket: Duplex, head: UpgradeHead): void => {
    const onSocketError = (): void => facts.record({ name: "socket_error" });
    socket.on("error", onSocketError);
    if (closing) {
      refuse(socket, reject(503, "shutting_down"));
      return;
    }
    const checked = precheck(request, config, connections.size + admissions.size);
    if ("status" in checked) {
      refuse(socket, checked);
      return;
    }
    const admission: Admission = { settled: Promise.resolve() };
    admissions.add(admission);
    admission.settled = (async () => {
      try {
        await admit(request, socket, head, checked, onSocketError);
      } catch (error: unknown) {
        config.reportDefect(error);
        refuse(socket, reject(503, "session_unavailable"));
      } finally {
        admissions.delete(admission);
      }
    })();
  };

  app.server.on("upgrade", onUpgrade);

  return {
    app,
    get connectionCount(): number {
      return connections.size;
    },
    async listen(address: ListenAddress): Promise<ListenAddress> {
      await app.listen({ host: address.host, port: address.port });
      const bound = app.server.address();
      if (bound === null || typeof bound === "string") throw new Error("Edge has no TCP address");
      return { host: bound.address, port: bound.port };
    },
    async close(): Promise<void> {
      closing = true;
      await Promise.all([...admissions].map((admission) => admission.settled));
      const open = [...connections.values()];
      for (const connection of open) connection.close(CLOSE_NORMAL, "server_shutdown");
      await Promise.all(open.map((connection) => connection.closed));
      app.server.off("upgrade", onUpgrade);
      sockets.close();
      await app.close();
    },
  };
}
