import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  EmailApiError,
  insideServiceWindow,
  parseAddress,
  replySubject,
  sendEmailResend,
  sendWhatsAppText,
  verifyWhatsAppNumber,
  WhatsAppApiError,
  type InboundEmail,
  type WhatsAppInbound,
} from "@dtn/core";
import { NotFoundError } from "./agents";
import { createChannel, enqueueDelivery, handleIncomingMessage, type ChannelRow, type ConversationRow } from "./conversations";
import { enqueueJob } from "./jobs";
import type { Queryable } from "./pool";
import { getSecret, SECRET_NAME_RE } from "./secrets";
import type { RunAgentParams } from "./agents";

/**
 * WhatsApp Cloud API and email channels.
 *  - Webhooks only enqueue work; the worker processes each provider message
 *    once (messages.external_id is unique per organization).
 *  - Provider credentials live in the encrypted secrets store and are resolved
 *    here, server-side; they never reach the model or the browser.
 *  - Outbound messages are always replies to a customer-initiated thread.
 *    Email replies are drafts unless the client explicitly enabled auto-send.
 */

export class ChannelError extends Error {
  readonly status = 400;
}

export interface ProviderOptions {
  fetch?: typeof fetch;
  whatsappBaseUrl?: string;
  resendBaseUrl?: string;
  runtime?: RunAgentParams["runtime"];
}

export const providerOptionsFromEnv = (env: Record<string, string | undefined> = process.env): ProviderOptions => ({
  whatsappBaseUrl: env.WHATSAPP_GRAPH_BASE_URL || undefined,
  resendBaseUrl: env.RESEND_BASE_URL || undefined,
});

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

// ---------------------------------------------------------------------------
// Channel setup
// ---------------------------------------------------------------------------

export async function createWhatsAppChannel(
  db: Queryable,
  organizationId: string,
  input: { name: string; agentId: string; phoneNumberId: string; tokenSecret: string },
  userId: string | null,
  opts: ProviderOptions = {},
): Promise<ChannelRow> {
  if (!/^\d{5,30}$/.test(input.phoneNumberId)) throw new ChannelError("phone_number_id must be numeric");
  if (!SECRET_NAME_RE.test(input.tokenSecret)) throw new ChannelError("Invalid credential name");
  const token = await getSecret(db, organizationId, input.tokenSecret);
  if (!token) throw new ChannelError(`Save the credential ${input.tokenSecret} first`);
  let info: { displayPhoneNumber: string | null; verifiedName: string | null };
  try {
    // Ownership check: the client's token must be able to operate this number.
    info = await verifyWhatsAppNumber(input.phoneNumberId, { token, baseUrl: opts.whatsappBaseUrl, fetch: opts.fetch });
  } catch (e) {
    throw new ChannelError(e instanceof WhatsAppApiError ? `Meta rejected the number or token (${e.status})` : "Could not reach the WhatsApp API");
  }
  try {
    return await createChannel(
      db,
      organizationId,
      {
        type: "whatsapp",
        name: input.name,
        agentId: input.agentId,
        config: { phone_number_id: input.phoneNumberId, token_secret: input.tokenSecret, display_phone_number: info.displayPhoneNumber, verified_name: info.verifiedName },
      },
      userId,
    );
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new ChannelError("This WhatsApp number is already connected");
    throw e;
  }
}

export async function createEmailChannel(
  db: Queryable,
  organizationId: string,
  input: { name: string; agentId: string; fromAddress: string; apiKeySecret: string; autoSend: boolean },
  userId: string | null,
): Promise<{ channel: ChannelRow; inboundToken: string }> {
  const from = parseAddress(input.fromAddress);
  if (!from) throw new ChannelError("Invalid sender address");
  if (!SECRET_NAME_RE.test(input.apiKeySecret)) throw new ChannelError("Invalid credential name");
  const inboundToken = `eit_${randomBytes(24).toString("base64url")}`;
  const channel = await createChannel(
    db,
    organizationId,
    {
      type: "email",
      name: input.name,
      agentId: input.agentId,
      config: {
        from_address: input.fromAddress.trim(),
        api_key_secret: input.apiKeySecret,
        auto_send: input.autoSend === true,
        // Only the hash is stored; the token is shown once.
        inbound_token_sha256: sha256(inboundToken),
      },
    },
    userId,
  );
  return { channel, inboundToken };
}

