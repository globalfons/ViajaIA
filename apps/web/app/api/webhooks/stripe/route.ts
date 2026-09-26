import { NextResponse, type NextRequest } from "next/server";
import { captureError, parseStripeEvent, verifyStripeSignature } from "@dtn/core";
import { handleStripeEvent } from "@dtn/db";
import { db } from "@/lib/db";

/** Stripe webhook: signature-verified, idempotent (stripe_events), tenant resolved by customer id. */
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const raw = await req.text();
  if (raw.length > 1_000_000) return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  if (!verifyStripeSignature(raw, req.headers.get("stripe-signature"), secret)) return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  const event = parseStripeEvent(raw);
  if (!event) return NextResponse.json({ error: "invalid_event" }, { status: 400 });
  try {
    const result = await handleStripeEvent(db(), event);
    return NextResponse.json({ received: true, result });
  } catch (e) {
    captureError(e, { route: "webhooks/stripe", eventId: event.id });
    return NextResponse.json({ error: "processing_failed" }, { status: 500 }); // Stripe retries
  }
}
