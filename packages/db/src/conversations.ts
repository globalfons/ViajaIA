import { randomBytes } from "node:crypto";
import { sanitizeText, stageFromAgent, type AgentRunResult, type ChatMessage } from "@dtn/core";
import { pgCrmStore } from "./crm";
import { enqueueJob } from "./jobs";
import { assertOrgActive, NotFoundError, runAgent, type RunAgentParams } from "./agents";
import type { Queryable } from "./pool";

/**
 * Conversations: one thread per contact/visitor and channel. The AI answers
 * while the conversation is "open"; escalation hands it to humans, and while
 * a human owns it ("escalated"/"human") the AI stays silent.
 */

export type ChannelType = "web" | "whatsapp" | "email" | "api" | "playground";

export interface ConversationRow {
  id: string;
  organization_id: string;
  agent_id: string | null;
  channel_id: string | null;
  channel_type: ChannelType;
  visitor_id: string | null;
  status: "open" | "escalated" | "human" | "closed";
  priority: string;
  escalation_reason: string | null;
  message_count: number;
  total_cost_usd: string;
  created_at: string;
}

export interface ChannelRow {
  id: string;
  organization_id: string;
  type: "web" | "whatsapp" | "email" | "api";
  name: string;
  agent_id: string | null;
  status: "active" | "paused";
  public_key: string | null;
  allowed_origins: string[];
  config: Record<string, unknown>;
}

export const FALLBACK_REPLY = "Ahora mismo no puedo responderte. Una persona del equipo revisará tu mensaje y te contestará lo antes posible.";
export const ESCALATED_REPLY = "Gracias. He pasado tu consulta a una persona del equipo, que te responderá en breve.";

const CHANNEL_COLS = "id, organization_id, type, name, agent_id, status, public_key, allowed_origins, config";

export async function createChannel(
  db: Queryable,
  organizationId: string,
  input: { type: ChannelRow["type"]; name: string; agentId: string; allowedOrigins?: string[]; config?: Record<string, unknown> },
  userId?: string | null,
): Promise<ChannelRow> {
  await assertOrgActive(db, organizationId);
  const agent = await db.query("select 1 from public.agents where id = $1 and organization_id = $2", [input.agentId, organizationId]);
  if (!agent.rowCount) throw new NotFoundError("Agent");
  const origins = (input.allowedOrigins ?? []).map((o) => new URL(o).origin);
  const { rows } = await db.query<ChannelRow>(
    `insert into public.channels (organization_id, type, name, agent_id, public_key, allowed_origins, config, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning ${CHANNEL_COLS}`,
    [organizationId, input.type, input.name, input.agentId, input.type === "web" ? `wc_${randomBytes(18).toString("base64url")}` : input.type === "email" ? `em_${randomBytes(18).toString("base64url")}` : null, origins, input.config ?? {}, userId ?? null],
  );
  return rows[0]!;
}

/** Resolves a public web-chat key to its channel. Only active channels of active orgs. */
export async function getWebChannelByKey(db: Queryable, publicKey: string): Promise<ChannelRow | null> {
  if (!/^wc_[A-Za-z0-9_-]{20,40}$/.test(publicKey)) return null;
  const { rows } = await db.query<ChannelRow>(
    `select ${CHANNEL_COLS.split(", ").map((c) => `c.${c}`).join(", ")} from public.channels c
     join public.organizations o on o.id = c.organization_id
     where c.public_key = $1 and c.type = 'web' and c.status = 'active' and o.status = 'active'`,
    [publicKey],
  );
  return rows[0] ?? null;
}

export async function getOrCreateConversation(
  db: Queryable,
  p: { organizationId: string; agentId: string; channelId?: string | null; channelType: ChannelType; visitorId?: string | null; conversationId?: string | null },
): Promise<ConversationRow> {
  if (p.conversationId) {
    // A visitor may only continue their own conversation on the same channel.
    const { rows } = await db.query<ConversationRow>(
      `select * from public.conversations where id = $1 and organization_id = $2
         and channel_id is not distinct from $3 and visitor_id is not distinct from $4`,
      [p.conversationId, p.organizationId, p.channelId ?? null, p.visitorId ?? null],
    );
    if (rows[0] && rows[0].status !== "closed") return rows[0];
  }
  const { rows } = await db.query<ConversationRow>(
    `insert into public.conversations (organization_id, agent_id, channel_id, channel_type, visitor_id)
     values ($1, $2, $3, $4, $5) returning *`,
    [p.organizationId, p.agentId, p.channelId ?? null, p.channelType, p.visitorId ?? null],
  );
  return rows[0]!;
}

