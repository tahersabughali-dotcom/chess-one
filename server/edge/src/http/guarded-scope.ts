import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthRefusal } from "../facts.ts";
import { type JsonLimits, type JsonResult, parseStrictJson } from "../protocol/strict-json.ts";

const SAFE_METHODS = new Set(["GET", "HEAD"]);
const JSON_MEDIA_TYPE = /^application\/json(?:\s*;\s*charset=utf-8)?$/i;

export function header(request: FastifyRequest, name: string): string | null {
  const value = request.headers[name];
  return typeof value === "string" ? value : null;
}

/** The HTTP status a Fastify framework error carries (body too large, bad media type, ...). */
function statusOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) return null;
  const { statusCode } = error;
  return typeof statusCode === "number" ? statusCode : null;
}

export type ScopeFailure =
  | "origin_not_allowed"
  | "unsupported_media_type"
  | "payload_too_large"
  | "invalid_request"
  | "not_found"
  | "unavailable";

export interface GuardedScopeOptions {
  readonly allowedOrigins: ReadonlySet<string>;
  readonly bodyLimit: number;
  readonly jsonLimits: JsonLimits;
  /** Where the parser leaves each request's strictly parsed body. */
  readonly bodies: WeakMap<FastifyRequest, JsonResult>;
  readonly refused: (reason: Exclude<AuthRefusal, "malformed_cookie">) => void;
  readonly fail: (reply: FastifyReply, status: number, failure: ScopeFailure) => FastifyReply;
  readonly reportDefect: (error: unknown) => void;
}

/**
 * The browser-facing HTTP protections every cookie-authenticated scope
 * shares (AUTH-CSRF-001). State changes must come from an allowlisted
 * Origin, and a POST must carry `application/json`: a cross-site form
 * cannot send that type and a cross-site fetch cannot forge Origin; with
 * SameSite=Lax cookies that is the CSRF defence. A `Sec-Fetch-Site:
 * cross-site` request is refused outright. Bodies go through the strict
 * JSON parser with the scope's limits. Framework errors never leak.
 */
export function guardScope(scope: FastifyInstance, options: GuardedScopeOptions): void {
  const { fail } = options;
  scope.removeAllContentTypeParsers();
  scope.addContentTypeParser(
    "application/json",
    { parseAs: "string", bodyLimit: options.bodyLimit },
    (request, body, done) => {
      const source = typeof body === "string" ? body : body.toString("utf8");
      options.bodies.set(request, parseStrictJson(source, options.jsonLimits));
      done(null, null);
    },
  );

  scope.addHook("onRequest", async (request, reply) => {
    if (header(request, "sec-fetch-site") === "cross-site") {
      options.refused("fetch_site");
      return fail(reply, 403, "origin_not_allowed");
    }
    if (SAFE_METHODS.has(request.method)) return;
    const origin = header(request, "origin");
    if (origin === null || !options.allowedOrigins.has(origin)) {
      options.refused("origin");
      return fail(reply, 403, "origin_not_allowed");
    }
    if (request.method === "POST" && !JSON_MEDIA_TYPE.test(header(request, "content-type") ?? "")) {
      options.refused("media_type");
      return fail(reply, 415, "unsupported_media_type");
    }
  });

  scope.setErrorHandler((error: unknown, _request, reply) => {
    const status = statusOf(error);
    if (status === 413) return fail(reply, 413, "payload_too_large");
    if (status === 415) return fail(reply, 415, "unsupported_media_type");
    if (status !== null && status >= 400 && status < 500) {
      return fail(reply, 400, "invalid_request");
    }
    options.reportDefect(error);
    return fail(reply, 503, "unavailable");
  });

  scope.setNotFoundHandler((_request, reply) => fail(reply, 404, "not_found"));
}
