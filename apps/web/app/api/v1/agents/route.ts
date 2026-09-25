import { getAgentTemplate } from "@dtn/core";
import { createAgent, listAgents } from "@dtn/db";
import { ApiError, readJson, withApi } from "@/lib/api/http";
import { presentAgent } from "@/lib/api/presenters";
import { createAgentBody } from "@/lib/api/schemas";
import { db } from "@/lib/db";

export const GET = withApi("agents:read", async ({ principal }) => ({
  data: (await listAgents(db(), principal.organizationId)).map(presentAgent),
}));

export const POST = withApi("agents:write", async ({ principal, req }) => {
  const body = await readJson(req, createAgentBody);
  let base = {};
  if (body.template) {
    const t = getAgentTemplate(body.template);
    if (!t) throw new ApiError(400, "unknown_template", `Unknown template "${body.template}"`);
    base = t.config;
  }
  const agent = await createAgent(db(), principal.organizationId, {
    name: body.name,
    description: body.description,
    status: body.status,
    templateKey: body.template ?? null,
    config: { ...base, ...body.config },
  });
  return Response.json({ data: presentAgent(agent) }, { status: 201 });
});