/** Explicit, auditable switch for automatic email replies. */
export async function setEmailAutoSend(db: Queryable, organizationId: string, channelId: string, autoSend: boolean) {
  const res = await db.query(
    "update public.channels set config = jsonb_set(config, '{auto_send}', to_jsonb($3::boolean)) where id = $1 and organization_id = $2 and type = 'email'",
    [channelId, organizationId, autoSend],
  );
  if (!res.rowCount) throw new NotFoundError("Email channel");
}

export async function setChannelStatus(db: Queryable, organizationId: string, channelId: string, status: "active" | "paused") {
  const res = await db.query("update public.channels set status = $3 where id = $1 and organization_id = $2", [channelId, organizationId, status]);
  if (!res.rowCount) throw new NotFoundError("Channel");
}

// ---------------------------------------------------------------------------
// Webhook entry points (called by the web app; they only enqueue)
// ---------------------------------------------------------------------------

const CHANNEL_SELECT = "c.id, c.organization_id, c.type, c.name, c.agent_id, c.status, c.public_key, c.allowed_origins, c.config";

export async function getWhatsAppChannelByNumber(db: Queryable, phoneNumberId: string): Promise<ChannelRow | null> {
  const { rows } = await db.query<ChannelRow>(
    `select ${CHANNEL_SELECT} from public.channels c join public.organizations o on o.id = c.organization_id
     where c.type = 'whatsapp' and c.config->>'phone_number_id' = $1 and c.status = 'active' and o.status = 'active'`,
    [phoneNumberId],
  );
  return rows[0] ?? null;
}

