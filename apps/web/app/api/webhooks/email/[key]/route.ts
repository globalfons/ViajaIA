import { NextResponse, type NextRequest } from "next/server";
import { captureError, parseInboundEmail } from "@dtn/core";
import { authenticateEmailChannel, enqueueEmailInbound, rateLimitHit } from "@dtn/db";
import { db } from "@/lib/db";

/**
 * Inbound email for one channel. The provider (or a relay) authenticates with
 * the channel token: `Authorization: Bearer eit_…`. Accepts the generic JSON
 * format documented in docs/INTEGRATIONS.md and Postmark's inbound webhook.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const auth = req.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const d = db();
  const channel = await authenticateEmailChannel(d, key, token);
  if (!channel) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const raw = await req.text();
  if (raw.length > 2_000_000) return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const email = parseInboundEmail(json);
  if (!email) return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  try {
    if (!(await rateLimitHit(d, `em:${channel.id}:${email.fromEmail}`, 3600, Number(channel.config.senderPerHour ?? 30)))) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }
    await enqueueEmailInbound(d, channel, email);
    return NextResponse.json({ accepted: true }, { status: 202 });
  } catch (e) {
    captureError(e, { route: "webhooks/email" });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