async function appendMessage(
  db: Queryable,
  m: {
    organizationId: string;
    conversationId: string;
    role: "user" | "assistant" | "human_agent" | "system";
    content: string;
    authorId?: string | null;
    run?: { id: string; result: AgentRunResult } | null;
    status?: "sent" | "failed" | "draft";
    error?: string | null;
    externalId?: string | null;
    deliveryStatus?: "pending" | "delivered" | "failed" | "not_sent" | null;
  },
) {
  const r = m.run?.result;
  const tokens = r ? r.usage.inputTokens + r.usage.outputTokens : 0;
  const { rows } = await db.query<{ id: number; created_at: string }>(
    `insert into public.messages (organization_id, conversation_id, role, content, author_id, agent_run_id, model,
       input_tokens, output_tokens, cost_usd, sources, tool_calls, status, error, external_id, delivery_status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning id, created_at`,
    [
      m.organizationId,
      m.conversationId,
      m.role,
      m.content,
      m.authorId ?? null,
      m.run?.id ?? null,
      r?.model ?? null,
      r?.usage.inputTokens ?? 0,
      r?.usage.outputTokens ?? 0,
      r?.usage.costUsd ?? 0,
      r ? JSON.stringify(r.sources.map((s) => ({ id: s.id, documentId: s.documentId, title: s.title, score: s.score }))) : null,
      r ? JSON.stringify(r.toolInvocations.map((t) => ({ name: t.name, status: t.status, durationMs: t.durationMs }))) : null,
      m.status ?? "sent",
      m.error ?? null,
      m.externalId ?? null,
      m.deliveryStatus ?? null,
    ],
  );
  await db.query(
    `update public.conversations set message_count = message_count + 1, total_tokens = total_tokens + $3,
       total_cost_usd = total_cost_usd + $4, last_message_at = now() where id = $1 and organization_id = $2`,
    [m.conversationId, m.organizationId, tokens, r?.usage.costUsd ?? 0],
  );
  return rows[0]!;
}

async function history(db: Queryable, organizationId: string, conversationId: string, limit = 30): Promise<ChatMessage[]> {
  const { rows } = await db.query<{ role: string; content: string }>(
    `select role, content from (
       select role, content, id from public.messages
       where conversation_id = $1 and organization_id = $2 and status = 'sent' and role <> 'system'
       order by id desc limit $3) t order by id`,
    [conversationId, organizationId, limit],
  );
  // Human agent replies are part of the assistant side of the dialogue.
  return rows.map((r) => ({ role: r.role === "user" ? "user" : "assistant", content: r.content }) as ChatMessage);
}

/** Customer-facing text of a run (structured outputs expose `answer`/`reply`). */
export function replyText(r: AgentRunResult): string {
  const s = r.structured;
  if (s && typeof s.answer === "string") return s.answer;
  if (s && typeof s.reply === "string") return s.reply;
  return r.output;
}

export interface IncomingResult {
  conversationId: string;
  status: ConversationRow["status"];
  reply: string | null;
  escalated: boolean;
  runId?: string;
  /** Id of the stored reply (to deliver it on external channels). */
  replyMessageId?: number;
  replyStatus?: "sent" | "draft" | "failed";
}

const EXTERNAL_CHANNELS = new Set(["whatsapp", "email"]);

/**
 * Handles one inbound customer message end to end: persist → (AI answer |
 * human queue) → persist reply → escalation bookkeeping.
 */
