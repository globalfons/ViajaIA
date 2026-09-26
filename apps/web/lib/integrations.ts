import "server-only";
import { getSystemStatus } from "./system-status";

/**
 * Integration catalog. `available` means implemented and usable today; the
 * rest are listed honestly as coming soon (no fake connect buttons).
 */
export interface IntegrationInfo {
  key: string;
  name: string;
  category: "Canales" | "IA" | "Productividad" | "CRM" | "Plataforma";
  description: string;
  state: "available" | "configured" | "not_configured" | "coming_soon";
  note?: string;
}

export function integrationCatalog(env: Record<string, string | undefined> = process.env): IntegrationInfo[] {
  const status = new Map(getSystemStatus(env).map((s) => [s.key, s.configured]));
  const llm = (key: string, name: string): IntegrationInfo => ({
    key,
    name,
    category: "IA",
    description: "Proveedor de modelos para el LLM Router.",
    state: status.get(`llm:${key}`) ? "configured" : "not_configured",
    note: status.get(`llm:${key}`) ? undefined : "Requiere la API key en el entorno del servidor (la configura la agencia).",
  });
  return [
    { key: "web", name: "Chat web", category: "Canales", description: "Widget para la web del cliente: responde con su agente y escala a una persona.", state: "available" },
    { key: "api", name: "API REST", category: "Plataforma", description: "API v1 con OpenAPI y API keys por organización (Settings → API keys).", state: "available" },
    llm("openai", "OpenAI"),
    llm("anthropic", "Anthropic Claude"),
    llm("gemini", "Google Gemini"),
    llm("xai", "xAI Grok"),
    llm("deepseek", "DeepSeek"),
    llm("openrouter", "OpenRouter"),
    {
      key: "whatsapp",
      name: "WhatsApp Business",
      category: "Canales",
      description: "Cloud API de Meta: webhook firmado, identificación del cliente y respuestas del agente.",
      state: env.WHATSAPP_APP_SECRET && env.WHATSAPP_VERIFY_TOKEN ? "available" : "not_configured",
      note: env.WHATSAPP_APP_SECRET && env.WHATSAPP_VERIFY_TOKEN ? undefined : "Requiere la app de Meta de la agencia (WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN).",
    },
    { key: "email", name: "Email", category: "Canales", description: "Webhook de entrada, borradores revisados por una persona y envío con Resend solo si el cliente lo activa.", state: "available" },
    { key: "telegram", name: "Telegram", category: "Canales", description: "Bot de Telegram como canal adicional.", state: "coming_soon" },
    { key: "slack", name: "Slack", category: "Productividad", description: "Avisos de escalados y aprobaciones al equipo.", state: "coming_soon" },
    { key: "gcal", name: "Google Calendar", category: "Productividad", description: "Disponibilidad y citas mediante OAuth.", state: "coming_soon" },
    { key: "mscal", name: "Microsoft Calendar", category: "Productividad", description: "Disponibilidad y citas mediante OAuth.", state: "coming_soon" },
    { key: "hubspot", name: "HubSpot", category: "CRM", description: "Sincronización de contactos y leads.", state: "coming_soon" },
    { key: "mcp", name: "MCP servers", category: "Plataforma", description: "Herramientas externas vía Model Context Protocol, con allowlist y credenciales cifradas.", state: "coming_soon" },
  ];
}
