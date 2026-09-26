import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * WhatsApp Business Cloud API (Meta) adapter.
 *  - Webhooks are authenticated with X-Hub-Signature-256 (HMAC-SHA256 of the
 *    raw body with the Meta app secret). Unsigned or mismatched payloads are rejected.
 *  - The tenant is identified by `metadata.phone_number_id`, never by payload content.
 *  - Only replies inside the customer-initiated conversation are sent; this
 *    adapter has no bulk/template sending (no unsolicited outreach).
 */

export const DEFAULT_GRAPH_BASE_URL = "https://graph.facebook.com/v21.0";

export function verifyMetaSignature(rawBody: string | Buffer, header: string | null | undefined, appSecret: string): boolean {
  if (!header || !appSecret || !header.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  let given: Buffer;
  try {
    given = Buffer.from(header.slice(7), "hex");
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export interface WhatsAppInbound {
  phoneNumberId: string;
  /** Sender wa_id (digits, international format without "+"). */
  from: string;
  name: string | null;
  messageId: string;
  type: string;
  /** Text content; for unsupported types, a short placeholder. */
  text: string;
  supported: boolean;
  timestamp: number | null;
}

const PLACEHOLDER: Record<string, string> = {
  image: "[Imagen]",
  audio: "[Nota de voz]",
  video: "[Vídeo]",
  document: "[Documento]",
  sticker: "[Sticker]",
  location: "[Ubicación]",
  contacts: "[Contacto]",
};

/** Extracts inbound customer messages from a webhook payload. Status updates are ignored. */
export function parseWhatsAppWebhook(payload: unknown): WhatsAppInbound[] {
  const out: WhatsAppInbound[] = [];
  const p = payload as { object?: string; entry?: { changes?: { field?: string; value?: Record<string, unknown> }[] }[] };
  if (p?.object !== "whatsapp_business_account" || !Array.isArray(p.entry)) return out;
  for (const entry of p.entry) {
    for (const change of entry.changes ?? []) {
      const value = change.value as
        | {
            metadata?: { phone_number_id?: string };
            contacts?: { wa_id?: string; profile?: { name?: string } }[];
            messages?: { id?: string; from?: string; type?: string; timestamp?: string; text?: { body?: string }; button?: { text?: string }; interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } } }[];
          }
        | undefined;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId || !Array.isArray(value?.messages)) continue;
      for (const m of value.messages) {
        if (!m.id || !m.from || !/^\d{6,20}$/.test(m.from)) continue;
        const type = m.type ?? "unknown";
        const text =
          type === "text"
            ? (m.text?.body ?? "")
            : type === "button"
              ? (m.button?.text ?? "")
              : type === "interactive"
                ? (m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? "")
                : (PLACEHOLDER[type] ?? `[Mensaje de tipo ${type.slice(0, 20)}]`);
        const supported = ["text", "button", "interactive"].includes(type) && text.trim().length > 0;
        const contact = value.contacts?.find((c) => c.wa_id === m.from);
        out.push({
          phoneNumberId: String(phoneNumberId),
          from: m.from,
          name: contact?.profile?.name?.slice(0, 120) ?? null,
          messageId: m.id,
          type,
          text: text.slice(0, 4096),
          supported,
          timestamp: m.timestamp ? Number(m.timestamp) : null,
        });
      }
    }
  }
  return out;
}

export class WhatsAppApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "WhatsAppApiError";
  }
}

interface GraphOptions {
  token: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

async function graph(path: string, opts: GraphOptions, init: RequestInit = {}) {
  const res = await (opts.fetch ?? fetch)(`${(opts.baseUrl ?? DEFAULT_GRAPH_BASE_URL).replace(/\/$/, "")}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${opts.token}`, "content-type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string } };
  // Never echo the token; Graph error messages do not contain it.
  if (!res.ok) throw new WhatsAppApiError(`WhatsApp API ${res.status}: ${String(body.error?.message ?? "request failed").slice(0, 200)}`, res.status);
  return body;
}

/** Confirms the token can operate the phone number (ownership check before linking a channel). */
export async function verifyWhatsAppNumber(phoneNumberId: string, opts: GraphOptions): Promise<{ displayPhoneNumber: string | null; verifiedName: string | null }> {
  if (!/^\d{5,30}$/.test(phoneNumberId)) throw new WhatsAppApiError("Invalid phone_number_id", 400);
  const b = await graph(`/${phoneNumberId}?fields=display_phone_number,verified_name`, opts);
  return { displayPhoneNumber: typeof b.display_phone_number === "string" ? b.display_phone_number : null, verifiedName: typeof b.verified_name === "string" ? b.verified_name : null };
}

/** Sends a free-form text reply (valid inside the 24h customer service window). */
export async function sendWhatsAppText(p: { phoneNumberId: string; to: string; text: string } & GraphOptions): Promise<{ messageId: string | null }> {
  const b = await graph(`/${p.phoneNumberId}/messages`, p, {
    method: "POST",
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: p.to, type: "text", text: { preview_url: false, body: p.text.slice(0, 4096) } }),
  });
  const messages = b.messages as { id?: string }[] | undefined;
  return { messageId: messages?.[0]?.id ?? null };
}

/** WhatsApp only allows free-form replies within 24h of the customer's last message. */
export function insideServiceWindow(lastInboundAt: Date | string | null, now = new Date()): boolean {
  if (!lastInboundAt) return false;
  return now.getTime() - new Date(lastInboundAt).getTime() < 24 * 3600 * 1000;
}