/** Resolves an email channel by its public key AND verifies the bearer token (constant time). */
export async function authenticateEmailChannel(db: Queryable, publicKey: string, token: string | null): Promise<ChannelRow | null> {
  if (!/^em_[A-Za-z0-9_-]{20,40}$/.test(publicKey) || !token) return null;
  const { rows } = await db.query<ChannelRow>(
    `select ${CHANNEL_SELECT} from public.channels c join public.organizations o on o.id = c.organization_id
     where c.public_key = $1 and c.type = 'email' and c.status = 'active' and o.status = 'active'`,
    [publicKey],
  );
  const ch = rows[0];
  const expected = typeof ch?.config.inbound_token_sha256 === "string" ? Buffer.from(ch.config.inbound_token_sha256, "hex") : null;
  const given = Buffer.from(sha256(token), "hex");
  if (!ch || !expected || expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return ch;
}

export async function enqueueWhatsAppInbound(db: Queryable, channel: ChannelRow, msg: WhatsAppInbound) {
  return enqueueJob(db, {
    type: "channel.inbound",
    organizationId: channel.organization_id,
    payload: { kind: "whatsapp", channelId: channel.id, message: msg },
    dedupeKey: `wa:${msg.messageId}`,
  });
}

export async function enqueueEmailInbound(db: Queryable, channel: ChannelRow, email: InboundEmail) {
  return enqueueJob(db, {
    type: "channel.inbound",
    organizationId: channel.organization_id,
    payload: { kind: "email", channelId: channel.id, email },
    dedupeKey: email.messageId ? `em:${channel.id}:${email.messageId.slice(0, 300)}` : undefined,
  });
}

// ---------------------------------------------------------------------------
// Worker: inbound processing
// ---------------------------------------------------------------------------

async function loadChannel(db: Queryable, organizationId: string, channelId: string): Promise<ChannelRow | null> {
  const { rows } = await db.query<ChannelRow>(`select ${CHANNEL_SELECT} from public.channels c where c.id = $1 and c.organization_id = $2`, [channelId, organizationId]);
  return rows[0] ?? null;
}

async function alreadyProcessed(db: Queryable, organizationId: string, externalId: string | null) {
  if (!externalId) return false;
  const { rowCount } = await db.query("select 1 from public.messages where organization_id = $1 and external_id = $2", [organizationId, externalId]);
  return Boolean(rowCount);
}

async function upsertChannelContact(
  db: Queryable,
  organizationId: string,
  kind: "whatsapp" | "email",
  identity: string,
  name: string | null,
): Promise<string> {
  const found = await db.query<{ id: string }>(
    kind === "whatsapp"
      ? "select id from public.contacts where organization_id = $1 and external_ids->>'whatsapp' = $2 limit 1"
      : "select id from public.contacts where organization_id = $1 and lower(email) = $2 limit 1",
    [organizationId, identity],
  );
  if (found.rows[0]) {
    if (name) await db.query("update public.contacts set name = coalesce(name, $3) where id = $1 and organization_id = $2", [found.rows[0].id, organizationId, name]);
    return found.rows[0].id;
  }
  const { rows } = await db.query<{ id: string }>(
    `insert into public.contacts (organization_id, name, email, phone, external_ids, source, consent)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [
      organizationId,
      name,
      kind === "email" ? identity : null,
      kind === "whatsapp" ? `+${identity}` : null,
      kind === "whatsapp" ? { whatsapp: identity } : {},
      kind,
      { lawful_basis: "inbound_request", marketing: false },
    ],
  );
  return rows[0]!.id;
}

async function openConversation(
  db: Queryable,
  channel: ChannelRow,
  visitorId: string,
  contactId: string,
  subject: string | null,
  threadId: string | null,
): Promise<ConversationRow> {
  const { rows } = await db.query<ConversationRow>(
    `select * from public.conversations where organization_id = $1 and channel_id = $2 and visitor_id = $3 and status <> 'closed'
     order by created_at desc limit 1`,
    [channel.organization_id, channel.id, visitorId],
  );
  if (rows[0]) return rows[0];
  const created = await db.query<ConversationRow>(
    `insert into public.conversations (organization_id, agent_id, channel_id, channel_type, visitor_id, contact_id, subject, external_thread_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
    [channel.organization_id, channel.agent_id, channel.id, channel.type, visitorId, contactId, subject, threadId],
  );
  return created.rows[0]!;
}

/** Max automatic email replies per conversation and hour (mail-loop and abuse protection). */
export const EMAIL_AUTO_REPLIES_PER_HOUR = 5;

export async function processInbound(db: Queryable, organizationId: string, payload: Record<string, unknown>, opts: ProviderOptions = {}) {
  const channel = await loadChannel(db, organizationId, String(payload.channelId));
  if (!channel || channel.status !== "active") return { skipped: "channel inactive" };

  if (payload.kind === "whatsapp") {
    const msg = payload.message as WhatsAppInbound;
    if (await alreadyProcessed(db, organizationId, msg.messageId)) return { skipped: "duplicate" };
    const contactId = await upsertChannelContact(db, organizationId, "whatsapp", msg.from, msg.name);
    const conv = await openConversation(db, channel, msg.from, contactId, null, null);
    const res = await handleIncomingMessage(db, {
      organizationId,
      conversation: conv,
      text: msg.text,
      externalId: msg.messageId,
      humanOnlyReason: msg.supported ? null : `Unsupported WhatsApp message type: ${msg.type}`,
      runtime: opts.runtime,
    });
    if (res.replyMessageId && res.replyStatus === "sent") await enqueueDelivery(db, organizationId, res.replyMessageId);
    return res;
  }

  if (payload.kind === "email") {
    const email = payload.email as InboundEmail;
    if (await alreadyProcessed(db, organizationId, email.messageId)) return { skipped: "duplicate" };
    const ownAddress = parseAddress(String(channel.config.from_address ?? ""))?.email;
    if (ownAddress && email.fromEmail === ownAddress) return { skipped: "own address" };
    const contactId = await upsertChannelContact(db, organizationId, "email", email.fromEmail, email.fromName);
    const conv = await openConversation(db, channel, email.fromEmail, contactId, email.subject || null, email.messageId);
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int n from public.messages where conversation_id = $1 and organization_id = $2 and role = 'assistant' and status = 'sent' and created_at > now() - interval '1 hour'",
      [conv.id, organizationId],
    );
    const autoSend = channel.config.auto_send === true && rows[0]!.n < EMAIL_AUTO_REPLIES_PER_HOUR;
    const res = await handleIncomingMessage(db, {
      organizationId,
      conversation: conv,
      text: email.subject && conv.message_count === 0 ? `Asunto: ${email.subject}\n\n${email.text || "(sin texto)"}` : email.text || "(sin texto)",
      externalId: email.messageId,
      replyMode: autoSend ? "send" : "draft",
      humanOnlyReason: email.automated ? "Automated email (auto-reply, bounce or mailing list): not answered automatically" : null,
      runtime: opts.runtime,
    });
    if (res.replyMessageId && res.replyStatus === "sent") await enqueueDelivery(db, organizationId, res.replyMessageId);
    return res;
  }
  return { skipped: "unknown kind" };
}

// ---------------------------------------------------------------------------
// Worker: outbound delivery
// ---------------------------------------------------------------------------

/** Errors worth retrying (network, 429, 5xx). Other provider errors fail permanently. */
export class RetryableDeliveryError extends Error {}

async function markDelivery(db: Queryable, organizationId: string, messageId: number, status: "delivered" | "failed" | "not_sent", error: string | null, externalId?: string | null) {
  await db.query(
    `update public.messages set delivery_status = $3, delivery_error = $4, delivered_at = case when $3 = 'delivered' then now() else delivered_at end,
       external_id = coalesce(external_id, $5) where id = $1 and organization_id = $2`,
    [messageId, organizationId, status, error?.slice(0, 500) ?? null, externalId ?? null],
  );
}

export async function deliverMessage(db: Queryable, organizationId: string, messageId: number, opts: ProviderOptions = {}, finalAttempt = true) {
  const { rows } = await db.query<{
    role: string;
    content: string;
    status: string;
    delivery_status: string | null;
    conversation_id: string;
    visitor_id: string | null;
    subject: string | null;
    channel_id: string | null;
  }>(
    `select m.role, m.content, m.status, m.delivery_status, m.conversation_id, c.visitor_id, c.subject, c.channel_id
     from public.messages m join public.conversations c on c.id = m.conversation_id and c.organization_id = m.organization_id
     where m.id = $1 and m.organization_id = $2`,
    [messageId, organizationId],
  );
  const m = rows[0];
  if (!m || m.status !== "sent" || !["assistant", "human_agent"].includes(m.role) || m.delivery_status === "delivered") return { skipped: true };
  const channel = m.channel_id ? await loadChannel(db, organizationId, m.channel_id) : null;
  if (!channel || !m.visitor_id) {
    await markDelivery(db, organizationId, messageId, "failed", "Channel not found");
    return { failed: true };
  }
  const lastInbound = await db.query<{ at: string; external_id: string | null }>(
    "select created_at as at, external_id from public.messages where conversation_id = $1 and organization_id = $2 and role = 'user' order by id desc limit 1",
    [m.conversation_id, organizationId],
  );
  const permanent = async (reason: string) => {
    await markDelivery(db, organizationId, messageId, "failed", reason);
    return { failed: true, reason };
  };
  try {
    if (channel.type === "whatsapp") {
      if (!insideServiceWindow(lastInbound.rows[0]?.at ?? null)) return permanent("Outside WhatsApp's 24h customer service window");
      const token = await getSecret(db, organizationId, String(channel.config.token_secret ?? ""));
      if (!token) return permanent("WhatsApp token credential missing");
      const r = await sendWhatsAppText({ phoneNumberId: String(channel.config.phone_number_id), to: m.visitor_id, text: m.content, token, baseUrl: opts.whatsappBaseUrl, fetch: opts.fetch });
      await markDelivery(db, organizationId, messageId, "delivered", null, r.messageId);
      return { delivered: true };
    }
    if (channel.type === "email") {
      const apiKey = await getSecret(db, organizationId, String(channel.config.api_key_secret ?? ""));
      if (!apiKey) return permanent("Email API key credential missing");
      const r = await sendEmailResend({
        apiKey,
        from: String(channel.config.from_address),
        to: m.visitor_id,
        subject: replySubject(m.subject),
        text: m.content,
        inReplyTo: lastInbound.rows[0]?.external_id ?? null,
        baseUrl: opts.resendBaseUrl,
        fetch: opts.fetch,
      });
      await markDelivery(db, organizationId, messageId, "delivered", null, r.id ? `resend:${r.id}` : null);
      return { delivered: true };
    }
    return permanent(`Channel type ${channel.type} has no outbound delivery`);
  } catch (e) {
    const status = e instanceof WhatsAppApiError || e instanceof EmailApiError ? e.status : 0;
    const retryable = status === 0 || status === 429 || status >= 500;
    if (!retryable || finalAttempt) return permanent((e as Error).message);
    await markDelivery(db, organizationId, messageId, "failed", `${(e as Error).message} (retrying)`);
    throw new RetryableDeliveryError((e as Error).message);
  }
}

/** Retry a failed delivery from the inbox. */
export async function retryDelivery(db: Queryable, organizationId: string, messageId: number) {
  const res = await db.query(
    "update public.messages set delivery_status = 'pending', delivery_error = null where id = $1 and organization_id = $2 and status = 'sent' and delivery_status = 'failed'",
    [messageId, organizationId],
  );
  if (!res.rowCount) throw new NotFoundError("Failed delivery");
  await enqueueDelivery(db, organizationId, messageId);
}
