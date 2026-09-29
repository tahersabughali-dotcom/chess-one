import type {
  AccountsApi,
  AuthenticatedSession,
  AuthRequest,
  ChangePasswordError,
  LoginError,
  RegisterError,
  ResetPasswordError,
  ResetRequestError,
  SignedIn,
  VerificationError,
  VerificationRequestError,
} from "@chess-one/accounts";
import type { FactSink } from "@chess-one/live-game-runtime";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { EdgeFact } from "../facts.ts";
import {
  isJsonObject,
  type JsonLimits,
  type JsonObject,
  type JsonResult,
  parseStrictJson,
} from "../protocol/strict-json.ts";
import {
  type CookieRead,
  clearedSessionCookieHeader,
  readSessionCookie,
  type SessionCookiePolicy,
  sessionCookieHeader,
} from "./cookie.ts";
import { type AuthErrorCode, encodeAuthError, encodeAuthSessions, encodeAuthUser } from "./wire.ts";

export const AUTH_PREFIX = "/auth";

/** Largest auth body: a registration with a 256-code-point password fully `\u`-escaped fits. */
export const AUTH_BODY_LIMIT = 8_192;

/** Auth bodies are one flat object of at most four string members. */
export const AUTH_JSON_LIMITS: JsonLimits = Object.freeze({
  maxDepth: 1,
  maxStringLength: 1_024,
  maxObjectKeys: 4,
  maxArrayLength: 0,
});

const SAFE_METHODS = new Set(["GET", "HEAD"]);
const JSON_MEDIA_TYPE = /^application\/json(?:\s*;\s*charset=utf-8)?$/i;

export interface AuthRouteOptions {
  readonly accounts: AccountsApi;
  readonly cookie: SessionCookiePolicy;
  readonly allowedOrigins: ReadonlySet<string>;
  readonly maxCookieLength: number;
  readonly facts: FactSink<EdgeFact>;
  readonly reportDefect: (error: unknown) => void;
}

type ServiceError =
  | RegisterError
  | LoginError
  | ChangePasswordError
  | ResetRequestError
  | ResetPasswordError
  | VerificationRequestError
  | VerificationError;

function header(request: FastifyRequest, name: string): string | null {
  const value = request.headers[name];
  return typeof value === "string" ? value : null;
}

function fail(
  reply: FastifyReply,
  status: number,
  code: AuthErrorCode,
  detail: {
    readonly field?: string;
    readonly reason?: string;
    readonly retryAfterMs?: number;
  } = {},
): FastifyReply {
  return reply.code(status).send(encodeAuthError(code, detail));
}

function serviceError(reply: FastifyReply, error: ServiceError): FastifyReply {
  switch (error.kind) {
    case "invalid_input":
      return fail(reply, 400, "VALIDATION_FAILED", { field: error.field, reason: error.reason });
    case "rate_limited":
      reply.header("retry-after", String(Math.max(1, Math.ceil(error.retryAfterMs / 1_000))));
      return fail(reply, 429, "RATE_LIMITED", { retryAfterMs: error.retryAfterMs });
    case "busy":
      reply.header("retry-after", "1");
      return fail(reply, 503, "SERVICE_BUSY");
    case "feature_unavailable":
      return fail(reply, 501, "FEATURE_UNAVAILABLE");
    case "username_unavailable":
      return fail(reply, 409, "USERNAME_UNAVAILABLE");
    case "email_unavailable":
      return fail(reply, 409, "EMAIL_UNAVAILABLE");
    case "invalid_credentials":
      return fail(reply, 401, "INVALID_CREDENTIALS");
    case "account_unavailable":
      return fail(reply, 403, "ACCOUNT_UNAVAILABLE");
    case "invalid_token":
      return fail(reply, 400, "INVALID_TOKEN");
    case "already_verified":
      return fail(reply, 409, "ALREADY_VERIFIED");
  }
}

/** The HTTP status a Fastify framework error carries (body too large, bad media type, ...). */
function statusOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) return null;
  const { statusCode } = error;
  return typeof statusCode === "number" ? statusCode : null;
}

/** The member named `name` of a parsed body if it is a string. */
function text(body: JsonObject | null, name: string): string | null {
  const value = body?.get(name);
  return typeof value === "string" ? value : null;
}

