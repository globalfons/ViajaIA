import { z } from "zod";
import { defineTool, type ToolDefinition } from "../tools/registry";
import type { CrmStore } from "./types";

export const CRM_TOOL_NAMES = ["crm_capture_lead", "crm_add_note", "crm_create_task"] as const;

/**
 * CRM tools for agents. They only RECORD information the person provided in
 * the conversation (inbound). There is intentionally no tool to send
 * unsolicited messages.
 */
export function createCrmTools(store: CrmStore): ToolDefinition[] {
  return [
    defineTool({
      name: "crm_capture_lead",
      description:
        "Registers or updates the person you are talking to as a lead with the contact details THEY provided in this conversation, plus a qualification score (0-100). Use it when someone shows interest and shares how to contact them.",
      risk: "write",
      parameters: z.object({
        name: z.string().max(200).optional(),
        email: z.string().email().max(320).optional(),
        phone: z.string().max(40).optional(),
        company: z.string().max(200).optional(),
        need: z.string().max(1000).optional().describe("What they need, in their words"),
        score: z.number().int().min(0).max(100).optional(),
        marketing_consent: z.boolean().optional().describe("Only true if the person explicitly agreed to receive marketing"),
      }),
      async execute(args, ctx) {
        const r = await store.upsertLead(ctx.organizationId, {
          name: args.name,
          email: args.email,
          phone: args.phone,
          company: args.company,
          score: args.score ?? null,
          source: "agent",
          conversationId: ctx.conversationId ?? null,
          lawfulBasis: "inbound_request",
          marketingConsent: args.marketing_consent === true,
          qualification: args.need ? { need: args.need } : {},
          note: args.need ? `Necesidad: ${args.need}` : null,
        });
        return { lead_id: r.leadId, created: r.created };
      },
    }),
    defineTool({
      name: "crm_add_note",
      description: "Adds a note to the lead linked to this conversation (e.g. a summary of what the person asked).",
      risk: "write",
      parameters: z.object({ note: z.string().min(1).max(2000) }),
      async execute(args, ctx) {
        const leadId = ctx.conversationId ? await store.findLeadByConversation(ctx.organizationId, ctx.conversationId) : null;
        if (!leadId) return { ok: false, reason: "No lead is linked to this conversation yet; capture the lead first." };
        await store.addNote(ctx.organizationId, leadId, args.note, "agent");
        return { ok: true };
      },
    }),
    defineTool({
      name: "crm_create_task",
      description: "Creates a follow-up task for the team (e.g. 'Call back tomorrow morning').",
      risk: "write",
      parameters: z.object({ title: z.string().min(1).max(300), due_at: z.string().datetime().optional() }),
      async execute(args, ctx) {
        const leadId = ctx.conversationId ? await store.findLeadByConversation(ctx.organizationId, ctx.conversationId) : null;
        const t = await store.createTask(ctx.organizationId, { leadId, title: args.title, dueAt: args.due_at ?? null, source: "agent" });
        return { task_id: t.taskId };
      },
    }),
  ];
}
