import { describe, expect, it } from "vitest";
import { SOLUTION_CATEGORIES, SOLUTIONS } from "../src/solutions/catalog";
import { getAgentTemplate } from "../src/templates/agent-templates";
import { BUILTIN_TOOLS } from "../src/tools/builtin";
import { CRM_TOOL_NAMES } from "../src/crm/tools";
import { validateWorkflowGraph } from "../src/workflows/schema";

describe("solutions catalog", () => {
  it("covers the requested products with unique keys and template ids", () => {
    expect(SOLUTIONS.map((s) => s.name)).toEqual(
      expect.arrayContaining([
        "AI Customer Support",
        "AI Sales Agent",
        "AI Lead Qualification",
        "AI Receptionist",
        "AI WhatsApp Agent",
        "AI Document Assistant",
        "AI Internal Knowledge Assistant",
        "AI Appointment Agent",
        "AI Marketing Agent",
        "AI Workflow Automation",
      ]),
    );
    expect(new Set(SOLUTIONS.map((s) => s.key)).size).toBe(SOLUTIONS.length);
    expect(new Set(SOLUTIONS.map((s) => s.templateId)).size).toBe(SOLUTIONS.length);
  });

  it.each(SOLUTIONS.map((s) => [s.key, s] as const))("%s is internally consistent", (_k, s) => {
    expect(SOLUTION_CATEGORIES).toContain(s.category);
    for (const a of s.agents) expect(getAgentTemplate(a.templateKey), a.templateKey).toBeDefined();
    const tools = new Set<string>([...BUILTIN_TOOLS.map((t) => t.name), ...CRM_TOOL_NAMES]);
    for (const t of s.tools) expect(tools.has(t), t).toBe(true);
    for (const f of s.config) expect(f.key).toMatch(/^[a-z][a-z0-9_]{1,39}$/);
    if (s.workflow) {
      const ids = Object.fromEntries(s.agents.map((a, i) => [a.role, `00000000-0000-4000-8000-00000000000${i}`]));
      const { issues } = validateWorkflowGraph(s.workflow.build(ids));
      expect(issues).toEqual([]);
    }
  });

  it("marks integration-dependent solutions honestly", () => {
    expect(SOLUTIONS.find((s) => s.key === "whatsapp_agent")!.needsIntegrations).toContain("whatsapp");
    expect(SOLUTIONS.find((s) => s.key === "appointment_agent")!.needsIntegrations).toContain("calendar");
  });
});
