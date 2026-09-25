"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { API_SCOPES, generateApiKey } from "@dtn/db";
import { requireOrg } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface CreateKeyState {
  key?: string;
  error?: string;
}

export async function createApiKeyAction(_: CreateKeyState, form: FormData): Promise<CreateKeyState> {
  const s = await requireOrg("api_keys.manage");
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(100),
      scopes: z.array(z.enum(API_SCOPES)).min(1),
      expiresInDays: z.coerce.number().int().min(0).max(730),
    })
    .safeParse({ name: form.get("name"), scopes: form.getAll("scopes"), expiresInDays: form.get("expiresInDays") || 0 });
  if (!parsed.success) return { error: "Indica un nombre y al menos un permiso." };
  const k = generateApiKey();
  const supabase = await createSupabaseServerClient();
  // RLS: only owners/admins of this org can insert.
  const { error } = await supabase.from("api_keys").insert({
    organization_id: s.org.id,
    name: parsed.data.name,
    prefix: k.prefix,
    key_hash: k.hash,
    scopes: parsed.data.scopes,
    created_by: s.userId,
    expires_at: parsed.data.expiresInDays ? new Date(Date.now() + parsed.data.expiresInDays * 86_400_000).toISOString() : null,
  });
  if (error) return { error: "No se pudo crear la clave." };
  revalidatePath("/settings");
  return { key: k.key };
}

export async function revokeApiKeyAction(form: FormData) {
  const s = await requireOrg("api_keys.manage");
  const id = z.string().uuid().parse(form.get("id"));
  const supabase = await createSupabaseServerClient();
  await supabase.from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", id).eq("organization_id", s.org.id);
  revalidatePath("/settings");
}
