import "server-only";
import { PROVIDER_IDS } from "@dtn/core";

export interface StatusItem {
  key: string;
  label: string;
  configured: boolean;
  required: boolean;
  hint: string;
}

/** Reports which integrations are configured. Only booleans leave the server, never values. */
export function getSystemStatus(env: Record<string, string | undefined> = process.env): StatusItem[] {
  const has = (k: string) => Boolean(env[k] && env[k]!.trim());
  const llmKeys: Record<(typeof PROVIDER_IDS)[number], string> = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    gemini: "GEMINI_API_KEY",
    xai: "XAI_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
  };
  return [
    {
      key: "supabase",
      label: "Supabase (Auth + Postgres)",
      configured: has("NEXT_PUBLIC_SUPABASE_URL") && has("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      required: true,
      hint: "NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY",
    },
    {
      key: "service",
      label: "Supabase service role + DATABASE_URL (worker)",
      configured: has("SUPABASE_SERVICE_ROLE_KEY") && has("DATABASE_URL"),
      required: true,
      hint: "SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL",
    },
    {
      key: "secrets",
      label: "Cifrado de secretos",
      configured: has("SECRETS_ENCRYPTION_KEYS"),
      required: true,
      hint: "SECRETS_ENCRYPTION_KEYS (openssl rand -base64 32)",
    },
    {
      key: "llm",
      label: "Proveedor LLM (al menos uno)",
      configured: Object.values(llmKeys).some(has),
      required: true,
      hint: Object.values(llmKeys).join(", "),
    },
    ...Object.entries(llmKeys).map(([id, k]) => ({
      key: `llm:${id}`,
      label: `LLM · ${id}`,
      configured: has(k),
      required: false,
      hint: k,
    })),
    {
      key: "stripe",
      label: "Stripe",
      configured: has("STRIPE_SECRET_KEY") && has("STRIPE_WEBHOOK_SECRET"),
      required: false,
      hint: "STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET",
    },
    {
      key: "whatsapp",
      label: "WhatsApp Cloud API",
      configured: has("WHATSAPP_APP_SECRET") && has("WHATSAPP_VERIFY_TOKEN"),
      required: false,
      hint: "WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN",
    },
  ];
}
