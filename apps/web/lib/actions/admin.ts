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
    .update({
      plan_code: plan.data,
      limits: parsedLimits.data,
      white_label_enabled: form.get("whiteLabel") === "on",
      limit_policy: form.get("limitPolicy") === "require_approval" ? "require_approval" : "block",
    })
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
      limits: z.string(),
      active: z.string().optional(),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) redirect(back("/admin", { tab: "settings", error: "Datos de plan no válidos" }));
  let limits: unknown;
  try {
    limits = JSON.parse(parsed.data.limits || "{}");
  } catch {
    redirect(back("/admin", { tab: "settings", error: "Los límites deben ser JSON válido" }));
  }
  const parsedLimits = limitsSchema.safeParse(limits);
  if (!parsedLimits.success) redirect(back("/admin", { tab: "settings", error: "Límites no válidos" }));

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("plans").upsert({
    code: parsed.data.code,
    name: parsed.data.name,
    description: parsed.data.description || null,
    limits: parsedLimits.data,
    active: parsed.data.active === "on",
  });
  if (error) redirect(back("/admin", { tab: "settings", error: "No se pudo guardar el plan" }));
  await recordAudit({
    organizationId: null,
    actorId: s.userId,
    actorType: "platform_admin",
    action: "plan.upsert",
    targetType: "plans",
    targetId: parsed.data.code,
  });
  revalidatePath("/admin");
  redirect(back("/admin", { tab: "settings", ok: "plan" }));
}

export async function updatePlatformSettings(form: FormData) {
  const s = await requirePlatformAdmin();
  const admin = createSupabaseAdminClient();
  const allow = form.get("allowSelfSignup") === "on";
  const { error } = await admin.from("platform_settings").update({ allow_self_signup: allow }).eq("id", true);
  if (error) redirect(back("/admin", { tab: "settings", error: "No se pudo guardar" }));
  await recordAudit({
    organizationId: null,
    actorId: s.userId,
    actorType: "platform_admin",
    action: "platform_settings.update",
    metadata: { allow_self_signup: allow },
  });
  revalidatePath("/admin");
  redirect(back("/admin", { tab: "settings", ok: "settings" }));
}

const providerEnum = z.enum(["openai", "anthropic", "gemini", "xai", "deepseek", "openrouter"]);
const price = z.union([z.literal("").transform(() => null), z.coerce.number().min(0).max(100_000)]);

/** Model catalog: which models agents may use and their prices (USD per 1M tokens). */
export async function upsertModel(form: FormData) {
  const s = await requirePlatformAdmin();
  const parsed = z
    .object({
      provider: providerEnum,
      model: z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9._:/@-]+$/),
      display_name: z.string().trim().max(120).optional(),
      kind: z.enum(["chat", "embedding"]),
      input_per_mtok: price,
      output_per_mtok: price,
      embedding_dimensions: z.union([z.literal("").transform(() => null), z.coerce.number().int().min(1).max(8192)]),
      enabled: z.string().optional(),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) redirect(back("/admin", { tab: "settings", error: "Modelo no válido" }));
  const { enabled, ...rest } = parsed.data;
  const { error } = await createSupabaseAdminClient()
    .from("llm_models")
    .upsert({ ...rest, display_name: rest.display_name || null, enabled: enabled === "on" });
  if (error) redirect(back("/admin", { tab: "settings", error: "No se pudo guardar el modelo" }));
  await recordAudit({
    organizationId: null,
    actorId: s.userId,
    actorType: "platform_admin",
    action: "llm_model.upsert",
    targetType: "llm_models",
    targetId: `${rest.provider}:${rest.model}`,
    metadata: { input_per_mtok: rest.input_per_mtok, output_per_mtok: rest.output_per_mtok },
  });
  revalidatePath("/admin");
  redirect(back("/admin", { tab: "settings", ok: "saved" }));
}

/**
 * Platform admin: creates a user directly (email confirmed, temporary
 * password) or reuses an existing account, and adds it to the organization.
 */
