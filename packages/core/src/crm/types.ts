/**
 * CRM abstraction. The internal CRM (Postgres) implements CrmStore; external
 * CRMs (HubSpot, Pipedrive, Salesforce…) implement CrmSync to mirror records.
 */
export const LEAD_STAGES = ["NEW", "QUALIFIED", "CONTACTED", "MEETING", "PROPOSAL", "WON", "LOST"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];
export const LAWFUL_BASES = ["inbound_request", "consent", "contract", "legitimate_interest"] as const;
export type LawfulBasis = (typeof LAWFUL_BASES)[number];

export interface ContactInput {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
}

export interface LeadInput extends ContactInput {
  title?: string;
  stage?: LeadStage;
  score?: number | null;
  value?: number | null;
  source: "web" | "whatsapp" | "email" | "api" | "manual" | "agent" | "import";
  conversationId?: string | null;
  qualification?: Record<string, unknown>;
  lawfulBasis: LawfulBasis;
  marketingConsent?: boolean;
  note?: string | null;
}

export interface CrmStore {
  upsertLead(organizationId: string, input: LeadInput): Promise<{ leadId: string; contactId: string | null; created: boolean }>;
  addNote(organizationId: string, leadId: string, content: string, type?: "note" | "agent"): Promise<void>;
  createTask(organizationId: string, input: { leadId?: string | null; title: string; dueAt?: string | null; source: "agent" | "workflow" | "manual" }): Promise<{ taskId: string }>;
  findLeadByConversation(organizationId: string, conversationId: string): Promise<string | null>;
}

/** Optional mirror into an external CRM. */
export interface CrmSync {
  readonly name: string;
  upsertContact(input: ContactInput & { lifecycleStage?: string }): Promise<{ externalId: string }>;
}

/** Maps agent/template stages (Spanish structured outputs) to the pipeline. */
export function stageFromAgent(value: unknown): LeadStage | null {
  switch (String(value ?? "").toLowerCase()) {
    case "nuevo":
    case "cualificando":
      return "NEW";
    case "cualificado":
    case "handoff":
      return "QUALIFIED";
    case "no_cualificado":
      return "LOST";
    default:
      return (LEAD_STAGES as readonly string[]).includes(String(value)) ? (value as LeadStage) : null;
  }
}
