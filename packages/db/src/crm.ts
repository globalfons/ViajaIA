import { LAWFUL_BASES, LEAD_STAGES, type CrmStore, type LeadInput, type LeadStage } from "@dtn/core";
import { assertOrgActive, NotFoundError } from "./agents";
import type { Queryable } from "./pool";

/** Internal CRM (Postgres). Every query is scoped by organization_id. */

const clean = (v: string | null | undefined, max = 200) => (v ? v.trim().slice(0, max) || null : null);

export function pgCrmStore(db: Queryable): CrmStore {
  return {
    async upsertLead(organizationId, input) {
      const email = clean(input.email, 320)?.toLowerCase() ?? null;
      const phone = clean(input.phone, 40);
      let contactId: string | null = null;
      if (email || phone || input.name) {
        const found = await db.query<{ id: string }>(
          `select id from public.contacts where organization_id = $1 and ((($2::text) is not null and lower(email) = $2) or (($3::text) is not null and phone = $3)) limit 1`,
          [organizationId, email, phone],
        );
        if (found.rows[0]) {
          contactId = found.rows[0].id;
          await db.query(
            "update public.contacts set name = coalesce($3, name), email = coalesce($4, email), phone = coalesce($5, phone), company = coalesce($6, company) where id = $1 and organization_id = $2",
            [contactId, organizationId, clean(input.name), email, phone, clean(input.company)],
          );
        } else {
          const { rows } = await db.query<{ id: string }>(
            "insert into public.contacts (organization_id, name, email, phone, company, source, consent) values ($1, $2, $3, $4, $5, $6, $7) returning id",
            [organizationId, clean(input.name), email, phone, clean(input.company), input.source, { lawful_basis: input.lawfulBasis, marketing: input.marketingConsent === true }],
          );
          contactId = rows[0]!.id;
        }
      }

      const existing = input.conversationId
        ? await db.query<{ id: string }>("select id from public.leads where organization_id = $1 and conversation_id = $2", [organizationId, input.conversationId])
        : { rows: [] as { id: string }[] };
      const title = clean(input.title) ?? clean(input.name) ?? email ?? (input.company ? clean(input.company) : null) ?? "Lead sin identificar";
      if (existing.rows[0]) {
        const leadId = existing.rows[0].id;
        await db.query(
          `update public.leads set contact_id = coalesce($3, contact_id), score = coalesce($4, score),
             stage = case when $5::text is not null and stage not in ('WON', 'LOST') then $5 else stage end,
             qualification = qualification || $6::jsonb,
             title = case when title = 'Lead sin identificar' or title like 'Visitante %' then $7 else title end,
             marketing_consent = marketing_consent or $8, consent_at = case when $8 then now() else consent_at end
           where id = $1 and organization_id = $2`,
          [leadId, organizationId, contactId, input.score ?? null, input.stage ?? null, JSON.stringify(input.qualification ?? {}), title, input.marketingConsent === true],
        );
        if (input.note) await this.addNote(organizationId, leadId, input.note, "agent");
        if (contactId && input.conversationId) await db.query("update public.conversations set contact_id = $3 where id = $1 and organization_id = $2", [input.conversationId, organizationId, contactId]);
        return { leadId, contactId, created: false };
      }
      const { rows } = await db.query<{ id: string }>(
        `insert into public.leads (organization_id, contact_id, conversation_id, title, stage, score, value, source, qualification, lawful_basis, marketing_consent, consent_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, case when $11 then now() end) returning id`,
        [organizationId, contactId, input.conversationId ?? null, title, input.stage ?? "NEW", input.score ?? null, input.value ?? null, input.source, JSON.stringify(input.qualification ?? {}), input.lawfulBasis, input.marketingConsent === true],
      );
      const leadId = rows[0]!.id;
      await db.query("insert into public.activities (organization_id, lead_id, contact_id, type, content) values ($1, $2, $3, 'system', $4)", [
        organizationId,
        leadId,
        contactId,
        input.source === "manual" ? "Lead creado manualmente" : input.conversationId ? "Lead registrado por el agente de IA desde una conversación" : "Lead creado",
      ]);
      if (input.note) await this.addNote(organizationId, leadId, input.note, input.source === "agent" ? "agent" : "note");
      if (contactId && input.conversationId) await db.query("update public.conversations set contact_id = $3 where id = $1 and organization_id = $2", [input.conversationId, organizationId, contactId]);
      return { leadId, contactId, created: true };
    },
    async addNote(organizationId, leadId, content, type = "note") {
      await db.query("insert into public.activities (organization_id, lead_id, type, content) values ($1, $2, $3, $4)", [organizationId, leadId, type, content.slice(0, 4000)]);
    },
    async createTask(organizationId, input) {
      const { rows } = await db.query<{ id: string }>(
        "insert into public.tasks (organization_id, lead_id, title, due_at, source) values ($1, $2, $3, $4, $5) returning id",
        [organizationId, input.leadId ?? null, input.title.slice(0, 300), input.dueAt ?? null, input.source],
      );
      return { taskId: rows[0]!.id };
    },
    async findLeadByConversation(organizationId, conversationId) {
      const { rows } = await db.query<{ id: string }>("select id from public.leads where organization_id = $1 and conversation_id = $2", [organizationId, conversationId]);
      return rows[0]?.id ?? null;
    },
  };
}

