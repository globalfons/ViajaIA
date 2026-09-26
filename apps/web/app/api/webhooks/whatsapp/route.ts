import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { captureError, parseWhatsAppWebhook, verifyMetaSignature } from "@dtn/core";
import { enqueueWhatsAppInbound, getWhatsAppChannelByNumber, rateLimitHit } from "@dtn/db";
import { db } from "@/lib/db";

/**
 * WhatsApp Cloud API webhook (one endpoint for the agency's Meta app).
 * GET: subscription handshake with WHATSAPP_VERIFY_TOKEN.
 * POST: signature-verified events; each customer message is routed to its
 * tenant by phone_number_id and queued for the worker. Always fast.
 */

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export async function GET(req: NextRequest) {
  const verify = process.env.WHATSAPP_VERIFY_TOKEN;
  const q = req.nextUrl.searchParams;
  if (!verify || q.get("hub.mode") !== "subscribe" || !safeEqual(q.get("hub.verify_token") ?? "", verify)) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  return new NextResponse(q.get("hub.challenge") ?? "", { status: 200, headers: { "content-type": "text/plain" } });
}

export async function POST(req: NextRequest) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const raw = await req.text();
  if (raw.length > 1_000_000) return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), secret)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }
  try {
    const messages = parseWhatsAppWebhook(JSON.parse(raw));
    const d = db();
    for (const msg of messages) {
      const channel = await getWhatsAppChannelByNumber(d, msg.phoneNumberId);
      if (!channel) continue; // number not linked (or paused / org suspended): acknowledged, ignored
      // Abuse guard per sender; excess messages are acknowledged but not processed.
      if (!(await rateLimitHit(d, `wa:${channel.id}:${msg.from}`, 60, Number(channel.config.visitorRpm ?? 20)))) continue;
      await enqueueWhatsAppInbound(d, channel, msg);
    }
    return NextResponse.json({ received: messages.length });
  } catch (e) {
    captureError(e, { route: "webhooks/whatsapp" });
    // Non-2xx makes Meta retry; processing is idempotent by message id.
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
