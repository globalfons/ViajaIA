"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safe-redirect";

export interface AuthState {
  error?: string;
  message?: string;
}

const credentials = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(8).max(200),
});

export async function signInWithPassword(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = credentials.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: "Email o contraseña no válidos." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  // Generic message: do not reveal whether the account exists.
  if (error) return { error: "Credenciales incorrectas." };
  await supabase.rpc("accept_pending_invitations");
  redirect(safeNextPath(form.get("next")));
}

export async function signInWithMagicLink(_: AuthState, form: FormData): Promise<AuthState> {
  const email = z.string().trim().toLowerCase().email().max(320).safeParse(form.get("email"));
  if (!email.success) return { error: "Email no válido." };
  const supabase = await createSupabaseServerClient();
  const next = safeNextPath(form.get("next"));
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  await supabase.auth.signInWithOtp({
    email: email.data,
    options: { shouldCreateUser: false, emailRedirectTo: `${appUrl}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  return { message: "Si la cuenta existe, recibirás un enlace de acceso en tu email." };
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
