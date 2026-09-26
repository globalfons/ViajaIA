import { describe, expect, it } from "vitest";
import { parseAgentConfig } from "../src/agents/config";
import { AGENT_TEMPLATES } from "../src/templates/agent-templates";
import { BUILTIN_TOOLS } from "../src/tools/builtin";
import { CRM_TOOL_NAMES } from "../src/crm/tools";

describe("agent templates", () => {
  const builtin = new Set<string>([...BUILTIN_TOOLS.map((t) => t.name), ...CRM_TOOL_NAMES]);

  it("cover the products the agency sells", () => {
    expect(AGENT_TEMPLATES.map((t) => t.key)).toEqual(
      expect.arrayContaining([
        "customer_support",
        "receptionist",
        "sales_agent",
        "lead_qualification",
        "document_assistant",
        "internal_knowledge",
        "appointment_agent",
        "marketing_agent",
        "whatsapp_agent",
        "voice_agent",
      ]),
    );
    expect(new Set(AGENT_TEMPLATES.map((t) => t.key)).size).toBe(AGENT_TEMPLATES.length);
  });

  it.each(AGENT_TEMPLATES.map((t) => [t.key, t] as const))("%s produces a valid config with existing tools only", (_k, t) => {
    const cfg = parseAgentConfig({ ...t.config, name: t.name, model: "anthropic:claude-sonnet-5" });
    for (const tool of cfg.tools) expect(builtin.has(tool), tool).toBe(true);
    expect(cfg.guardrails.aiDisclosure).toBe(true);
  });

  it("sales templates forbid unsolicited outreach", () => {
    const sales = AGENT_TEMPLATES.find((t) => t.key === "sales_agent")!;
    expect(sales.config.instructions).toMatch(/Nunca inicies contactos no solicitados/);
  });
});
