import type { AuthenticatedSession, SessionAuthority } from "@chess-one/accounts";
import type { ChallengeApi, ChallengeError, CreateChallengeInput } from "@chess-one/challenges";
import type { FactSink } from "@chess-one/live-game-runtime";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  clearedSessionCookieHeader,
  readSessionCookie,
  type SessionCookiePolicy,
} from "../auth/cookie.ts";
import type { EdgeFact } from "../facts.ts";
import { guardScope, header, type ScopeFailure } from "../http/guarded-scope.ts";
import {
  isJsonObject,
  type JsonLimits,
  type JsonObject,
  type JsonResult,
} from "../protocol/strict-json.ts";
import {
  type ChallengeErrorCode,
  encodeChallenge,
  encodeChallengeAcceptance,
  encodeChallengeError,
  encodeChallengePage,
} from "./wire.ts";

export const CHALLENGES_PREFIX = "/challenges";

/** A create body is well under 512 bytes; the limit leaves room for escapes. */
export const CHALLENGE_BODY_LIMIT = 1_024;

/** One object holding scalars and the one nested time-control object. */
export const CHALLENGE_JSON_LIMITS: JsonLimits = Object.freeze({
  maxDepth: 2,
  maxStringLength: 64,
  maxObjectKeys: 4,
  maxArrayLength: 0,
});

const SCOPE_FAILURE_CODES: Readonly<Record<ScopeFailure, ChallengeErrorCode>> = Object.freeze({
  origin_not_allowed: "ORIGIN_NOT_ALLOWED",
  unsupported_media_type: "UNSUPPORTED_MEDIA_TYPE",
  payload_too_large: "PAYLOAD_TOO_LARGE",
  invalid_request: "INVALID_REQUEST",
  not_found: "NOT_FOUND",
  unavailable: "TEMPORARILY_UNAVAILABLE",
});

const CREATE_MEMBERS = new Set(["opponentUsername", "timeControl", "seatPreference", "rulesetId"]);
const TIME_CONTROL_MEMBERS = new Set(["type", "initialMs", "incrementMs"]);
const LIST_PARAMETERS = new Set(["direction", "cursor", "limit"]);
const PAGE_SIZE_TEXT = /^[1-9][0-9]{0,2}$/;
const RESOLUTION_ACTIONS: readonly ("decline" | "cancel")[] = ["decline", "cancel"];

export interface ChallengeRouteOptions {
  readonly challenges: ChallengeApi;
  readonly sessions: SessionAuthority;
  readonly cookie: SessionCookiePolicy;
  readonly allowedOrigins: ReadonlySet<string>;
  readonly maxCookieLength: number;
  readonly facts: FactSink<EdgeFact>;
  readonly reportDefect: (error: unknown) => void;
}

function fail(
  reply: FastifyReply,
  status: number,
  code: ChallengeErrorCode,
  retryAfterMs?: number,
): FastifyReply {
  return reply.code(status).send(encodeChallengeError(code, retryAfterMs));
}

