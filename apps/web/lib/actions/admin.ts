"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { limitsSchema } from "@dtn/core/billing/limits";
import { requirePlatformAdmin } from "@/lib/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordAudit } from "@/lib/audit";

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, "slug inválido");

const back = (path: string, params: Record<string, string>) => `${path}?${new URLSearchParams(params).toString()}`;

/** Platform admin: creates a client organization (+ optional invitation for its contact). */
export async function createClientOrganization(form: FormData) {
  const s = await requirePlatformAdmin();
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(200),
      slug,
      plan: z.string().regex(/^[A-Z][A-Z0-9_]{1,31}$/),
      contactEmail: z.union([z.literal(""), z.string().trim().toLowerCase().email()]),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) redirect(back("/clients", { error: parsed.error.issues[0]?.message ?? "Datos no válidos" }));

  const supabase = await createSupabaseServerClient();
  const { data: org, error } = await supabase
    .rpc("create_organization", { p_name: parsed.data.name, p_slug: parsed.data.slug, p_plan_code: parsed.data.plan })
    .single<{ id: string }>();
  if (error || !org) {
    redirect(back("/clients", { error: error?.code === "23505" ? "Ese slug ya existe" : "No se pudo crear el cliente" }));
  }

  if (parsed.data.contactEmail) {
    await supabase
      .from("invitations")
      .insert({ organization_id: org.id, email: parsed.data.contactEmail, role: "admin", invited_by: s.userId });
    await sendAuthInvite(parsed.data.contactEmail);
  }
  revalidatePath("/clients");
  redirect(`/clients/${org.id}?ok=created`);
}

/** Sends Supabase's invitation email when the user does not exist yet. */
async function sendAuthInvite(email: string) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  const admin = createSupabaseAdminClient();
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  // Fails harmlessly if the user already exists: they accept on next login.
  await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${appUrl}/auth/callback` }).catch(() => undefined);
}

export async function setOrganizationStatus(form: FormData) {
  const s = await requirePlatformAdmin();
  const parsed = z
    .object({
      organizationId: z.string().uuid(),
      status: z.enum(["active", "suspended"]),
      reason: z.string().trim().max(500).optional(),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) redirect(back("/clients", { error: "Datos no válidos" }));
  const { organizationId, status, reason } = parsed.data;
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({ status, suspended_reason: status === "suspended" ? reason || null : null })
    .eq("id", organizationId);
  if (error) redirect(back(`/clients/${organizationId}`, { error: "No se pudo actualizar" }));
  await recordAudit({
    organizationId,
    actorId: s.userId,
    actorType: "platform_admin",
    action: status === "suspended" ? "organization.suspend" : "organization.activate",
    targetType: "organizations",
    targetId: organizationId,
    metadata: { reason: reason ?? null },
  });
  revalidatePath(`/clients/${organizationId}`);
  redirect(back(`/clients/${organizationId}`, { ok: status }));
}

export async function setOrganizationPlanAndLimits(form: FormData) {
  const s = await requirePlatformAdmin();
  const organizationId = z.string().uuid().parse(form.get("organizationId"));
  const plan = z.string().regex(/^[A-Z][A-Z0-9_]{1,31}$/).safeParse(form.get("plan"));
  let limits: unknown;
  try {
    limits = JSON.parse(String(form.get("limits") || "{}"));
  } catch {
    redirect(back(`/clients/${organizationId}`, { error: "Los límites deben ser JSON válido" }));
  }
  const parsedLimits = limitsSchema.safeParse(limits);
  if (!plan.success || !parsedLimits.success) {
    redirect(back(`/clients/${organizationId}`, { error: "Plan o límites no válidos" }));
  }
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({ plan_code: plan.data, limits: parsedLimits.data, white_label_enabled: form.get("whiteLabel") === "on" })
    .eq("id", organizationId);
  if (error) redirect(back(`/clients/${organizationId}`, { error: "No se pudo actualizar" }));
  await recordAudit({
    organizationId,
    actorId: s.userId,
    actorType: "platform_admin",
    action: "organization.plan_limits.update",
    targetType: "organizations",
    targetId: organizationId,
    metadata: { plan: plan.data, limits: parsedLimits.data },
  });
  revalidatePath(`/clients/${organizationId}`);
  redirect(back(`/clients/${organizationId}`, { ok: "saved" }));
}

export async function upsertPlan(form: FormData) {
  const s = await requirePlatformAdmin();
  const parsed = z
    .object({
      code: z.string().regex(/^[A-Z][A-Z0-9_]{1,31}$/),
      name: z.string().trim().min(1).max(80),
      description: z.string().trim().max(500).optional(),
      stripe_price_id: z.union([z.literal(""), z.string().regex(/^price_[A-Za-z0-9]+$/)]),
      limits: z.string(),
      active: z.string().optional(),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) redirect(back("/admin", { error: "Datos de plan no válidos" }));
  let limits: unknown;
  try {
    limits = JSON.parse(parsed.data.limits || "{}");
  } catch {
    redirect(back("/admin", { error: "Los límites deben ser JSON válido" }));
  }
  const parsedLimits = limitsSchema.safeParse(limits);
  if (!parsedLimits.success) redirect(back("/admin", { error: "Límites no válidos" }));

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("plans").upsert({
    code: parsed.data.code,
    name: parsed.data.name,
    description: parsed.data.description || null,
    stripe_price_id: parsed.data.stripe_price_id || null,
    limits: parsedLimits.data,
    active: parsed.data.active === "on",
  });
  if (error) redirect(back("/admin", { error: "No se pudo guardar el plan" }));
  await recordAudit({
    organizationId: null,
    actorId: s.userId,
    actorType: "platform_admin",
    action: "plan.upsert",
    targetType: "plans",
    targetId: parsed.data.code,
  });
  revalidatePath("/admin");
  redirect(back("/admin", { ok: "plan" }));
}

export async function updatePlatformSettings(form: FormData) {
  const s = await requirePlatformAdmin();
  const admin = createSupabaseAdminClient();
  const allow = form.get("allowSelfSignup") === "on";
  const { error } = await admin.from("platform_settings").update({ allow_self_signup: allow }).eq("id", true);
  if (error) redirect(back("/admin", { error: "No se pudo guardar" }));
  await recordAudit({
    organizationId: null,
    actorId: s.userId,
    actorType: "platform_admin",
    action: "platform_settings.update",
    metadata: { allow_self_signup: allow },
  });
  revalidatePath("/admin");
  redirect(back("/admin", { ok: "settings" }));
}