// ---------------------------------------------------------------------------
// Services used by the UI and API
// ---------------------------------------------------------------------------

export class CrmError extends Error {
  readonly status = 400;
}

export async function createLeadManually(db: Queryable, organizationId: string, input: Omit<LeadInput, "source"> & { value?: number | null }, userId?: string | null) {
  await assertOrgActive(db, organizationId);
  if (!(LAWFUL_BASES as readonly string[]).includes(input.lawfulBasis)) throw new CrmError("A lawful basis is required (GDPR)");
  if (!input.name && !input.email && !input.phone && !input.company && !input.title) throw new CrmError("Provide at least a name, email, phone, company or title");
  const r = await pgCrmStore(db).upsertLead(organizationId, { ...input, source: "manual" });
  if (userId) await db.query("update public.leads set owner_id = $3 where id = $1 and organization_id = $2 and owner_id is null", [r.leadId, organizationId, userId]);
  return r;
}

export async function moveLeadStage(db: Queryable, organizationId: string, leadId: string, stage: LeadStage, opts: { userId?: string | null; lostReason?: string | null } = {}) {
  if (!(LEAD_STAGES as readonly string[]).includes(stage)) throw new CrmError("Invalid stage");
  const { rows } = await db.query<{ old: string }>(
    `update public.leads l set stage = $3, lost_reason = case when $3 = 'LOST' then $4 else null end
     from (select stage as old from public.leads where id = $1 and organization_id = $2 for update) prev
     where l.id = $1 and l.organization_id = $2 returning prev.old`,
    [leadId, organizationId, stage, opts.lostReason ?? null],
  );
  if (!rows[0]) throw new NotFoundError("Lead");
  if (rows[0].old !== stage) {
    await db.query("insert into public.activities (organization_id, lead_id, type, content, author_id) values ($1, $2, 'stage_change', $3, $4)", [
      organizationId,
      leadId,
      `${rows[0].old} → ${stage}${stage === "LOST" && opts.lostReason ? ` (${opts.lostReason})` : ""}`,
      opts.userId ?? null,
    ]);
    // Keep the linked opportunity in sync with terminal stages.
    if (stage === "WON" || stage === "LOST") {
      await db.query("update public.opportunities set status = $3 where lead_id = $1 and organization_id = $2 and status = 'open'", [leadId, organizationId, stage === "WON" ? "won" : "lost"]);
    }
  }
}

export async function pipelineSummary(db: Queryable, organizationId: string) {
  const { rows } = await db.query<{ stage: LeadStage; n: number; value: string | null }>(
    "select stage, count(*)::int n, sum(value) as value from public.leads where organization_id = $1 group by stage",
    [organizationId],
  );
  return Object.fromEntries(LEAD_STAGES.map((s) => {
    const r = rows.find((x) => x.stage === s);
    return [s, { count: r?.n ?? 0, value: Number(r?.value ?? 0) }];
  })) as Record<LeadStage, { count: number; value: number }>;
}
