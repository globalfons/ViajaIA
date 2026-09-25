import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getOrCreateConversation, handleIncomingMessage } from "@dtn/db";
import { db } from "@/lib/db";
import { clientIp, enforceRateLimits, PublicChatError, publicError, resolveChannel, VISITOR_RE } from "@/lib/api/public-chat";

export const maxDuration = 120;

const body = z.object({
  visitorId: z.string().regex(VISITOR_RE),
  conversationId: z.string().uuid().nullish(),
  message: z.string().trim().min(1).max(4000),
  origin: z.string().max(300).nullish(),
});

/** A website visitor sends a message to the channel's agent. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  try {
    const { key } = await params;
    const text = await req.text();
    if (text.length > 20_000) throw new PublicChatError(413, "payload_too_large");
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new PublicChatError(400, "invalid_json");
    }
    const parsed = body.safeParse(json);
    if (!parsed.success) throw new PublicChatError(400, "invalid_request");
    const channel = await resolveChannel(key, parsed.data.origin ?? null);
    await enforceRateLimits(channel, parsed.data.visitorId, clientIp(req));

    const conversation = await getOrCreateConversation(db(), {
      organizationId: channel.organization_id,
      agentId: channel.agent_id!,
      channelId: channel.id,
      channelType: "web",
      visitorId: parsed.data.visitorId,
      conversationId: parsed.data.conversationId ?? null,
    });
    const res = await handleIncomingMessage(db(), { organizationId: channel.organization_id, conversation, text: parsed.data.message, runtime: { requestId } });
    return NextResponse.json(
      { conversationId: res.conversationId, reply: res.reply, status: res.status, escalated: res.escalated },
      { headers: { "x-request-id": requestId, "cache-control": "no-store" } },
    );
  } catch (e) {
    return publicError(e, requestId);
  }
}
