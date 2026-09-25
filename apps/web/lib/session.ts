import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { can, isRole, type Permission, type Role } from "@dtn/core/security/rbac";
import { createSupabaseServerClient } from "./supabase/server";

export const ACTIVE_ORG_COOKIE = "dtn_org";

export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended";
  plan_code: string | null;
  role: Role | null;
  branding: Record<string, unknown>;
  white_label_enabled: boolean;
}

export interface SessionContext {
  userId: string;
  email: string | null;
  fullName: string | null;
  isPlatformAdmin: boolean;
  organizations: OrgSummary[];
  org: OrgSummary | null;
  role: Role | null;
  can: (p: Permission) => boolean;
}

/**
 * Resolves the signed-in user, their memberships and the active organization
 * (cookie, validated against memberships). Cached per request.
 */
export const getSession = cache(async (): Promise<SessionContext | null> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: memberships }] = await Promise.all([
    supabase.from("profiles").select("full_name, email, is_platform_admin").eq("id", user.id).single(),
    supabase
      .from("memberships")
      .select("role, organizations(id, name, slug, status, plan_code, branding, white_label_enabled)")
      .eq("user_id", user.id),
  ]);

  const isPlatformAdmin = Boolean(profile?.is_platform_admin);
  const organizations: OrgSummary[] = (memberships ?? [])
    .map((m) => {
      const o = (Array.isArray(m.organizations) ? m.organizations[0] : m.organizations) as Omit<OrgSummary, "role"> | null;
      return o ? { ...o, role: isRole(m.role) ? m.role : null } : null;
    })
    .filter((o): o is OrgSummary => o !== null)
    .sort((a, b) => a.name.localeCompare(b.name));

  const store = await cookies();
  const wanted = store.get(ACTIVE_ORG_COOKIE)?.value;
  let org = organizations.find((o) => o.id === wanted) ?? null;

  // Platform admins may "enter" any client org without being a member.
  if (!org && wanted && isPlatformAdmin) {
    const { data } = await supabase
      .from("organizations")
      .select("id, name, slug, status, plan_code, branding, white_label_enabled")
      .eq("id", wanted)
      .maybeSingle();
    if (data) org = { ...(data as Omit<OrgSummary, "role">), role: null };
  }
  org ??= organizations[0] ?? null;

  const role = org?.role ?? null;
  return {
    userId: user.id,
    email: user.email ?? null,
    fullName: profile?.full_name ?? null,
    isPlatformAdmin,
    organizations,
    org,
    role,
    can: (p) => can(role, p, { platformAdmin: isPlatformAdmin }),
  };
});

export async function requireSession(): Promise<SessionContext> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

/** Requires an active organization context (and optionally a permission). */
export async function requireOrg(permission?: Permission) {
  const s = await requireSession();
  if (!s.org) redirect("/onboarding");
  if (permission && !s.can(permission)) redirect("/dashboard?error=forbidden");
  return s as SessionContext & { org: OrgSummary };
}

export async function requirePlatformAdmin() {
  const s = await requireSession();
  if (!s.isPlatformAdmin) redirect("/dashboard?error=forbidden");
  return s;
}
