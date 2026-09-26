"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  ChannelError,
  createEmailChannel,
  createWhatsAppChannel,
  discardDraft,
  NotFoundError,
  providerOptionsFromEnv,
  retryDelivery,
  sendDraft,
  setEmailAutoSend,
} from "@dtn/db";
import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/session";

const uuid = z.string().uuid();
const secretName = z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/, "Nombre de credencial no válido");
const fail = (msg: string) => redirect(`/integrations?error=${encodeURIComponent(msg)}`);

const CHANNEL_ERRORS: Record<string, string> = {
  "Save the credential": "Guarda primero el token en Credenciales.",
  "Meta rejected": "Meta rechazó el número o el token. Revisa el phone_number_id y los permisos del token.",
  "Could not reach": "No se pudo contactar con la API de WhatsApp. Inténtalo de nuevo.",
  "already connected": "Ese número de WhatsApp ya está conectado a otra cuenta.",
  "Invalid sender": "La dirección del remitente no es válida.",
};
const channelErrorText = (e: unknown) =>
  e instanceof ChannelError ? (Object.entries(CHANNEL_ERRORS).find(([k]) => e.message.includes(k))?.[1] ?? "Datos no válidos") : "No se pudo crear el canal";

export async function createWhatsAppChannelAction(form: FormData) {
  const s = await requireOrg("integrations.manage");
  if (!process.env.WHATSAPP_APP_SECRET || !process.env.WHATSAPP_VERIFY_TOKEN) fail("La agencia aún no ha configurado la app de Meta (WHATSAPP_APP_SECRET y WHATSAPP_VERIFY_TOKEN).");
  const parsed = z
    .object({ name: z.string().trim().min(1).max(120), agentId: uuid, phoneNumberId: z.string().trim().regex(/^\d{5,30}$/), tokenSecret: secretName })
    .safeParse({ name: form.get("name"), agentId: form.get("agentId"), phoneNumberId: form.get("phoneNumberId"), tokenSecret: form.get("tokenSecret") });
  if (!parsed.success) fail("Revisa los datos: el phone_number_id es numérico y la credencial debe existir.");
  let channelId: string;
  try {
    channelId = (await createWhatsAppChannel(db(), s.org.id, parsed.data!, s.userId, providerOptionsFromEnv())).id;
  } catch (e) {
    fail(channelErrorText(e));
  }
  await recordAudit({ organizationId: s.org.id, actorId: s.userId, action: "channel.whatsapp.connected", targetType: "channel", targetId: channelId!, metadata: { phoneNumberId: parsed.data!.phoneNumberId } });
  revalidatePath("/integrations");
  redirect("/integrations?ok=channel");
}

export interface EmailChannelState {
  error?: string;
  token?: string;
  webhookPath?: string;
}

/** Returns the inbound token once (it is stored hashed and cannot be shown again). */
export async function createEmailChannelAction(_prev: EmailChannelState, form: FormData): Promise<EmailChannelState> {
  const s = await requireOrg("integrations.manage");
  const parsed = z
    .object({ name: z.string().trim().min(1).max(120), agentId: uuid, fromAddress: z.string().trim().min(3).max(320), apiKeySecret: secretName, autoSend: z.boolean() })
    .safeParse({ name: form.get("name"), agentId: form.get("agentId"), fromAddress: form.get("fromAddress"), apiKeySecret: form.get("apiKeySecret"), autoSend: form.get("autoSend") === "on" });
  if (!parsed.success) return { error: "Revisa los datos del canal." };
  try {
    const { channel, inboundToken } = await createEmailChannel(db(), s.org.id, parsed.data, s.userId);
    await recordAudit({ organizationId: s.org.id, actorId: s.userId, action: "channel.email.created", targetType: "channel", targetId: channel.id, metadata: { autoSend: parsed.data.autoSend } });
    revalidatePath("/integrations");
    return { token: inboundToken, webhookPath: `/api/webhooks/email/${channel.public_key}` };
  } catch (e) {
    return { error: channelErrorText(e) };
  }
}

export async function emailAutoSendAction(form: FormData) {
  const s = await requireOrg("integrations.manage");
  const id = uuid.parse(form.get("channelId"));
  const autoSend = form.get("autoSend") === "true";
  try {
    await setEmailAutoSend(db(), s.org.id, id, autoSend);
  } catch {
    fail("Canal no encontrado");
  }
  await recordAudit({ organizationId: s.org.id, actorId: s.userId, action: autoSend ? "channel.email.autosend_enabled" : "channel.email.autosend_disabled", targetType: "channel", targetId: id });
  revalidatePath("/integrations");
  redirect("/integrations?ok=saved");
}

const backTo = (conversationId: string, q: string) => redirect(`/conversations/${conversationId}?${q}`);

export async function sendDraftAction(form: FormData) {
  const s = await requireOrg("conversations.reply");
  const conversationId = uuid.parse(form.get("conversationId"));
  const messageId = z.coerce.number().int().positive().parse(form.get("messageId"));
  const text = z.string().trim().min(1).max(8000).safeParse(form.get("text"));
  if (!text.success) backTo(conversationId, "error=Mensaje%20vac%C3%ADo");
  try {
    await sendDraft(db(), s.org.id, messageId, s.userId, text.data);
  } catch (e) {
    backTo(conversationId, `error=${encodeURIComponent(e instanceof NotFoundError ? "El borrador ya no está disponible" : "No se pudo enviar")}`);
  }
  revalidatePath(`/conversations/${conversationId}`);
  backTo(conversationId, "ok=sent");
}

export async function discardDraftAction(form: FormData) {
  const s = await requireOrg("conversations.reply");
  const conversationId = uuid.parse(form.get("conversationId"));
  const messageId = z.coerce.number().int().positive().parse(form.get("messageId"));
  try {
    await discardDraft(db(), s.org.id, messageId);
  } catch {
    backTo(conversationId, "error=El%20borrador%20ya%20no%20est%C3%A1%20disponible");
  }
  revalidatePath(`/conversations/${conversationId}`);
  backTo(conversationId, "ok=saved");
}

export async function retryDeliveryAction(form: FormData) {
  const s = await requireOrg("conversations.reply");
  const conversationId = uuid.parse(form.get("conversationId"));
  const messageId = z.coerce.number().int().positive().parse(form.get("messageId"));
  try {
    await retryDelivery(db(), s.org.id, messageId);
  } catch {
    backTo(conversationId, "error=No%20se%20puede%20reintentar");
  }
  revalidatePath(`/conversations/${conversationId}`);
  backTo(conversationId, "ok=sent");
}