function challengeError(reply: FastifyReply, error: ChallengeError): FastifyReply {
  switch (error.kind) {
    case "invalid_request":
      return fail(reply, 400, "INVALID_REQUEST");
    case "invalid_time_control":
      return fail(reply, 400, "INVALID_TIME_CONTROL");
    case "invalid_seat_preference":
      return fail(reply, 400, "INVALID_SEAT_PREFERENCE");
    case "invalid_ruleset":
      return fail(reply, 400, "INVALID_RULESET");
    case "cannot_challenge_self":
      return fail(reply, 400, "CANNOT_CHALLENGE_SELF");
    case "player_not_found":
      return fail(reply, 404, "PLAYER_NOT_FOUND");
    case "player_unavailable":
      return fail(reply, 409, "PLAYER_UNAVAILABLE");
    case "account_unavailable":
      return fail(reply, 403, "ACCOUNT_UNAVAILABLE");
    case "challenge_already_pending":
      return fail(reply, 409, "CHALLENGE_ALREADY_PENDING");
    case "challenge_limit_reached":
      return fail(reply, 409, "CHALLENGE_LIMIT_REACHED");
    case "challenge_not_found":
      return fail(reply, 404, "CHALLENGE_NOT_FOUND");
    case "challenge_not_pending":
      return fail(reply, 409, "CHALLENGE_NOT_PENDING");
    case "challenge_expired":
      return fail(reply, 409, "CHALLENGE_EXPIRED");
    case "challenge_accept_failed":
      return fail(reply, 409, "CHALLENGE_ACCEPT_FAILED");
    case "not_challenge_participant":
      return fail(reply, 403, "NOT_CHALLENGE_PARTICIPANT");
    case "rate_limited":
      reply.header("retry-after", String(Math.max(1, Math.ceil(error.retryAfterMs / 1_000))));
      return fail(reply, 429, "RATE_LIMITED", error.retryAfterMs);
    case "temporarily_unavailable":
      reply.header("retry-after", "1");
      return fail(reply, 503, "TEMPORARILY_UNAVAILABLE");
  }
}

function onlyMembers(object: JsonObject, allowed: ReadonlySet<string>): boolean {
  for (const key of object.keys()) if (!allowed.has(key)) return false;
  return true;
}

/** The body's shape only: every value is checked by the challenge application. */
function createInput(parsed: JsonResult | undefined): CreateChallengeInput | null {
  if (parsed === undefined || !parsed.ok || !isJsonObject(parsed.value)) return null;
  const body = parsed.value;
  if (!onlyMembers(body, CREATE_MEMBERS)) return null;
  const opponentUsername = body.get("opponentUsername");
  const seatPreference = body.get("seatPreference");
  const rulesetId = body.get("rulesetId") ?? null;
  const timeControl = body.get("timeControl");
  if (typeof opponentUsername !== "string" || typeof seatPreference !== "string") return null;
  if (rulesetId !== null && typeof rulesetId !== "string") return null;
  if (timeControl === undefined || timeControl === null || !isJsonObject(timeControl)) return null;
  if (timeControl.size !== TIME_CONTROL_MEMBERS.size) return null;
  if (!onlyMembers(timeControl, TIME_CONTROL_MEMBERS)) return null;
  const type = timeControl.get("type");
  const initialMs = timeControl.get("initialMs");
  const incrementMs = timeControl.get("incrementMs");
  if (typeof type !== "string" || typeof initialMs !== "number") return null;
  if (typeof incrementMs !== "number") return null;
  return {
    opponentUsername,
    rulesetId,
    timeControl: { type, initialMs, incrementMs },
    seatPreference,
  };
}

/** Query parameters as single strings, or null for an unknown or repeated one. */
function queryOf(query: unknown): ReadonlyMap<string, string> | null {
  if (typeof query !== "object" || query === null) return new Map();
  const parameters = new Map<string, string>();
  for (const [name, value] of Object.entries(query)) {
    if (!LIST_PARAMETERS.has(name) || typeof value !== "string") return null;
    parameters.set(name, value);
  }
  return parameters;
}

/**
 * The `/challenges` routes, cookie-authenticated, behind the same browser
 * protections as `/auth`. They carry requests to the challenge application
 * and answers back; every rule is the application's. Accept answers 200
 * with the created game, or 202 while the acceptance is processing.
 */
