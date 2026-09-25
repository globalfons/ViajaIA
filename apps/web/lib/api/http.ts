import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { captureError, effectiveLimits, LimitExceededError, logger } from "@dtn/core";
import { NotFoundError, OrganizationSuspendedError, rateLimitHit, verifyApiKey, type ApiPrincipal, type ApiScope } from "@dtn/db";
import { db } from "@/lib/db";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface ApiContext {
  principal: ApiPrincipal;
  requestId: string;
  req: NextRequest;
}

const DEFAULT_RPM = 120;

function errorResponse(e: unknown, requestId: string, ctx: Record<string, unknown>) {
  const headers = { "x-request-id": requestId };
  if (e instanceof ApiError) return NextResponse.json({ error: { code: e.code, message: e.message, details: e.details } }, { status: e.status, headers });
  if (e instanceof z.ZodError)
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Validation failed", details: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } },
      { status: 400, headers },
    );
  if (e instanceof NotFoundError) return NextResponse.json({ error: { code: "not_found", message: e.message } }, { status: 404, headers });
  if (e instanceof LimitExceededError)
    return NextResponse.json({ error: { code: "limit_exceeded", message: e.message, details: { key: e.key, limit: e.limit } } }, { status: 402, headers });
  if (e instanceof OrganizationSuspendedError) return NextResponse.json({ error: { code: "organization_suspended", message: e.message } }, { status: 403, headers });
  captureError(e, { requestId, ...ctx });
  return NextResponse.json({ error: { code: "internal_error", message: "Internal server error" } }, { status: 500, headers });
}

async function requestsPerMinute(organizationId: string): Promise<number> {
  const { rows } = await db().query<{ limits: unknown; plan_limits: unknown }>(
    "select o.limits, p.limits as plan_limits from public.organizations o left join public.plans p on p.code = o.plan_code where o.id = $1",
    [organizationId],
  );
  return effectiveLimits(rows[0]?.plan_limits, rows[0]?.limits).requests_per_minute ?? DEFAULT_RPM;
}

/**
 * Wraps a public API route: Bearer API key → principal, scope check,
 * per-key rate limit, request id, structured logging and error mapping.
 */
export function withApi<P>(scope: ApiScope, handler: (ctx: ApiContext, params: P) => Promise<unknown>) {
  return async (req: NextRequest, route: { params: Promise<P> }) => {
    const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
    const started = Date.now();
    let principal: ApiPrincipal | null = null;
    try {
      const auth = req.headers.get("authorization") ?? "";
      const key = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      principal = key ? await verifyApiKey(db(), key) : null;
      if (!principal) throw new ApiError(401, "unauthorized", "Missing or invalid API key");
      if (!principal.scopes.includes(scope)) throw new ApiError(403, "insufficient_scope", `This key lacks the "${scope}" scope`);
      const rpm = await requestsPerMinute(principal.organizationId);
      if (!(await rateLimitHit(db(), `api:${principal.keyId}`, 60, rpm))) {
        return NextResponse.json({ error: { code: "rate_limited", message: "Too many requests" } }, { status: 429, headers: { "x-request-id": requestId, "retry-after": "60" } });
      }
      const result = await handler({ principal, requestId, req }, await route.params);
      const res =
        result instanceof Response
          ? new NextResponse(result.body, { status: result.status, headers: result.headers })
          : NextResponse.json(result ?? { ok: true });
      res.headers.set("x-request-id", requestId);
      logger({ requestId, organizationId: principal.organizationId }).info({ method: req.method, path: req.nextUrl.pathname, status: res.status, ms: Date.now() - started }, "api");
      return res;
    } catch (e) {
      return errorResponse(e, requestId, { organizationId: principal?.organizationId, path: req.nextUrl.pathname });
    }
  };
}

export async function readJson<T extends z.ZodType>(req: NextRequest, schema: T): Promise<z.infer<T>> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) throw new ApiError(415, "unsupported_media_type", "Content-Type must be application/json");
  const text = await req.text();
  if (text.length > 1_000_000) throw new ApiError(413, "payload_too_large", "Body too large");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ApiError(400, "invalid_json", "Malformed JSON body");
  }
  return schema.parse(body);
}

export const uuidParam = (v: string) => {
  const r = z.string().uuid().safeParse(v);
  if (!r.success) throw new ApiError(404, "not_found", "Not found");
  return r.data;
};
