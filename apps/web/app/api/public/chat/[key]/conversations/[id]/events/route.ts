import type { NextRequest } from "next/server";
import { z } from "zod";
import { publicThread } from "@dtn/db";
import { db } from "@/lib/db";
import { clientIp, enforceRateLimits, PublicChatError, publicError, resolveChannel, VISITOR_RE } from "@/lib/api/public-chat";
import { conversationEventStream } from "@/lib/sse";

export const dynamic = "force-dynamic";

/** Live updates for the visitor's own conversation (same checks as reading the thread). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string; id: string }> }) {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const { key, id } = await params;
    const visitorId = req.nextUrl.searchParams.get("visitorId") ?? "";
    if (!VISITOR_RE.test(visitorId) || !z.string().uuid().safeParse(id).success) throw new PublicChatError(400, "invalid_request");
    const channel = await resolveChannel(key, req.nextUrl.searchParams.get("origin"));
    await enforceRateLimits(channel, `${visitorId}:sse`, clientIp(req));
    await publicThread(db(), channel.organization_id, id, visitorId, channel.id); // 404 unless it is theirs
    return conversationEventStream(id, req.signal);
  } catch (e) {
    return publicError(e, requestId);
  }
}