export async function handleIncomingMessage(
  db: Queryable,
  p: {
    organizationId: string;
    conversation: ConversationRow;
    text: string;
    runtime?: RunAgentParams["runtime"];
    /** Provider message id (wamid…, Message-ID) for idempotency. */
    externalId?: string | null;
    /** "draft": the AI reply waits for a person to send it (email without explicit auto-send). */
    replyMode?: "send" | "draft";
    /** Skip the AI and hand the conversation to a person (unsupported media, automated mail…). */
    humanOnlyReason?: string | null;
  },
): Promise<IncomingResult> {
  const text = sanitizeText(p.text, 8000).trim();
  if (!text) throw new Error("Empty message");
  const conv = p.conversation;
  const prior = await history(db, p.organizationId, conv.id);
  await appendMessage(db, { organizationId: p.organizationId, conversationId: conv.id, role: "user", content: text, externalId: p.externalId });

  if (p.humanOnlyReason && conv.status === "open") {
    await db.query("update public.conversations set status = 'escalated', escalation_reason = $3 where id = $1 and organization_id = $2", [conv.id, p.organizationId, p.humanOnlyReason.slice(0, 300)]);
    return { conversationId: conv.id, status: "escalated", reply: null, escalated: true };
  }
  // A person owns the conversation: queue it for them, the AI does not answer.
  if (conv.status === "escalated" || conv.status === "human" || !conv.agent_id) {
    return { conversationId: conv.id, status: conv.status, reply: null, escalated: true };
  }

  let run: { runId: string; result: AgentRunResult } | null = null;
  try {
    run = await runAgent({
      db,
      organizationId: p.organizationId,
      agentId: conv.agent_id,
      message: text,
      history: prior,
      source: "channel",
      conversationId: conv.id,
      runtime: p.runtime,
    });
  } catch {
    run = null; // agent missing/paused or org suspended: fall back to a human
  }

  const r = run?.result;
  let reply: string;
  let escalate: string | null = null;
  if (!r || r.status === "failed") {
    reply = FALLBACK_REPLY;
    escalate = r?.error ? `AI error: ${r.error.slice(0, 200)}` : "AI unavailable";
  } else if (r.status === "needs_approval") {
    reply = ESCALATED_REPLY;
    escalate = `Pending approval for ${r.pendingApproval?.toolName ?? "an action"}`;
  } else {
    reply = replyText(r) || FALLBACK_REPLY;
    if (r.status === "escalated") {
      const reason = r.structured && typeof r.structured.reason === "string" ? r.structured.reason : "Low confidence or human requested";
      escalate = reason.slice(0, 300);
    }
    if (r.status === "blocked" && r.flags.injection.length) escalate = "Possible prompt injection";
  }

  const external = EXTERNAL_CHANNELS.has(conv.channel_type);
  const ok = Boolean(r && r.status !== "failed");
  // On external channels the fallback text is still delivered so the customer is not left without an answer.
  const replyStatus: "sent" | "draft" | "failed" = p.replyMode === "draft" ? "draft" : ok || external ? "sent" : "failed";
  const stored = await appendMessage(db, {
    organizationId: p.organizationId,
    conversationId: conv.id,
    role: "assistant",
    content: reply,
    run: run ? { id: run.runId, result: run.result } : null,
    status: replyStatus,
    error: r?.error ?? (r ? null : "AI unavailable"),
    deliveryStatus: external && replyStatus === "sent" ? "pending" : null,
  });
  // Sales/qualification agents return score + stage: keep the lead in the CRM up to date.
  const st = r?.structured;
  if (r && r.status !== "failed" && st && typeof st.score === "number") {
    const qualification = Object.fromEntries(["budget", "authority", "need", "timeline"].filter((k) => st[k]).map((k) => [k, String(st[k]).slice(0, 500)]));
    await pgCrmStore(db)
      .upsertLead(p.organizationId, {
        title: `Visitante ${conv.visitor_id?.slice(0, 6) ?? conv.channel_type}`,
        score: Math.max(0, Math.min(100, Math.round(st.score))),
        stage: stageFromAgent(st.stage) ?? undefined,
        source: conv.channel_type === "playground" ? "api" : (conv.channel_type as "web" | "whatsapp" | "email" | "api"),
        conversationId: conv.id,
        qualification,
        lawfulBasis: "inbound_request",
      })
      .catch(() => undefined); // CRM bookkeeping never breaks the customer reply
  }

  if (escalate) {
    await db.query(
      "update public.conversations set status = 'escalated', escalation_reason = $3, priority = case when priority = 'low' then 'normal' else priority end where id = $1 and organization_id = $2",
      [conv.id, p.organizationId, escalate],
    );
  }
  return { conversationId: conv.id, status: escalate ? "escalated" : conv.status, reply, escalated: Boolean(escalate), runId: run?.runId, replyMessageId: stored.id, replyStatus };
}

