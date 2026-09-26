import { z } from "zod";

/**
 * Email channel adapter.
 *  - Inbound: a provider (or relay) POSTs the received email to the channel's
 *    webhook with a per-channel bearer token. Two payload shapes are accepted:
 *    the documented generic JSON and Postmark's inbound webhook.
 *  - Outbound: Resend HTTP API. Replies only; this adapter never starts a thread.
 *  - Loop protection: auto-generated mail (Auto-Submitted, bounces, no-reply
 *    senders, mailing lists) is never answered automatically.
 */

export const DEFAULT_RESEND_BASE_URL = "https://api.resend.com";

export interface InboundEmail {
  fromEmail: string;
  fromName: string | null;
  subject: string;
  text: string;
  messageId: string | null;
  inReplyTo: string | null;
  /** True when the message looks automated and must not receive an automatic reply. */
  automated: boolean;
}

const genericSchema = z.object({
  from: z.string().min(3).max(400),
  subject: z.string().max(998).optional().default(""),
  text: z.string().max(200_000).optional(),
  html: z.string().max(500_000).optional(),
  message_id: z.string().max(998).optional(),
  in_reply_to: z.string().max(998).optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

const postmarkSchema = z.object({
  From: z.string().min(3).max(400),
  FromName: z.string().max(400).optional(),
  Subject: z.string().max(998).optional().default(""),
  TextBody: z.string().max(200_000).optional(),
  HtmlBody: z.string().max(500_000).optional(),
  StrippedTextReply: z.string().max(200_000).optional(),
  MessageID: z.string().max(998).optional(),
  Headers: z.array(z.object({ Name: z.string(), Value: z.string() })).optional(),
});

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/** "Ana <ana@x.es>" → { email, name } */
export function parseAddress(raw: string): { email: string; name: string | null } | null {
  const m = /^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/.exec(raw);
  const email = (m ? m[2]! : raw).trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 320) return null;
  const name = m?.[1]?.trim() || null;
  return { email, name: name ? name.slice(0, 120) : null };
}

export function emailHtmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Removes the quoted previous conversation so the agent only sees the new text. */
export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*>/.test(line)) break;
    if (/^\s*(El .{3,120} escribió:|On .{3,120} wrote:|-----\s*(Original Message|Mensaje original)\s*-----|De: .+|From: .+)\s*$/i.test(line)) break;
    out.push(line);
  }
  return out.join("\n").trim();
}

const AUTOMATED_SENDER = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounces?|notifications?)([+.@-]|$)/i;

function isAutomated(fromEmail: string, headers: Record<string, string>): boolean {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v.toLowerCase()]));
  if (h["auto-submitted"] && h["auto-submitted"] !== "no") return true;
  if (h["precedence"] && /bulk|junk|list|auto_reply/.test(h["precedence"])) return true;
  if (h["list-id"] || h["list-unsubscribe"] || h["x-autoreply"] || h["x-autorespond"]) return true;
  return AUTOMATED_SENDER.test(fromEmail.split("@")[0] ?? "");
}

export function parseInboundEmail(payload: unknown): InboundEmail | null {
  const pm = postmarkSchema.safeParse(payload);
  if (pm.success) {
    const d = pm.data;
    const from = parseAddress(d.From);
    if (!from) return null;
    const headers = Object.fromEntries((d.Headers ?? []).map((x) => [x.Name, x.Value]));
    const raw = d.StrippedTextReply || d.TextBody || (d.HtmlBody ? emailHtmlToText(d.HtmlBody) : "");
    return {
      fromEmail: from.email,
      fromName: d.FromName?.slice(0, 120) || from.name,
      subject: d.Subject.slice(0, 300),
      text: stripQuotedReply(raw).slice(0, 8000),
      messageId: headers["Message-ID"] ?? d.MessageID ?? null,
      inReplyTo: headers["In-Reply-To"] ?? null,
      automated: isAutomated(from.email, headers),
    };
  }
  const g = genericSchema.safeParse(payload);
  if (!g.success) return null;
  const d = g.data;
  const from = parseAddress(d.from);
  if (!from) return null;
  const raw = d.text ?? (d.html ? emailHtmlToText(d.html) : "");
  return {
    fromEmail: from.email,
    fromName: from.name,
    subject: d.subject.slice(0, 300),
    text: stripQuotedReply(raw).slice(0, 8000),
    messageId: d.message_id ?? null,
    inReplyTo: d.in_reply_to ?? null,
    automated: isAutomated(from.email, d.headers ?? {}),
  };
}

export function replySubject(subject: string | null | undefined): string {
  const s = (subject ?? "").trim();
  if (!s) return "Re: Tu consulta";
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

export class EmailApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "EmailApiError";
  }
}

/** Sends one email through the Resend API. */
export async function sendEmailResend(p: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  text: string;
  inReplyTo?: string | null;
  baseUrl?: string;
  fetch?: typeof fetch;
}): Promise<{ id: string | null }> {
  const headers: Record<string, string> = {};
  if (p.inReplyTo) {
    headers["In-Reply-To"] = p.inReplyTo;
    headers["References"] = p.inReplyTo;
  }
  const res = await (p.fetch ?? fetch)(`${(p.baseUrl ?? DEFAULT_RESEND_BASE_URL).replace(/\/$/, "")}/emails`, {
    method: "POST",
    headers: { authorization: `Bearer ${p.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from: p.from, to: [p.to], subject: p.subject.slice(0, 300), text: p.text, headers }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!res.ok) throw new EmailApiError(`Email API ${res.status}: ${String(body.message ?? "request failed").slice(0, 200)}`, res.status);
  return { id: body.id ?? null };
}