export function registerChallengeRoutes(
  app: FastifyInstance,
  options: ChallengeRouteOptions,
): void {
  const { challenges, sessions, cookie, facts } = options;
  const bodies = new WeakMap<FastifyRequest, JsonResult>();
  const cleared = clearedSessionCookieHeader(cookie);

  /** The session the cookie proves, or null after answering 401 (and clearing a stale cookie). */
  const authenticated = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<AuthenticatedSession | null> => {
    const read = readSessionCookie(header(request, "cookie"), cookie, options.maxCookieLength);
    if (read.kind === "rejected") {
      facts.record({ name: "challenge_request_refused", reason: "malformed_cookie" });
    }
    const session = read.kind === "token" ? await sessions.authenticate(read.token) : null;
    if (session === null) {
      if (read.kind !== "absent") reply.header("set-cookie", cleared);
      fail(reply, 401, "UNAUTHENTICATED");
    }
    return session;
  };

  /** Decline and cancel carry no data: the body must be exactly `{}`. */
  const emptyBody = (request: FastifyRequest): boolean => {
    const parsed = bodies.get(request);
    return parsed?.ok === true && isJsonObject(parsed.value) && parsed.value.size === 0;
  };

  app.register(
    async (scope) => {
      guardScope(scope, {
        allowedOrigins: options.allowedOrigins,
        bodyLimit: CHALLENGE_BODY_LIMIT,
        jsonLimits: CHALLENGE_JSON_LIMITS,
        bodies,
        refused: (reason) => facts.record({ name: "challenge_request_refused", reason }),
        fail: (reply, status, failure) => fail(reply, status, SCOPE_FAILURE_CODES[failure]),
        reportDefect: options.reportDefect,
      });

      scope.post("/", async (request, reply) => {
        const session = await authenticated(request, reply);
        if (session === null) return reply;
        const input = createInput(bodies.get(request));
        if (input === null) return fail(reply, 400, "INVALID_REQUEST");
        const result = await challenges.create(session, input);
        return result.ok
          ? reply.code(201).send(encodeChallenge(result.value))
          : challengeError(reply, result.error);
      });

      scope.get("/", async (request, reply) => {
        const session = await authenticated(request, reply);
        if (session === null) return reply;
        const query = queryOf(request.query);
        const direction = query?.get("direction");
        const limit = query?.get("limit");
        if (query === null || direction === undefined) return fail(reply, 400, "INVALID_REQUEST");
        if (limit !== undefined && !PAGE_SIZE_TEXT.test(limit)) {
          return fail(reply, 400, "INVALID_REQUEST");
        }
        const result = await challenges.list(session, {
          direction,
          cursor: query.get("cursor") ?? null,
          limit: limit === undefined ? null : Number(limit),
        });
        return result.ok
          ? reply.code(200).send(encodeChallengePage(result.value))
          : challengeError(reply, result.error);
      });

      scope.get<{ Params: { challengeId: string } }>("/:challengeId", async (request, reply) => {
        const session = await authenticated(request, reply);
        if (session === null) return reply;
        const result = await challenges.get(session, request.params.challengeId);
        return result.ok
          ? reply.code(200).send(encodeChallenge(result.value))
          : challengeError(reply, result.error);
      });

      scope.post<{ Params: { challengeId: string } }>(
        "/:challengeId/accept",
        async (request, reply) => {
          const session = await authenticated(request, reply);
          if (session === null) return reply;
          if (!emptyBody(request)) return fail(reply, 400, "INVALID_REQUEST");
          const result = await challenges.accept(session, request.params.challengeId);
          if (!result.ok) return challengeError(reply, result.error);
          return reply
            .code(result.value.game === null ? 202 : 200)
            .send(encodeChallengeAcceptance(result.value));
        },
      );

      for (const action of RESOLUTION_ACTIONS) {
        scope.post<{ Params: { challengeId: string } }>(
          `/:challengeId/${action}`,
          async (request, reply) => {
            const session = await authenticated(request, reply);
            if (session === null) return reply;
            if (!emptyBody(request)) return fail(reply, 400, "INVALID_REQUEST");
            const { challengeId } = request.params;
            const result =
              action === "decline"
                ? await challenges.decline(session, challengeId)
                : await challenges.cancel(session, challengeId);
            return result.ok
              ? reply.code(200).send(encodeChallenge(result.value))
              : challengeError(reply, result.error);
          },
        );
      }
    },
    { prefix: CHALLENGES_PREFIX },
  );
}
