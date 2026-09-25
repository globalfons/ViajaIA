import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseConfig } from "./config";

/**
 * Service-role client. BYPASSES RLS. Only use it after an explicit
 * authorization check (platform admin, verified webhook signature…) and
 * always scope queries by organization_id.
 */
export function createSupabaseAdminClient() {
  const cfg = supabaseConfig();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!cfg || !key) throw new Error("Supabase service role is not configured");
  return createClient(cfg.url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