/**
 * The `/auth` routes. State changes are POST or DELETE only, and every one
 * must come from an allowlisted Origin with a JSON body: a cross-site form
 * cannot send `application/json`, and a cross-site fetch cannot forge Origin.
 * With SameSite=Lax cookies that is the CSRF defence (AUTH-CSRF-001). No
 * CORS headers are ever sent: the API serves its own origins only.
 */
export function registerAuthRoutes(app: FastifyInstance, options: AuthRouteOptions): void {
  const { accounts, cookie, facts } = options;
  const bodies = new WeakMap<FastifyRequest, JsonResult>();
  const cleared = clearedSessionCookieHeader(cookie);

  const refuse = (
    reply: FastifyReply,
    status: number,
    code: AuthErrorCode,
    reason: "origin" | "fetch_site" | "media_type",
  ): FastifyReply => {
    facts.record({ name: "auth_request_refused", reason });
    return fail(reply, status, code);
  };

  const readCookie = (request: FastifyRequest): CookieRead => {
    const read = readSessionCookie(header(request, "cookie"), cookie, options.maxCookieLength);
    if (read.kind === "rejected") {
      facts.record({ name: "auth_request_refused", reason: "malformed_cookie" });
    }
    return read;
  };

  const client = (request: FastifyRequest): AuthRequest => ({ clientAddress: request.ip });

  const jsonObject = (request: FastifyRequest, members: number): JsonObject | null => {
    const parsed = bodies.get(request);
    if (parsed === undefined || !parsed.ok || !isJsonObject(parsed.value)) return null;
    return parsed.value.size === members ? parsed.value : null;
  };

  const signIn = (reply: FastifyReply, status: number, signedIn: SignedIn): FastifyReply => {
    const { token, maxAgeSeconds } = signedIn.session;
    reply.header("set-cookie", sessionCookieHeader(cookie, token, maxAgeSeconds));
    return reply.code(status).send(encodeAuthUser(signedIn.account));
  };

  /** The session the cookie proves, or null after answering 401 (and clearing a stale cookie). */
  const authenticated = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<AuthenticatedSession | null> => {
    const read = readCookie(request);
    const session = read.kind === "token" ? await accounts.authenticate(read.token) : null;
    if (session === null) {
      if (read.kind !== "absent") reply.header("set-cookie", cleared);
      fail(reply, 401, "UNAUTHENTICATED");
    }
    return session;
  };

  app.register(
    async (scope) => {
      scope.removeAllContentTypeParsers();
      scope.addContentTypeParser(
        "application/json",
        { parseAs: "string", bodyLimit: AUTH_BODY_LIMIT },
        (request, body, done) => {
          const source = typeof body === "string" ? body : body.toString("utf8");
          bodies.set(request, parseStrictJson(source, AUTH_JSON_LIMITS));
          done(null, null);
        },
      );

      scope.addHook("onRequest", async (request, reply) => {
        if (header(request, "sec-fetch-site") === "cross-site") {
          return refuse(reply, 403, "ORIGIN_NOT_ALLOWED", "fetch_site");
        }
        if (SAFE_METHODS.has(request.method)) return;
        const origin = header(request, "origin");
        if (origin === null || !options.allowedOrigins.has(origin)) {
          return refuse(reply, 403, "ORIGIN_NOT_ALLOWED", "origin");
        }
        if (
          request.method === "POST" &&
          !JSON_MEDIA_TYPE.test(header(request, "content-type") ?? "")
        ) {
          return refuse(reply, 415, "UNSUPPORTED_MEDIA_TYPE", "media_type");
        }
      });

      scope.setErrorHandler((error: unknown, _request, reply) => {
        const status = statusOf(error);
        if (status === 413) return fail(reply, 413, "PAYLOAD_TOO_LARGE");
        if (status === 415) return fail(reply, 415, "UNSUPPORTED_MEDIA_TYPE");
        if (status !== null && status >= 400 && status < 500) {
          return fail(reply, 400, "INVALID_REQUEST");
        }
        options.reportDefect(error);
        return fail(reply, 503, "SERVICE_UNAVAILABLE");
      });

      scope.setNotFoundHandler((_request, reply) => fail(reply, 404, "NOT_FOUND"));

      scope.post("/register", async (request, reply) => {
        const body = jsonObject(request, 3);
        const username = text(body, "username");
        const email = text(body, "email");
        const password = text(body, "password");
        if (username === null || email === null || password === null) {
          return fail(reply, 400, "INVALID_REQUEST");
        }
        const result = await accounts.register({ username, email, password }, client(request));
        return result.ok ? signIn(reply, 201, result.value) : serviceError(reply, result.error);
      });

      scope.post("/login", async (request, reply) => {
        const body = jsonObject(request, 2);
        const identifier = text(body, "identifier");
        const password = text(body, "password");
        if (identifier === null || password === null) return fail(reply, 400, "INVALID_REQUEST");
        const result = await accounts.login({ identifier, password }, client(request));
        return result.ok ? signIn(reply, 200, result.value) : serviceError(reply, result.error);
      });

      scope.post("/logout", async (request, reply) => {
        const read = readCookie(request);
        if (read.kind === "token") await accounts.logout(read.token);
        return reply.header("set-cookie", cleared).code(204).send();
      });

      scope.post("/logout-all", async (request, reply) => {
        const session = await authenticated(request, reply);
        if (session === null) return reply;
        await accounts.logoutAll(session);
        return reply.header("set-cookie", cleared).code(204).send();
      });

      scope.get("/me", async (request, reply) => {
        const session = await authenticated(request, reply);
        if (session === null) return reply;
        const account = await accounts.account(session);
        if (account === null) return fail(reply, 401, "UNAUTHENTICATED");
        return reply.code(200).send(encodeAuthUser(account));
      });

      scope.get("/sessions", async (request, reply) => {
        const session = await authenticated(request, reply);
        if (session === null) return reply;
        return reply.code(200).send(encodeAuthSessions(await accounts.listSessions(session)));
      });

      scope.delete<{ Params: { sessionId: string } }>(
        "/sessions/:sessionId",
        async (request, reply) => {
          const session = await authenticated(request, reply);
          if (session === null) return reply;
          const { sessionId } = request.params;
          const result = await accounts.revokeSession(session, sessionId);
          if (result === "not_found") return fail(reply, 404, "NOT_FOUND");
          if (sessionId === session.sessionId) reply.header("set-cookie", cleared);
          return reply.code(204).send();
        },
      );

      scope.post("/password", async (request, reply) => {
        const session = await authenticated(request, reply);
        if (session === null) return reply;
        const body = jsonObject(request, 2);
        const currentPassword = text(body, "currentPassword");
        const newPassword = text(body, "newPassword");
        if (currentPassword === null || newPassword === null) {
          return fail(reply, 400, "INVALID_REQUEST");
        }
        const result = await accounts.changePassword(
          session,
          { currentPassword, newPassword },
          client(request),
        );
        if (result.ok) return signIn(reply, 200, result.value);
        if (result.error.kind === "invalid_credentials") {
          return fail(reply, 403, "INVALID_CREDENTIALS");
        }
        return serviceError(reply, result.error);
      });

      scope.post("/password-reset/request", async (request, reply) => {
        const email = text(jsonObject(request, 1), "email");
        if (email === null) return fail(reply, 400, "INVALID_REQUEST");
        const result = await accounts.requestPasswordReset({ email }, client(request));
        return result.ok ? reply.code(202).send() : serviceError(reply, result.error);
      });

      scope.post("/password-reset/confirm", async (request, reply) => {
        const body = jsonObject(request, 2);
        const token = text(body, "token");
        const newPassword = text(body, "newPassword");
        if (token === null || newPassword === null) return fail(reply, 400, "INVALID_REQUEST");
        const result = await accounts.resetPassword({ token, newPassword }, client(request));
        return result.ok ? reply.code(204).send() : serviceError(reply, result.error);
      });

      scope.post("/email-verification/request", async (request, reply) => {
        const session = await authenticated(request, reply);
        if (session === null) return reply;
        const result = await accounts.requestEmailVerification(session);
        return result.ok ? reply.code(202).send() : serviceError(reply, result.error);
      });

      scope.post("/email-verification/confirm", async (request, reply) => {
        const token = text(jsonObject(request, 1), "token");
        if (token === null) return fail(reply, 400, "INVALID_REQUEST");
        const result = await accounts.confirmEmailVerification({ token }, client(request));
        return result.ok ? reply.code(204).send() : serviceError(reply, result.error);
      });
    },
    { prefix: AUTH_PREFIX },
  );
}