export async function createUserForOrganization(form: FormData) {
  const s = await requirePlatformAdmin();
  const parsed = z
    .object({
      organizationId: z.string().uuid(),
      email: z.string().trim().toLowerCase().email().max(320),
      fullName: z.string().trim().max(120).optional(),
      role: z.enum(["owner", "admin", "member", "viewer"]),
      password: z.string().min(12, "La contraseña temporal debe tener al menos 12 caracteres").max(200),
    })
    .safeParse({
      organizationId: form.get("organizationId"),
      email: form.get("email"),
      fullName: form.get("fullName") || undefined,
      role: form.get("role"),
      password: form.get("password"),
    });
  const orgId = String(form.get("organizationId") ?? "");
  if (!parsed.success) redirect(back(`/clients/${orgId}`, { error: parsed.error.issues[0]?.message ?? "Datos no válidos" }));
  const admin = createSupabaseAdminClient();
  const { email, fullName, role, password, organizationId } = parsed.data;

  let userId: string | undefined;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: fullName ? { full_name: fullName } : {} });
  if (created.data.user) userId = created.data.user.id;
  else {
    // Existing account: attach it to the organization instead.
    const { data } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
    userId = data?.id;
  }
  if (!userId) redirect(back(`/clients/${organizationId}`, { error: "No se pudo crear el usuario" }));
  const { error } = await admin.from("memberships").upsert({ organization_id: organizationId, user_id: userId, role }, { onConflict: "organization_id,user_id" });
  if (error) redirect(back(`/clients/${organizationId}`, { error: "No se pudo añadir a la organización" }));
  await recordAudit({
    organizationId,
    actorId: s.userId,
    actorType: "platform_admin",
    action: created.data.user ? "user.create" : "user.attach",
    targetType: "profiles",
    targetId: userId,
    metadata: { role },
  });
  revalidatePath(`/clients/${organizationId}`);
  redirect(back(`/clients/${organizationId}`, { ok: created.data.user ? "user_created" : "user_attached" }));
}

export async function decideLimitApprovalAction(form: FormData) {
  const s = await requirePlatformAdmin();
  const parsed = z
    .object({ id: z.string().uuid(), decision: z.enum(["approve", "reject"]), extra: z.coerce.number().min(0).max(1e9).optional(), note: z.string().max(500).optional() })
    .safeParse({ id: form.get("id"), decision: form.get("decision"), extra: form.get("extra") || undefined, note: form.get("note") || undefined });
  if (!parsed.success) redirect(back("/admin", { error: "Datos no válidos" }));
  const { decideLimitApproval } = await import("@dtn/db");
  const { getPool } = await import("@dtn/db");
  let orgId: string;
  try {
    orgId = await decideLimitApproval(getPool(), parsed.data.id, { approved: parsed.data.decision === "approve", extra: parsed.data.extra, userId: s.userId, note: parsed.data.note });
  } catch {
    redirect(back("/admin", { error: "La solicitud ya no está pendiente" }));
  }
  await recordAudit({ organizationId: orgId, actorId: s.userId, actorType: "platform_admin", action: `limit.${parsed.data.decision}`, targetType: "limit_approvals", targetId: parsed.data.id, metadata: { extra: parsed.data.extra ?? 0 } });
  revalidatePath("/admin");
  redirect(back("/admin", { ok: "saved" }));
}

export async function setDemoChannelAction(form: FormData) {
  const s = await requirePlatformAdmin();
  const raw = String(form.get("demoKey") ?? "").trim();
  const key = raw === "" ? null : raw;
  if (key && !/^wc_[A-Za-z0-9_-]{20,40}$/.test(key)) redirect(back("/admin", { tab: "settings", error: "La clave debe ser la de un chat web (wc_…)" }));
  const { getPool, setDemoChannelKey } = await import("@dtn/db");
  try {
    await setDemoChannelKey(getPool(), key);
  } catch {
    redirect(back("/admin", { tab: "settings", error: "No existe un chat web con esa clave" }));
  }
  await recordAudit({ organizationId: null, actorId: s.userId, actorType: "platform_admin", action: key ? "site.demo_enabled" : "site.demo_disabled" });
  revalidatePath("/admin");
  redirect(back("/admin", { tab: "settings", ok: "saved" }));
}

export async function contactStatusAction(form: FormData) {
  const s = await requirePlatformAdmin();
  const id = z.string().uuid().parse(form.get("id"));
  const status = z.enum(["new", "contacted", "closed", "spam"]).parse(form.get("status"));
  const { getPool, setContactRequestStatus } = await import("@dtn/db");
  await setContactRequestStatus(getPool(), id, status, s.userId);
  revalidatePath("/admin");
  redirect(back("/admin", { tab: "contacts", ok: "saved" }));
}

export async function setOcrModelAction(form: FormData) {
  const s = await requirePlatformAdmin();
  const raw = String(form.get("ocrModel") ?? "").trim();
  const { getPool } = await import("@dtn/db");
  const pool = getPool();
  if (raw) {
    const [provider, ...rest] = raw.split(":");
    const ok = await pool.query("select 1 from public.llm_models where provider = $1 and model = $2 and kind = 'chat' and enabled", [provider, rest.join(":")]);
    if (!ok.rowCount) redirect(back("/admin", { tab: "settings", error: "Elige un modelo de chat activo" }));
  }
  await pool.query("update public.platform_settings set ocr_model = $1 where id", [raw || null]);
  await recordAudit({ organizationId: null, actorId: s.userId, actorType: "platform_admin", action: raw ? "site.ocr_enabled" : "site.ocr_disabled", metadata: { model: raw || null } });
  revalidatePath("/admin");
  redirect(back("/admin", { tab: "settings", ok: "saved" }));
}
