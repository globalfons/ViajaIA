"use server";

import { limitMessage } from "@/lib/limit-message";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { LimitExceededError, type GraphIssue } from "@dtn/core";
import {
  cancelWorkflowRun,
  createWorkflow,
  decideApproval,
  NotFoundError,
  OrganizationSuspendedError,
  publishWorkflow,
  resumeAgentRun,
  saveWorkflowVersion,
  startWorkflowRun,
  WorkflowValidationError,
} from "@dtn/db";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/session";

const uuid = z.string().uuid();

function message(e: unknown): string {
  if (e instanceof WorkflowValidationError) return e.issues.map((i) => i.message).join(" · ");
  if (e instanceof LimitExceededError) return limitMessage(e);
  if (e instanceof OrganizationSuspendedError) return "La organización está suspendida.";
  if (e instanceof NotFoundError) return "No encontrado o ya no está pendiente.";
  return "Error inesperado.";
}

export async function createWorkflowAction(form: FormData) {
  const s = await requireOrg("workflows.write");
  const name = z.string().trim().min(1).max(120).safeParse(form.get("name"));
  if (!name.success) redirect("/workflows?error=Nombre%20no%20v%C3%A1lido");
  let graph: unknown;
  let templateKey: string | null = null;
  const template = uuid.safeParse(form.get("template"));
  if (template.success) {
    const { createSupabaseServerClient } = await import("@/lib/supabase/server");
    const supabase = await createSupabaseServerClient();
    // RLS: platform-wide or this org's templates only.
    const { data } = await supabase.from("templates").select("config").eq("id", template.data).eq("kind", "workflow").maybeSingle();
    if (!data) redirect("/workflows?error=Plantilla%20no%20disponible");
    graph = data.config;
    templateKey = `custom:${template.data}`;
  }
  const wf = await createWorkflow(db(), s.org.id, { name: name.data, description: String(form.get("description") ?? "").slice(0, 1000), graph, templateKey }, s.userId);
  revalidatePath("/workflows");
  redirect(`/workflows/${wf.id}`);
}

export interface SaveWorkflowResult {
  version?: number;
  issues?: GraphIssue[];
  error?: string;
}

export async function saveWorkflowAction(workflowId: string, graph: unknown, meta: { name?: string; note?: string }): Promise<SaveWorkflowResult> {
  const s = await requireOrg("workflows.write");
  const id = uuid.safeParse(workflowId);
  if (!id.success) return { error: "Workflow no válido" };
  if (JSON.stringify(graph).length > 1_000_000) return { error: "El workflow es demasiado grande" };
  try {
    const { version, issues } = await saveWorkflowVersion(db(), s.org.id, id.data, graph, {
      userId: s.userId,
      name: meta.name?.slice(0, 120) || undefined,
      note: meta.note?.slice(0, 500),
    });
    revalidatePath(`/workflows/${id.data}`);
    return { version, issues };
  } catch (e) {
    return { error: message(e) };
  }
}

export async function publishWorkflowAction(workflowId: string): Promise<SaveWorkflowResult> {
  const s = await requireOrg("workflows.write");
  try {
    const wf = await publishWorkflow(db(), s.org.id, uuid.parse(workflowId));
    revalidatePath(`/workflows/${workflowId}`);
    revalidatePath("/workflows");
    return { version: wf.published_version ?? undefined };
  } catch (e) {
    return { error: message(e) };
  }
}

export async function runWorkflowAction(workflowId: string, input: unknown, useDraft: boolean): Promise<{ runId?: string; error?: string }> {
  const s = await requireOrg("workflows.run");
  const parsed = z.record(z.string(), z.unknown()).safeParse(input);
  if (!parsed.success) return { error: "La entrada debe ser un objeto JSON" };
  try {
    const { runId } = await startWorkflowRun(db(), s.org.id, uuid.parse(workflowId), parsed.data, { trigger: "manual", userId: s.userId, allowDraft: useDraft });
    return { runId };
  } catch (e) {
    return { error: message(e) };
  }
}

export async function decideApprovalAction(form: FormData) {
  const s = await requireOrg("approvals.decide");
  const id = uuid.parse(form.get("id"));
  const kind = form.get("kind") === "agent_run" ? "agent_run" : "workflow";
  const approved = form.get("decision") === "approve";
  const note = String(form.get("note") ?? "").slice(0, 500) || undefined;
  let error: string | null = null;
  try {
    if (kind === "workflow") await decideApproval(db(), s.org.id, id, { approved, userId: s.userId, note });
    else await resumeAgentRun({ db: db(), organizationId: s.org.id, runId: id, approved, note, userId: s.userId });
  } catch (e) {
    error = message(e);
  }
  revalidatePath("/automations");
  redirect(`/automations?${error ? `error=${encodeURIComponent(error)}` : `ok=${approved ? "approved" : "rejected"}`}`);
}

export async function cancelRunAction(form: FormData) {
  const s = await requireOrg("workflows.run");
  const id = uuid.parse(form.get("runId"));
  try {
    await cancelWorkflowRun(db(), s.org.id, id);
  } catch {
    redirect(`/automations/runs/${id}?error=No%20se%20puede%20cancelar`);
  }
  redirect(`/automations/runs/${id}?ok=cancelled`);
}

/** Saves the latest version as a reusable template. Agent references are cleared (they belong to this client). */
export async function saveWorkflowAsTemplateAction(workflowId: string, name: string, scope: "org" | "platform"): Promise<{ error?: string; ok?: boolean }> {
  const s = await requireOrg("workflows.write");
  const id = uuid.safeParse(workflowId);
  const n = z.string().trim().min(1).max(120).safeParse(name);
  if (!id.success || !n.success) return { error: "Datos no válidos" };
  const { getWorkflow, getWorkflowGraph } = await import("@dtn/db");
  const wf = await getWorkflow(db(), s.org.id, id.data);
  const graph = await getWorkflowGraph(db(), s.org.id, wf.id, wf.latest_version);
  const portable = {
    ...graph,
    nodes: graph.nodes.map((node) => (node.type === "agent" ? { ...node, data: { ...node.data, agentId: "" } } : node)),
  };
  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("templates").insert({
    organization_id: scope === "platform" && s.isPlatformAdmin ? null : s.org.id,
    kind: "workflow",
    name: n.data,
    description: wf.description,
    category: "custom",
    config: portable,
    source_id: wf.id,
    created_by: s.userId,
  });
  return error ? { error: "No se pudo guardar la plantilla" } : { ok: true };
}
