"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { deleteSecret, SECRET_NAME_RE, setSecret } from "@dtn/db";
import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { requireOrg } from "@/lib/session";

/** Write-only: values are encrypted immediately and never sent back to the browser. */
export async function setSecretAction(form: FormData) {
  const s = await requireOrg("secrets.manage");
  const parsed = z
    .object({ name: z.string().trim().toUpperCase().regex(SECRET_NAME_RE), value: z.string().min(1).max(10_000) })
    .safeParse({ name: form.get("name"), value: form.get("value") });
  if (!parsed.success) redirect("/integrations?error=Nombre%20(MAY%C3%9ASCULAS_Y_GUIONES)%20o%20valor%20no%20v%C3%A1lidos");
  try {
    await setSecret(db(), s.org.id, parsed.data.name, parsed.data.value, { userId: s.userId });
  } catch {
    redirect("/integrations?error=El%20cifrado%20de%20secretos%20no%20est%C3%A1%20configurado%20en%20el%20servidor");
  }
  await recordAudit({ organizationId: s.org.id, actorId: s.userId, action: "secret.set", targetType: "secrets", targetId: parsed.data.name });
  revalidatePath("/integrations");
  redirect("/integrations?ok=secret");
}

export async function deleteSecretAction(form: FormData) {
  const s = await requireOrg("secrets.manage");
  const name = z.string().regex(SECRET_NAME_RE).parse(form.get("name"));
  await deleteSecret(db(), s.org.id, name);
  await recordAudit({ organizationId: s.org.id, actorId: s.userId, action: "secret.delete", targetType: "secrets", targetId: name });
  revalidatePath("/integrations");
  redirect("/integrations?ok=secret_deleted");
}