/** A team member answers; the conversation becomes human-owned. */
export async function humanReply(db: Queryable, organizationId: string, conversationId: string, userId: string, text: string) {
  const clean = sanitizeText(text, 8000).trim();
  if (!clean) throw new Error("Empty message");
  const res = await db.query<{ channel_type: ChannelType }>(
    "update public.conversations set status = 'human', assigned_to = coalesce(assigned_to, $3) where id = $1 and organization_id = $2 and status <> 'closed' returning channel_type",
    [conversationId, organizationId, userId],
  );
  if (!res.rowCount) throw new NotFoundError("Open conversation");
  const external = EXTERNAL_CHANNELS.has(res.rows[0]!.channel_type);
  // Web visitors poll the thread; WhatsApp/email replies are delivered by the worker.
  const msg = await appendMessage(db, { organizationId, conversationId, role: "human_agent", content: clean, authorId: userId, deliveryStatus: external ? "pending" : null });
  if (external) await enqueueDelivery(db, organizationId, msg.id);
  return msg;
}

export async function enqueueDelivery(db: Queryable, organizationId: string, messageId: number) {
  await enqueueJob(db, { type: "channel.deliver", organizationId, payload: { messageId }, dedupeKey: `deliver:${messageId}`, maxAttempts: 5 });
}

/** A person approves (optionally edits) an AI draft; it is then delivered. */
export async function sendDraft(db: Queryable, organizationId: string, messageId: number, userId: string, editedText?: string | null) {
  const text = editedText != null ? sanitizeText(editedText, 8000).trim() : null;
  if (editedText != null && !text) throw new Error("Empty message");
  const { rows } = await db.query<{ conversation_id: string }>(
    `update public.messages set status = 'sent', content = coalesce($4, content), author_id = $3, delivery_status = 'pending', error = null
     where id = $1 and organization_id = $2 and status = 'draft' returning conversation_id`,
    [messageId, organizationId, userId, text],
  );
  if (!rows[0]) throw new NotFoundError("Draft");
  await db.query("update public.conversations set assigned_to = coalesce(assigned_to, $3) where id = $1 and organization_id = $2", [rows[0].conversation_id, organizationId, userId]);
  await enqueueDelivery(db, organizationId, messageId);
  return rows[0].conversation_id;
}

export async function discardDraft(db: Queryable, organizationId: string, messageId: number) {
  const { rows } = await db.query<{ conversation_id: string }>(
    "update public.messages set status = 'failed', delivery_status = 'not_sent', error = 'Draft discarded' where id = $1 and organization_id = $2 and status = 'draft' returning conversation_id",
    [messageId, organizationId],
  );
  if (!rows[0]) throw new NotFoundError("Draft");
  return rows[0].conversation_id;
}

export async function setConversationStatus(db: Queryable, organizationId: string, conversationId: string, status: ConversationRow["status"]) {
  const res = await db.query("update public.conversations set status = $3 where id = $1 and organization_id = $2", [conversationId, organizationId, status]);
  if (!res.rowCount) throw new NotFoundError("Conversation");
}

/** Messages visible to the end customer (no internal notes, no metrics). */
export async function publicThread(db: Queryable, organizationId: string, conversationId: string, visitorId: string, channelId: string) {
  const { rows: conv } = await db.query<{ status: string }>(
    "select status from public.conversations where id = $1 and organization_id = $2 and visitor_id = $3 and channel_id = $4",
    [conversationId, organizationId, visitorId, channelId],
  );
  if (!conv[0]) throw new NotFoundError("Conversation");
  const { rows } = await db.query<{ id: number; role: string; content: string; created_at: string }>(
    "select id, role, content, created_at from public.messages where conversation_id = $1 and organization_id = $2 and role <> 'system' and status <> 'draft' order by id",
    [conversationId, organizationId],
  );
  return { status: conv[0].status, messages: rows.map((m) => ({ id: m.id, role: m.role === "user" ? "user" : "agent", human: m.role === "human_agent", content: m.content, at: m.created_at })) };
}
