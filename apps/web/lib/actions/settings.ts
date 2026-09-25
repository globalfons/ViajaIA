"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { brandingSchema } from "@/lib/branding";
import { requireOrg } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const back = (params: Record<string, string>) => `/settings?${new URLSearchParams(params).toString()}`;

export async function updateOrganizationProfile(form: FormData) {
  const s = await requireOrg("org.update");
  const name = z.string().trim().min(1).max(200).safeParse(form.get("name"));
  if (!name.success) redirect(back({ error: "Nombre no válido" }));
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("organizations").update({ name: name.data }).eq("id", s.org.id);
  if (error) redirect(back({ error: "No se pudo guardar" }));
  revalidatePath("/", "layout");
  redirect(back({ ok: "profile" }));
}

export async function updateBranding(form: FormData) {
  const s = await requireOrg("org.branding");
  const clean = (k: string) => {
    const v = String(form.get(k) ?? "").trim();
    return v === "" ? undefined : v;
  };
  const parsed = brandingSchema.safeParse({
    name: clean("name"),
    logo_url: clean("logo_url"),
    favicon_url: clean("favicon_url"),
    colors: { primary: clean("primary"), accent: clean("accent") },
    email_from_name: clean("email_from_name"),
    email_from_address: clean("email_from_address"),
    support_email: clean("support_email"),
  });
  if (!parsed.success) redirect(back({ error: `Branding no válido: ${parsed.error.issues[0]?.path.join(".")}` }));
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("organizations").update({ branding: parsed.data }).eq("id", s.org.id);
  if (error) redirect(back({ error: "No se pudo guardar" }));
  revalidatePath("/", "layout");
  redirect(back({ ok: "branding" }));
}

export async function inviteMember(form: FormData) {
  const s = await requireOrg("members.invite");
  const parsed = z
    .object({ email: z.string().trim().toLowerCase().email().max(320), role: z.enum(["admin", "member", "viewer"]) })
    .safeParse({ email: form.get("email"), role: form.get("role") });
  if (!parsed.success) redirect(back({ error: "Email o rol no válidos" }));
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("invitations")
    .upsert(
      { organization_id: s.org.id, email: parsed.data.email, role: parsed.data.role, invited_by: s.userId, accepted_at: null },
      { onConflict: "organization_id,email" },
    );
  if (error) redirect(back({ error: "No se pudo invitar" }));
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    await createSupabaseAdminClient()
      .auth.admin.inviteUserByEmail(parsed.data.email, { redirectTo: `${appUrl}/auth/callback` })
      .catch(() => undefined);
  }
  revalidatePath("/settings");
  redirect(back({ ok: "invited" }));
}

export async function changeMemberRole(form: FormData) {
  const s = await requireOrg("members.invite");
  const parsed = z
    .object({ userId: z.string().uuid(), role: z.enum(["owner", "admin", "member", "viewer"]) })
    .safeParse({ userId: form.get("userId"), role: form.get("role") });
  if (!parsed.success) redirect(back({ error: "Datos no válidos" }));
  const supabase = await createSupabaseServerClient();
  // RLS: only owners can grant or revoke "owner"; the DB keeps at least one owner.
  const { error, count } = await supabase
    .from("memberships")
    .update({ role: parsed.data.role }, { count: "exact" })
    .eq("organization_id", s.org.id)
    .eq("user_id", parsed.data.userId);
  if (error || count === 0) redirect(back({ error: error?.message.includes("owner") ? "Debe quedar al menos un owner" : "Sin permiso para ese cambio" }));
  revalidatePath("/settings");
  redirect(back({ ok: "role" }));
}

export async function removeMember(form: FormData) {
  const s = await requireOrg();
  const userId = z.string().uuid().safeParse(form.get("userId"));
  if (!userId.success) redirect(back({ error: "Datos no válidos" }));
  if (userId.data !== s.userId && !s.can("members.remove")) redirect(back({ error: "Sin permiso" }));
  const supabase = await createSupabaseServerClient();
  const { error, count } = await supabase
    .from("memberships")
    .delete({ count: "exact" })
    .eq("organization_id", s.org.id)
    .eq("user_id", userId.data);
  if (error || count === 0) redirect(back({ error: error?.message.includes("owner") ? "Debe quedar al menos un owner" : "Sin permiso" }));
  revalidatePath("/settings");
  redirect(userId.data === s.userId ? "/dashboard" : back({ ok: "removed" }));
}

export async function revokeInvitation(form: FormData) {
  const s = await requireOrg("members.invite");
  const id = z.string().uuid().safeParse(form.get("id"));
  if (!id.success) redirect(back({ error: "Datos no válidos" }));
  const supabase = await createSupabaseServerClient();
  await supabase.from("invitations").delete().eq("organization_id", s.org.id).eq("id", id.data);
  revalidatePath("/settings");
  redirect(back({ ok: "revoked" }));
}

export async function changePasswordAction(form: FormData) {
  await requireOrg();
  const parsed = z
    .object({ password: z.string().min(12).max(200), confirm: z.string() })
    .refine((d) => d.password === d.confirm, "no coinciden")
    .safeParse({ password: form.get("password"), confirm: form.get("confirm") });
  if (!parsed.success) redirect(back({ error: "La contraseña debe tener al menos 12 caracteres y coincidir" }));
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) redirect(back({ error: "No se pudo cambiar la contraseña" }));
  redirect(back({ ok: "password" }));
}
