import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { captureError } from "@dtn/core";
import { getWebChannelByKey, NotFoundError, rateLimitHit, type ChannelRow } from "@dtn/db";
import { db } from "@/lib/db";

/**
 * Public web-chat endpoints (no user session). Controls: channel key must be
 * an active web channel of an active org; optional origin allowlist; rate
 * limits per visitor, per IP and per channel; org/agent budgets apply to the
 * LLM calls themselves.
 */
export class PublicChatError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export const VISITOR_RE = /^[A-Za-z0-9_-]{16,64}$/;

export function clientIp(req: NextRequest): string {
  return (req.headers.get("x-forwarded-for")?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "unknown").trim().slice(0, 64);
}

export async function resolveChannel(key: string, embedOrigin: string | null): Promise<ChannelRow> {
  const channel = await getWebChannelByKey(db(), key);
  if (!channel || !channel.agent_id) throw new PublicChatError(404, "channel_not_found");
  if (channel.allowed_origins.length) {
    let origin: string | null = null;
    try {
      origin = embedOrigin ? new URL(embedOrigin).origin : null;
    } catch {
      origin = null;
    }
    if (!origin || !channel.allowed_origins.includes(origin)) throw new PublicChatError(403, "origin_not_allowed");
  }
  return channel;
}

export async function enforceRateLimits(channel: ChannelRow, visitorId: string, ip: string) {
  const d = db();
  const perVisitor = Number(channel.config.visitorRpm ?? 12);
  const perChannel = Number(channel.config.channelRpm ?? 300);
  const checks = await Promise.all([
    rateLimitHit(d, `chat:v:${channel.id}:${visitorId}`, 60, perVisitor),
    rateLimitHit(d, `chat:ip:${channel.id}:${ip}`, 60, perVisitor * 3),
    rateLimitHit(d, `chat:c:${channel.id}`, 60, perChannel),
  ]);
  if (checks.includes(false)) throw new PublicChatError(429, "rate_limited");
}

export function publicError(e: unknown, requestId: string) {
  const headers = { "x-request-id": requestId, "cache-control": "no-store" };
  if (e instanceof PublicChatError) return NextResponse.json({ error: e.code }, { status: e.status, headers });
  if (e instanceof NotFoundError) return NextResponse.json({ error: "not_found" }, { status: 404, headers });
  captureError(e, { requestId, route: "public-chat" });
  return NextResponse.json({ error: "internal_error" }, { status: 500, headers });
}
