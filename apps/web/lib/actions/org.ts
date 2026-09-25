"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ACTIVE_ORG_COOKIE, requireSession } from "@/lib/session";

export async function switchOrganization(form: FormData) {
  const id = z.string().uuid().safeParse(form.get("organizationId"));
  const s = await requireSession();
  // Only switch to orgs the user belongs to (platform admins: any org).
  if (!id.success || (!s.isPlatformAdmin && !s.organizations.some((o) => o.id === id.data))) {
    redirect("/dashboard?error=forbidden");
  }
  (await cookies()).set(ACTIVE_ORG_COOKIE, id.data, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
  });
  redirect("/dashboard");
}
