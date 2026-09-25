"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createChannel, humanReply, NotFoundError, setConversationStatus } from "@dtn/db";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const uuid = z.string().uuid();
const back = (id: string, q: string) => `/conversations/${id}?${q}`;

export async function replyAction(form: FormData) {
  const s = await requireOrg("conversations.reply");
  const id = uuid.parse(form.get("conversationId"));
  const text = z.string().trim().min(1).max(8000).safeParse(form.get("text"));
  if (!text.success) redirect(back(id, "error=Mensaje%20vac%C3%ADo"));
  try {
    await humanReply(db(), s.org.id, id, s.userId, text.data);
  } catch (e) {
    redirect(back(id, `error=${encodeURIComponent(e instanceof NotFoundError ? "La conversación está cerrada" : "No se pudo enviar")}`));
  }
  revalidatePath(`/conversations/${id}`);
  redirect(back(id, "ok=sent"));
}

export async function conversationStatusAction(form: FormData) {
  const s = await requireOrg("conversations.reply");
  const id = uuid.parse(form.get("conversationId"));
  const status = z.enum(["open", "escalated", "human", "closed"]).parse(form.get("status"));
  await setConversationStatus(db(), s.org.id, id, status);
  revalidatePath(`/conversations/${id}`);
  redirect(back(id, `ok=${status}`));
}

export async function triageAction(form: FormData) {
  const s = await requireOrg("conversations.reply");
  const id = uuid.parse(form.get("conversationId"));
  const priority = z.enum(["low", "normal", "high", "urgent"]).parse(form.get("priority"));
  const assign = form.get("assign") === "me";
  const supabase = await createSupabaseServerClient();
  // RLS + column grants: members may only change triage fields.
  await supabase
    .from("conversations")
    .update({ priority, ...(assign ? { assigned_to: s.userId } : {}) })
    .eq("id", id)
    .eq("organization_id", s.org.id);
  revalidatePath(`/conversations/${id}`);
  redirect(back(id, "ok=saved"));
}

export async function createWebChannelAction(form: FormData) {
  const s = await requireOrg("integrations.manage");
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(120),
      agentId: uuid,
      origins: z.string().max(2000).optional(),
      welcome: z.string().trim().max(500).optional(),
    })
    .safeParse({ name: form.get("name"), agentId: form.get("agentId"), origins: form.get("origins") ?? undefined, welcome: form.get("welcome") ?? undefined });
  if (!parsed.success) redirect("/integrations?error=Datos%20no%20v%C3%A1lidos");
  let origins: string[];
  try {
    origins = (parsed.data.origins ?? "")
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((o) => {
        const u = new URL(o);
        if (u.protocol !== "https:" && u.hostname !== "localhost") throw new Error("https");
        return u.origin;
      });
  } catch {
    redirect("/integrations?error=Los%20or%C3%ADgenes%20deben%20ser%20URLs%20https");
  }
  try {
    await createChannel(db(), s.org.id, { type: "web", name: parsed.data.name, agentId: parsed.data.agentId, allowedOrigins: origins, config: parsed.data.welcome ? { welcome: parsed.data.welcome } : {} }, s.userId);
  } catch {
    redirect("/integrations?error=No%20se%20pudo%20crear%20el%20canal");
  }
  revalidatePath("/integrations");
  redirect("/integrations?ok=channel");
}

export async function channelStatusAction(form: FormData) {
  const s = await requireOrg("integrations.manage");
  const id = uuid.parse(form.get("channelId"));
  const status = z.enum(["active", "paused"]).parse(form.get("status"));
  const supabase = await createSupabaseServerClient();
  await supabase.from("channels").update({ status }).eq("id", id).eq("organization_id", s.org.id);
  revalidatePath("/integrations");
  redirect("/integrations?ok=saved");
}
