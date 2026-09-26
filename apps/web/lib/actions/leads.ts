"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { LAWFUL_BASES, LEAD_STAGES } from "@dtn/core";
import { createLeadManually, CrmError, moveLeadStage, pgCrmStore } from "@dtn/db";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const uuid = z.string().uuid();
const opt = (v: FormDataEntryValue | null) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

export async function createLeadAction(form: FormData) {
  const s = await requireOrg("crm.write");
  const parsed = z
    .object({
      name: z.string().max(200).optional(),
      email: z.string().email().max(320).optional(),
      phone: z.string().max(40).optional(),
      company: z.string().max(200).optional(),
      value: z.coerce.number().min(0).max(1e9).optional(),
      lawfulBasis: z.enum(LAWFUL_BASES),
      marketingConsent: z.boolean(),
      note: z.string().max(2000).optional(),
    })
    .safeParse({
      name: opt(form.get("name")),
      email: opt(form.get("email")),
      phone: opt(form.get("phone")),
      company: opt(form.get("company")),
      value: opt(form.get("value")),
      lawfulBasis: form.get("lawfulBasis"),
      marketingConsent: form.get("marketingConsent") === "on",
      note: opt(form.get("note")),
    });
  if (!parsed.success) redirect("/leads?error=Datos%20del%20lead%20no%20v%C3%A1lidos");
  let leadId: string;
  try {
    leadId = (await createLeadManually(db(), s.org.id, parsed.data, s.userId)).leadId;
  } catch (e) {
    redirect(`/leads?error=${encodeURIComponent(e instanceof CrmError ? "Indica al menos un nombre, email, teléfono o empresa" : "No se pudo crear el lead")}`);
  }
  revalidatePath("/leads");
  redirect(`/leads/${leadId}`);
}

export async function moveStageAction(form: FormData) {
  const s = await requireOrg("crm.write");
  const id = uuid.parse(form.get("leadId"));
  const stage = z.enum(LEAD_STAGES).parse(form.get("stage"));
  await moveLeadStage(db(), s.org.id, id, stage, { userId: s.userId, lostReason: opt(form.get("lostReason")) ?? null });
  revalidatePath("/leads");
  revalidatePath(`/leads/${id}`);
  const back = form.get("back") === "board" ? "/leads" : `/leads/${id}`;
  redirect(back);
}

export async function addNoteAction(form: FormData) {
  const s = await requireOrg("crm.write");
  const id = uuid.parse(form.get("leadId"));
  const note = z.string().trim().min(1).max(4000).safeParse(form.get("note"));
  if (!note.success) redirect(`/leads/${id}?error=Nota%20vac%C3%ADa`);
  const supabase = await createSupabaseServerClient();
  // RLS insert: members of this org only.
  await supabase.from("activities").insert({ organization_id: s.org.id, lead_id: id, type: "note", content: note.data, author_id: s.userId });
  revalidatePath(`/leads/${id}`);
  redirect(`/leads/${id}`);
}

export async function createTaskAction(form: FormData) {
  const s = await requireOrg("crm.write");
  const id = uuid.parse(form.get("leadId"));
  const title = z.string().trim().min(1).max(300).safeParse(form.get("title"));
  if (!title.success) redirect(`/leads/${id}?error=T%C3%ADtulo%20vac%C3%ADo`);
  const due = opt(form.get("due"));
  await pgCrmStore(db()).createTask(s.org.id, { leadId: id, title: title.data, dueAt: due ? new Date(due).toISOString() : null, source: "manual" });
  revalidatePath(`/leads/${id}`);
  redirect(`/leads/${id}`);
}

export async function toggleTaskAction(form: FormData) {
  const s = await requireOrg("crm.write");
  const taskId = uuid.parse(form.get("taskId"));
  const leadId = uuid.parse(form.get("leadId"));
  const supabase = await createSupabaseServerClient();
  await supabase.from("tasks").update({ status: form.get("status") === "done" ? "done" : "open" }).eq("id", taskId).eq("organization_id", s.org.id);
  revalidatePath(`/leads/${leadId}`);
  redirect(`/leads/${leadId}`);
}

export async function saveOpportunityAction(form: FormData) {
  const s = await requireOrg("crm.write");
  const leadId = uuid.parse(form.get("leadId"));
  const parsed = z
    .object({ name: z.string().trim().min(1).max(200), amount: z.coerce.number().min(0).max(1e9), closeDate: z.string().date().optional() })
    .safeParse({ name: form.get("name"), amount: form.get("amount"), closeDate: opt(form.get("closeDate")) });
  if (!parsed.success) redirect(`/leads/${leadId}?error=Oportunidad%20no%20v%C3%A1lida`);
  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase.from("opportunities").select("id").eq("lead_id", leadId).eq("organization_id", s.org.id).maybeSingle();
  const row = { name: parsed.data.name, amount: parsed.data.amount, close_date: parsed.data.closeDate ?? null };
  if (existing) await supabase.from("opportunities").update(row).eq("id", existing.id).eq("organization_id", s.org.id);
  else await supabase.from("opportunities").insert({ ...row, organization_id: s.org.id, lead_id: leadId });
  await supabase.from("leads").update({ value: parsed.data.amount }).eq("id", leadId).eq("organization_id", s.org.id);
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
  redirect(`/leads/${leadId}`);
}
