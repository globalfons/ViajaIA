"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { agentConfigSchema, getAgentTemplate, LimitExceededError, type AgentRunResult, type ChatMessage } from "@dtn/core";
import { archiveAgent, createAgent, getAgent, NotFoundError, OrganizationSuspendedError, resumeAgentRun, runAgent, updateAgent } from "@dtn/db";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const uuid = z.string().uuid();

function friendlyError(e: unknown): string {
  if (e instanceof LimitExceededError) return `Has alcanzado el límite de tu plan (${e.key}: ${e.limit}).`;
  if (e instanceof OrganizationSuspendedError) return "La organización está suspendida.";
  if (e instanceof NotFoundError) return "No encontrado.";
  if (e instanceof z.ZodError) return `Configuración no válida: ${e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`;
  return "Ha ocurrido un error inesperado.";
}

export async function createAgentAction(form: FormData) {
  const s = await requireOrg("agents.write");
  const parsed = z
    .object({ name: z.string().trim().min(1).max(120), template: z.string().max(80), model: z.string().min(3).max(200) })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) redirect(`/agents/new?error=${encodeURIComponent("Nombre, plantilla o modelo no válidos")}`);
  const { name, template, model } = parsed.data;

  let base: Record<string, unknown> = {};
  let templateKey: string | null = null;
  if (template.startsWith("builtin:")) {
    const t = getAgentTemplate(template.slice(8));
    if (!t) redirect("/agents/new?error=Plantilla%20desconocida");
    base = t.config;
    templateKey = t.key;
  } else if (template.startsWith("custom:")) {
    const id = uuid.safeParse(template.slice(7));
    const supabase = await createSupabaseServerClient();
    // RLS: only platform-wide templates or this org's own.
    const { data } = id.success
      ? await supabase.from("templates").select("config").eq("id", id.data).eq("kind", "agent").maybeSingle()
      : { data: null };
    if (!data) redirect("/agents/new?error=Plantilla%20no%20disponible");
    base = data.config as Record<string, unknown>;
    templateKey = template;
  }

  let agentId: string;
  try {
    const agent = await createAgent(db(), s.org.id, { name, templateKey, config: { ...base, model } }, s.userId);
    agentId = agent.id;
  } catch (e) {
    redirect(`/agents/new?error=${encodeURIComponent(friendlyError(e))}`);
  }
  revalidatePath("/agents");
  redirect(`/agents/${agentId}`);
}

export interface SaveState {
  ok?: boolean;
  error?: string;
  version?: number;
}

export async function saveAgentAction(_: SaveState, form: FormData): Promise<SaveState> {
  const s = await requireOrg("agents.write");
  const id = uuid.safeParse(form.get("agentId"));
  if (!id.success) return { error: "Agente no válido" };
  let raw: unknown;
  try {
    raw = JSON.parse(String(form.get("config") ?? "{}"));
  } catch {
    return { error: "JSON no válido" };
  }
  const status = z.enum(["draft", "active", "paused"]).safeParse(form.get("status"));
  const parsed = agentConfigSchema.safeParse(raw);
  if (!parsed.success) return { error: friendlyError(parsed.error) };
  try {
    const agent = await updateAgent(db(), s.org.id, id.data, {
      config: parsed.data,
      name: parsed.data.name,
      description: parsed.data.description,
      status: status.success ? status.data : undefined,
    });
    revalidatePath(`/agents/${id.data}`);
    revalidatePath("/agents");
    return { ok: true, version: agent.version };
  } catch (e) {
    return { error: friendlyError(e) };
  }
}

export async function archiveAgentAction(form: FormData) {
  const s = await requireOrg("agents.write");
  const id = uuid.parse(form.get("agentId"));
  await archiveAgent(db(), s.org.id, id);
  revalidatePath("/agents");
  redirect("/agents");
}

export async function restoreAgentVersionAction(form: FormData) {
  const s = await requireOrg("agents.write");
  const id = uuid.parse(form.get("agentId"));
  const version = z.coerce.number().int().positive().parse(form.get("version"));
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("agent_versions").select("config").eq("agent_id", id).eq("organization_id", s.org.id).eq("version", version).maybeSingle();
  if (!data) redirect(`/agents/${id}?error=Versi%C3%B3n%20no%20encontrada`);
  await updateAgent(db(), s.org.id, id, { config: data.config });
  revalidatePath(`/agents/${id}`);
  redirect(`/agents/${id}?ok=restored`);
}

export async function saveAgentAsTemplateAction(form: FormData) {
  const s = await requireOrg("agents.write");
  const id = uuid.parse(form.get("agentId"));
  const name = z.string().trim().min(1).max(120).parse(form.get("name"));
  const scope = form.get("scope") === "platform" && s.isPlatformAdmin ? "platform" : "org";
  const agent = await getAgent(db(), s.org.id, id);
  // Templates never carry a model: it is chosen when deploying for a client.
  const { model: _model, fallbackModels: _fb, knowledgeBaseIds: _kb, ...config } = agent.config;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("templates").insert({
    organization_id: scope === "platform" ? null : s.org.id,
    kind: "agent",
    name,
    description: agent.description,
    category: "custom",
    config,
    source_id: agent.id,
    created_by: s.userId,
  });
  redirect(`/agents/${id}?${error ? "error=No%20se%20pudo%20guardar%20la%20plantilla" : "ok=template"}`);
}

// ---------------------------------------------------------------------------
// Playground
// ---------------------------------------------------------------------------

export interface PlaygroundReply {
  runId?: string;
  error?: string;
  result?: Omit<AgentRunResult, "state">;
}

const historySchema = z
  .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(20_000) }))
  .max(100);

function publicResult(r: AgentRunResult): Omit<AgentRunResult, "state"> {
  const { state: _state, ...rest } = r;
  return rest;
}

export async function playgroundSendAction(agentId: string, message: string, history: ChatMessage[]): Promise<PlaygroundReply> {
  const s = await requireOrg("agents.run");
  const id = uuid.safeParse(agentId);
  const h = historySchema.safeParse(history);
  if (!id.success || !h.success || !message.trim()) return { error: "Petición no válida" };
  try {
    const { runId, result } = await runAgent({
      db: db(),
      organizationId: s.org.id,
      agentId: id.data,
      message: message.slice(0, 20_000),
      history: h.data,
      source: "playground",
      userId: s.userId,
      allowInactive: true,
    });
    return { runId, result: publicResult(result) };
  } catch (e) {
    return { error: friendlyError(e) };
  }
}

export async function decideRunAction(runId: string, approved: boolean, note?: string): Promise<PlaygroundReply> {
  const s = await requireOrg("approvals.decide");
  const id = uuid.safeParse(runId);
  if (!id.success) return { error: "Petición no válida" };
  try {
    const { result } = await resumeAgentRun({
      db: db(),
      organizationId: s.org.id,
      runId: id.data,
      approved,
      note: note?.slice(0, 500),
      userId: s.userId,
    });
    return { runId: id.data, result: publicResult(result) };
  } catch (e) {
    return { error: friendlyError(e) };
  }
}
