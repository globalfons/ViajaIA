"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { disconnectGoogleCalendar, updateCalendarSettings } from "@dtn/db";
import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/session";

const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export async function calendarSettingsAction(form: FormData) {
  const s = await requireOrg("integrations.manage");
  const parsed = z
    .object({
      timeZone: z.string().min(3).max(64),
      start: hm,
      end: hm,
      slotMinutes: z.coerce.number().int().min(10).max(240),
      minNoticeMinutes: z.coerce.number().int().min(0).max(10080),
      days: z.array(z.coerce.number().int().min(0).max(6)).min(1),
    })
    .refine((v) => v.end > v.start)
    .safeParse({
      timeZone: form.get("timeZone"),
      start: form.get("start"),
      end: form.get("end"),
      slotMinutes: form.get("slotMinutes"),
      minNoticeMinutes: form.get("minNoticeMinutes"),
      days: form.getAll("days"),
    });
  if (!parsed.success) redirect("/integrations?error=Horario%20no%20v%C3%A1lido");
  try {
    await updateCalendarSettings(db(), s.org.id, parsed.data);
  } catch {
    redirect("/integrations?error=Conecta%20primero%20el%20calendario");
  }
  revalidatePath("/integrations");
  redirect("/integrations?ok=saved");
}

export async function disconnectCalendarAction() {
  const s = await requireOrg("integrations.manage");
  await disconnectGoogleCalendar(db(), s.org.id);
  await recordAudit({ organizationId: s.org.id, actorId: s.userId, action: "integration.google_calendar.disconnected", targetType: "integration" });
  revalidatePath("/integrations");
  redirect("/integrations?ok=calendar_disconnected");
}
