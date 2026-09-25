import { z } from "zod";
import { agentConfigSchema } from "@dtn/core/agents/config";

/** Request/response schemas of the public API. Also the source of the OpenAPI document. */

export const agentStatus = z.enum(["draft", "active", "paused"]);

export const createAgentBody = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  status: agentStatus.optional(),
  template: z.string().max(80).optional().describe("Built-in template key, e.g. customer_support"),
  config: agentConfigSchema.partial().extend({ model: z.string() }).describe("Agent configuration (see AgentConfig)"),
});

export const updateAgentBody = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(1000).optional(),
  status: agentStatus.optional(),
  config: agentConfigSchema.partial().optional(),
});

export const runAgentBody = z.object({
  message: z.string().min(1).max(20_000),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(20_000) })).max(100).optional(),
  variables: z.record(z.string().regex(/^[a-zA-Z0-9_]{1,40}$/), z.string().max(500)).optional(),
});

export const decisionBody = z.object({ approved: z.boolean(), note: z.string().max(500).optional() });

export const agentResponse = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string(),
  status: z.enum(["draft", "active", "paused", "archived"]),
  template_key: z.string().nullable(),
  version: z.number().int(),
  config: z.record(z.string(), z.unknown()),
  created_at: z.string(),
  updated_at: z.string(),
});

export const runResponse = z.object({
  run_id: z.string().uuid(),
  status: z.enum(["completed", "needs_approval", "escalated", "blocked", "failed"]),
  output: z.string(),
  structured: z.record(z.string(), z.unknown()).nullable().optional(),
  pending_approval: z.object({ toolCallId: z.string(), toolName: z.string(), args: z.record(z.string(), z.unknown()), risk: z.string() }).optional(),
  sources: z.array(z.object({ id: z.string(), documentId: z.string(), title: z.string(), score: z.number() })),
  tool_invocations: z.array(z.object({ name: z.string(), status: z.string(), durationMs: z.number() })),
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number(), costUsd: z.number(), llmCalls: z.number() }),
  model: z.string().optional(),
  error: z.string().optional(),
});

export const errorResponse = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});

export const startWorkflowRunBody = z.object({ input: z.record(z.string(), z.unknown()).optional() });
