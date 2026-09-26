import { z } from "zod";

/**
 * Server-side environment schema. Validated once at start-up so that a
 * misconfigured deploy fails fast instead of at the first request.
 * Nothing here has defaults for secrets: they must come from the environment.
 */
const optional = z.string().min(1).optional();

export const APP_ENVS = ["development", "test", "staging", "production"] as const;
export type AppEnv = (typeof APP_ENVS)[number];

export const serverEnvSchema = z
  .object({
    APP_ENV: z.enum(APP_ENVS).default("development"),
    APP_URL: z.string().url().default("http://localhost:3000"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).optional(),

    NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: optional,
    SUPABASE_SERVICE_ROLE_KEY: optional,
    DATABASE_URL: optional,

    /** base64-encoded 32-byte key(s): "v1:<key>,v2:<key>". The last one encrypts. */
    SECRETS_ENCRYPTION_KEYS: optional,

    DEFAULT_CHAT_MODEL: optional,
    DEFAULT_EMBEDDING_MODEL: optional,
    EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(1536),

    OPENAI_API_KEY: optional,
    ANTHROPIC_API_KEY: optional,
    GEMINI_API_KEY: optional,
    XAI_API_KEY: optional,
    DEEPSEEK_API_KEY: optional,
    OPENROUTER_API_KEY: optional,

    STRIPE_SECRET_KEY: optional,
    STRIPE_WEBHOOK_SECRET: optional,

    WHATSAPP_APP_SECRET: optional,
    WHATSAPP_VERIFY_TOKEN: optional,
    WHATSAPP_GRAPH_BASE_URL: optional,
    RESEND_BASE_URL: optional,
    STRIPE_API_BASE: optional,
    CONTACT_EMAIL: optional,
    LEGAL_COMPANY_NAME: optional,
    LEGAL_TAX_ID: optional,
    LEGAL_ADDRESS: optional,
    LEGAL_EMAIL: optional,
    GOOGLE_OAUTH_AUTH_URL: optional,
    GOOGLE_OAUTH_TOKEN_URL: optional,
    GOOGLE_OAUTH_REVOKE_URL: optional,
    GOOGLE_CALENDAR_BASE_URL: optional,

    GOOGLE_CLIENT_ID: optional,
    GOOGLE_CLIENT_SECRET: optional,
    MICROSOFT_CLIENT_ID: optional,
    MICROSOFT_CLIENT_SECRET: optional,
    MICROSOFT_TENANT: z.string().default("common"),

    /** Allow http:// and private hosts for outbound calls. Never in production. */
    ALLOW_INSECURE_OUTBOUND: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
  })
  .superRefine((env, ctx) => {
    if (env.APP_ENV === "production" || env.APP_ENV === "staging") {
      for (const key of [
        "NEXT_PUBLIC_SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
        "DATABASE_URL",
        "SECRETS_ENCRYPTION_KEYS",
      ] as const) {
        if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: `${key} is required in ${env.APP_ENV}` });
      }
      if (env.ALLOW_INSECURE_OUTBOUND) {
        ctx.addIssue({ code: "custom", path: ["ALLOW_INSECURE_OUTBOUND"], message: "must be false outside development/test" });
      }
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function loadServerEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  const parsed = serverEnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
