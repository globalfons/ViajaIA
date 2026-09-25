import { z } from "zod";
import { agentConfigSchema } from "@dtn/core/agents/config";
import { agentResponse, createAgentBody, decisionBody, errorResponse, runAgentBody, runResponse, startWorkflowRunBody, updateAgentBody } from "./schemas";

const schema = (s: z.ZodType) => {
  const out = z.toJSONSchema(s, { target: "openapi-3.0", unrepresentable: "any", io: "input" }) as Record<string, unknown>;
  delete out.$schema;
  return out;
};

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (s: object) => ({ content: { "application/json": { schema: s } } });
const errors = {
  "400": { description: "Validation error", ...json(ref("Error")) },
  "401": { description: "Missing or invalid API key", ...json(ref("Error")) },
  "403": { description: "Insufficient scope or suspended organization", ...json(ref("Error")) },
  "429": { description: "Rate limited", ...json(ref("Error")) },
};
const idParam = { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } };

/**
 * OpenAPI 3.0 document generated from the same zod schemas that validate
 * requests, so documentation cannot drift from behaviour.
 */
export function buildOpenApi(serverUrl: string) {
  return {
    openapi: "3.0.3",
    info: {
      title: "DigitalizaTusNegocios AI OS API",
      version: "1.0.0",
      description:
        "Public REST API. Authenticate with `Authorization: Bearer dtn_…` (API keys are created in Settings → API keys and are scoped to one organization). Every response carries `x-request-id`.",
    },
    servers: [{ url: `${serverUrl}/api/v1` }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", description: "Organization API key (dtn_…)" } },
      schemas: {
        Error: schema(errorResponse),
        AgentConfig: schema(agentConfigSchema),
        Agent: schema(agentResponse),
        CreateAgent: schema(createAgentBody),
        UpdateAgent: schema(updateAgentBody),
        RunAgent: schema(runAgentBody),
        Decision: schema(decisionBody),
        Run: schema(runResponse),
        StartWorkflowRun: schema(startWorkflowRunBody),
      },
    },
    paths: {
      "/agents": {
        get: {
          summary: "List agents",
          tags: ["Agents"],
          "x-scope": "agents:read",
          responses: { "200": { description: "Agents", ...json({ type: "object", properties: { data: { type: "array", items: ref("Agent") } } }) }, ...errors },
        },
        post: {
          summary: "Create an agent (optionally from a built-in template)",
          tags: ["Agents"],
          "x-scope": "agents:write",
          requestBody: { required: true, ...json(ref("CreateAgent")) },
          responses: {
            "201": { description: "Created", ...json({ type: "object", properties: { data: ref("Agent") } }) },
            "402": { description: "Plan limit reached", ...json(ref("Error")) },
            ...errors,
          },
        },
      },
      "/agents/{id}": {
        parameters: [idParam],
        get: { summary: "Get an agent", tags: ["Agents"], "x-scope": "agents:read", responses: { "200": { description: "Agent", ...json({ type: "object", properties: { data: ref("Agent") } }) }, "404": { description: "Not found", ...json(ref("Error")) }, ...errors } },
        patch: {
          summary: "Update an agent (config is merged; each change creates a new version)",
          tags: ["Agents"],
          "x-scope": "agents:write",
          requestBody: { required: true, ...json(ref("UpdateAgent")) },
          responses: { "200": { description: "Updated", ...json({ type: "object", properties: { data: ref("Agent") } }) }, "404": { description: "Not found", ...json(ref("Error")) }, ...errors },
        },
        delete: { summary: "Archive an agent", tags: ["Agents"], "x-scope": "agents:write", responses: { "204": { description: "Archived" }, "404": { description: "Not found", ...json(ref("Error")) }, ...errors } },
      },
      "/agents/{id}/runs": {
        parameters: [idParam],
        post: {
          summary: "Send a message to an active agent",
          description: "Returns the agent's answer. If a tool needs human approval, status is `needs_approval` and `pending_approval` describes it; decide with POST /runs/{id}/decision.",
          tags: ["Runs"],
          "x-scope": "agents:run",
          requestBody: { required: true, ...json(ref("RunAgent")) },
          responses: { "200": { description: "Run result", ...json(ref("Run")) }, "402": { description: "Budget or plan limit reached", ...json(ref("Error")) }, "404": { description: "Agent not found or not active", ...json(ref("Error")) }, ...errors },
        },
      },
      "/runs/{id}/decision": {
        parameters: [idParam],
        post: {
          summary: "Approve or reject the pending action of a paused run",
          tags: ["Runs"],
          "x-scope": "agents:run",
          requestBody: { required: true, ...json(ref("Decision")) },
          responses: { "200": { description: "Run result after the decision", ...json(ref("Run")) }, "404": { description: "No pending run", ...json(ref("Error")) }, ...errors },
        },
      },
      "/workflows": {
        get: { summary: "List workflows", tags: ["Workflows"], "x-scope": "workflows:read", responses: { "200": { description: "Workflows" }, ...errors } },
      },
      "/workflows/{id}": {
        parameters: [idParam],
        get: { summary: "Get a workflow and its published graph", tags: ["Workflows"], "x-scope": "workflows:read", responses: { "200": { description: "Workflow" }, "404": { description: "Not found", ...json(ref("Error")) }, ...errors } },
      },
      "/workflows/{id}/runs": {
        parameters: [idParam],
        post: {
          summary: "Start a run of the published version (asynchronous)",
          tags: ["Workflows"],
          "x-scope": "workflows:run",
          requestBody: { required: false, ...json(ref("StartWorkflowRun")) },
          responses: { "202": { description: "Queued: poll /workflow-runs/{id}" }, "404": { description: "Workflow not published", ...json(ref("Error")) }, ...errors },
        },
      },
      "/workflow-runs/{id}": {
        parameters: [idParam],
        get: { summary: "Run status, output and per-node status", tags: ["Workflows"], "x-scope": "workflows:read", responses: { "200": { description: "Run" }, "404": { description: "Not found", ...json(ref("Error")) }, ...errors } },
      },
      "/knowledge-bases": {
        get: { summary: "List knowledge bases with document counts", tags: ["Knowledge"], "x-scope": "knowledge:read", responses: { "200": { description: "Knowledge bases" }, ...errors } },
      },
      "/knowledge-bases/{id}/documents": {
        parameters: [idParam],
        get: { summary: "List documents (status, size, chunks, errors)", tags: ["Knowledge"], "x-scope": "knowledge:read", responses: { "200": { description: "Documents" }, "404": { description: "Not found", ...json(ref("Error")) }, ...errors } },
        post: {
          summary: "Add a document: multipart `file` (PDF, DOCX, TXT, MD, CSV, HTML; max 20 MB) or JSON {url}. Indexed asynchronously.",
          tags: ["Knowledge"],
          "x-scope": "knowledge:write",
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": { schema: { type: "object", properties: { file: { type: "string", format: "binary" } }, required: ["file"] } },
              "application/json": { schema: { type: "object", properties: { url: { type: "string", format: "uri" } }, required: ["url"] } },
            },
          },
          responses: { "202": { description: "Queued for indexing" }, "402": { description: "Plan limit reached", ...json(ref("Error")) }, "415": { description: "Unsupported media type", ...json(ref("Error")) }, ...errors },
        },
      },
      "/knowledge-bases/{id}/search": {
        parameters: [idParam],
        post: {
          summary: "Hybrid search (semantic + keyword)",
          tags: ["Knowledge"],
          "x-scope": "knowledge:read",
          requestBody: { required: true, ...json({ type: "object", properties: { query: { type: "string" }, k: { type: "integer", minimum: 1, maximum: 20 } }, required: ["query"] }) },
          responses: { "200": { description: "Ranked fragments" }, ...errors },
        },
      },
      "/usage": {
        get: {
          summary: "Usage and cost per day and model",
          tags: ["Usage"],
          "x-scope": "usage:read",
          parameters: [
            { name: "from", in: "query", schema: { type: "string", format: "date" } },
            { name: "to", in: "query", schema: { type: "string", format: "date" } },
          ],
          responses: { "200": { description: "Usage" }, ...errors },
        },
      },
    },
  };
}
