import { z } from "zod";
import { PROVIDER_IDS } from "../llm/types";
import { TOOL_NAME_RE } from "../tools/registry";

export const modelRefSchema = z
  .string()
  .max(200)
  .refine((v) => {
    const i = v.indexOf(":");
    return i > 0 && (PROVIDER_IDS as readonly string[]).includes(v.slice(0, i)) && v.length > i + 1;
  }, "Formato esperado provider:model (openai, anthropic, gemini, xai, deepseek, openrouter)");

export const guardrailsSchema = z.object({
  /** Behaviour when an injection pattern is detected in untrusted input. */
  injectionDetection: z.enum(["off", "flag", "block"]).default("flag"),
  blockedTopics: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  blockedTopicReply: z.string().max(1000).default("Lo siento, no puedo ayudarte con ese tema."),
  /** Tell users they are talking to an AI (EU AI Act art. 50). */
  aiDisclosure: z.boolean().default(true),
  maxInputChars: z.number().int().min(100).max(100_000).default(8000),
  redactSecretsInOutput: z.boolean().default(true),
});

export const humanApprovalSchema = z.object({
  /** Tools that need a human "yes" before running. Risky built-ins always do. */
  tools: z.array(z.string().regex(TOOL_NAME_RE)).max(100).default([]),
  /** Require approval for every write/external tool. */
  allWriteTools: z.boolean().default(false),
  /** Escalate when the structured output reports confidence below this. */
  confidenceThreshold: z.number().min(0).max(1).nullable().default(null),
});

export const agentLimitsSchema = z.object({
  maxSteps: z.number().int().min(1).max(25).default(6),
  maxCostUsdPerRun: z.number().positive().max(100).nullable().default(null),
  maxOutputTokens: z.number().int().min(16).max(64_000).default(1500),
  timeoutMs: z.number().int().min(1000).max(300_000).default(60_000),
  monthlyCostUsd: z.number().positive().nullable().default(null),
});

export const memorySchema = z.object({
  enabled: z.boolean().default(true),
  /** Last N conversation messages sent to the model. */
  maxMessages: z.number().int().min(0).max(100).default(20),
});

export const agentConfigSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).default(""),
  systemPrompt: z.string().max(20_000).default(""),
  instructions: z.string().max(20_000).default(""),
  model: modelRefSchema,
  fallbackModels: z.array(modelRefSchema).max(3).default([]),
  temperature: z.number().min(0).max(2).default(0.3),
  tools: z.array(z.string().regex(TOOL_NAME_RE)).max(50).default([]),
  toolConfig: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
  knowledgeBaseIds: z.array(z.string().uuid()).max(20).default([]),
  memory: memorySchema.default(memorySchema.parse({})),
  limits: agentLimitsSchema.default(agentLimitsSchema.parse({})),
  /** JSON Schema for structured output, or null for free text. */
  outputSchema: z.record(z.string(), z.unknown()).nullable().default(null),
  guardrails: guardrailsSchema.default(guardrailsSchema.parse({})),
  humanApproval: humanApprovalSchema.default(humanApprovalSchema.parse({})),
  language: z.string().max(10).default("es"),
});

export type AgentConfig = z.infer<typeof agentConfigSchema>;
export type AgentConfigInput = z.input<typeof agentConfigSchema>;

export function parseAgentConfig(input: unknown): AgentConfig {
  return agentConfigSchema.parse(input);
}
