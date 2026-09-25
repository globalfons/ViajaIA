import type { LLMRouter, UsageContext } from "../llm/router";
import type { ChatMessage, ToolCall } from "../llm/types";
import {
  UNTRUSTED_CONTENT_POLICY,
  detectPromptInjection,
  matchBlockedTopic,
  redactSecrets,
  redactValue,
  sanitizeText,
  wrapUntrusted,
  type InjectionFinding,
} from "../security/guardrails";
import { executeTool, serializeToolResult, toToolSpec, ToolError, type ToolDefinition, type ToolRegistry } from "../tools/registry";
import type { AgentConfig } from "./config";

export interface RetrievedChunk {
  id: string;
  documentId: string;
  title: string;
  content: string;
  score: number;
  source?: string | null;
}

export interface ToolInvocationRecord {
  toolCallId: string;
  name: string;
  args: unknown;
  status: "success" | "error" | "denied" | "not_allowed";
  result?: unknown;
  error?: string;
  durationMs: number;
}

export interface PendingApproval {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  risk: string;
}

/** Serializable state needed to resume a run after a human decision. */
export interface AgentRunState {
  messages: ChatMessage[];
  pendingCalls: ToolCall[];
  steps: number;
  usage: RunUsage;
  sources: RetrievedChunk[];
}

export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  llmCalls: number;
}

export type AgentRunStatus = "completed" | "needs_approval" | "escalated" | "blocked" | "failed";

export interface AgentRunResult {
  status: AgentRunStatus;
  output: string;
  structured?: Record<string, unknown> | null;
  toolInvocations: ToolInvocationRecord[];
  sources: RetrievedChunk[];
  usage: RunUsage;
  steps: number;
  model?: string;
  pendingApproval?: PendingApproval;
  state?: AgentRunState;
  flags: { injection: InjectionFinding[]; blockedTopic?: string };
  error?: string;
}

export interface AgentRunInput {
  organizationId: string;
  agentId?: string;
  conversationId?: string;
  workflowRunId?: string;
  userId?: string;
  config: AgentConfig;
  message?: string;
  history?: ChatMessage[];
  variables?: Record<string, string>;
  resume?: { state: AgentRunState; decision: { toolCallId: string; approved: boolean; note?: string } };
}

export interface AgentRuntimeDeps {
  router: LLMRouter;
  tools: ToolRegistry;
  retrieve?: (query: string, knowledgeBaseIds: string[], ctx: UsageContext) => Promise<RetrievedChunk[]>;
  getSecret?: (organizationId: string, name: string) => Promise<string | null>;
  onToolInvocation?: (rec: ToolInvocationRecord, input: AgentRunInput) => void | Promise<void>;
}

const emptyUsage = (): RunUsage => ({ inputTokens: 0, outputTokens: 0, costUsd: 0, llmCalls: 0 });

export function renderTemplate(text: string, vars: Record<string, string> = {}): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, k: string) => (k in vars ? vars[k]! : m));
}

export function buildSystemPrompt(config: AgentConfig, sources: RetrievedChunk[], vars: Record<string, string> = {}): string {
  const parts: string[] = [];
  if (config.systemPrompt.trim()) parts.push(renderTemplate(config.systemPrompt, vars));
  if (config.instructions.trim()) parts.push(`## Instructions\n${renderTemplate(config.instructions, vars)}`);
  parts.push(`## Security\n${UNTRUSTED_CONTENT_POLICY}`);
  if (config.guardrails.aiDisclosure) {
    parts.push("You are an AI assistant. If someone asks whether they are talking to a human, say clearly that you are an AI.");
  }
  if (config.outputSchema) {
    parts.push("Return your final answer as a JSON object that matches the requested schema.");
  }
  if (sources.length) {
    parts.push(
      [
        "## Knowledge",
        "Answer using the following excerpts when relevant. Cite them as [n]. If the answer is not in them, say you do not know instead of guessing.",
        ...sources.map((s, i) => `[${i + 1}] ${s.title}\n${wrapUntrusted(`kb:${s.documentId}`, s.content)}`),
      ].join("\n\n"),
    );
  }
  return parts.join("\n\n");
}

function extractJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const candidates = [trimmed, /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed)?.[1], trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1)];
  for (const c of candidates) {
    if (!c) continue;
    try {
      const v = JSON.parse(c);
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      /* try next */
    }
  }
  return null;
}

function needsApproval(tool: ToolDefinition, config: AgentConfig): boolean {
  if (tool.alwaysRequireApproval) return true;
  if (config.humanApproval.tools.includes(tool.name)) return true;
  return config.humanApproval.allWriteTools && tool.risk !== "read";
}

export class AgentRuntime {
  constructor(private readonly deps: AgentRuntimeDeps) {}

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const { config } = input;
    const ctx: UsageContext = {
      organizationId: input.organizationId,
      agentId: input.agentId,
      conversationId: input.conversationId,
      workflowRunId: input.workflowRunId,
      purpose: "chat",
    };
    const flags: AgentRunResult["flags"] = { injection: [] };
    const invocations: ToolInvocationRecord[] = [];
    const allowedTools = this.deps.tools.forAgent(config.tools);
    const toolSpecs = allowedTools.map(toToolSpec);
    const deadline = Date.now() + config.limits.timeoutMs;

    let messages: ChatMessage[];
    let pending: ToolCall[] = [];
    let steps = 0;
    let usage = emptyUsage();
    let sources: RetrievedChunk[] = [];
    let decision = input.resume?.decision;

    if (input.resume) {
      ({ messages, steps, usage, sources } = input.resume.state);
      messages = [...messages];
      pending = [...input.resume.state.pendingCalls];
      if (!pending.some((c) => c.id === decision!.toolCallId)) {
        return this.fail("Approval does not match the pending tool call", { usage, steps, sources, invocations, flags });
      }
    } else {
      const raw = sanitizeText(input.message ?? "", config.guardrails.maxInputChars + 1);
      if (!raw.trim()) return this.fail("Empty message", { usage, steps, sources, invocations, flags });
      if (raw.length > config.guardrails.maxInputChars) {
        return { ...this.base(usage, steps, sources, invocations, flags), status: "blocked", output: "El mensaje es demasiado largo." };
      }
      const topic = matchBlockedTopic(raw, config.guardrails.blockedTopics);
      if (topic) {
        flags.blockedTopic = topic;
        return { ...this.base(usage, steps, sources, invocations, flags), status: "blocked", output: config.guardrails.blockedTopicReply };
      }
      if (config.guardrails.injectionDetection !== "off") {
        flags.injection.push(...detectPromptInjection(raw));
        if (flags.injection.length && config.guardrails.injectionDetection === "block") {
          return {
            ...this.base(usage, steps, sources, invocations, flags),
            status: "blocked",
            output: "No puedo procesar este mensaje. Si necesitas ayuda, reformula tu pregunta.",
          };
        }
      }
      if (config.knowledgeBaseIds.length && this.deps.retrieve) {
        sources = await this.deps.retrieve(raw, config.knowledgeBaseIds, { ...ctx, purpose: "embedding" });
        if (config.guardrails.injectionDetection !== "off") {
          for (const s of sources) flags.injection.push(...detectPromptInjection(s.content));
        }
      }
      const history = config.memory.enabled ? (input.history ?? []).filter((m) => m.role === "user" || m.role === "assistant").slice(-config.memory.maxMessages) : [];
      messages = [{ role: "system", content: buildSystemPrompt(config, sources, input.variables) }, ...history, { role: "user", content: raw }];
    }

    let lastModel: string | undefined;
    for (;;) {
      // 1) Drain tool calls waiting to run (from the previous step or a resume).
      while (pending.length) {
        const call = pending[0]!;
        const tool = allowedTools.find((t) => t.name === call.name);
        const started = Date.now();
        if (!tool) {
          invocations.push({ toolCallId: call.id, name: call.name, args: redactValue(call.arguments), status: "not_allowed", durationMs: 0 });
          messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: JSON.stringify({ error: `Tool "${call.name}" is not available.` }) });
          pending.shift();
          continue;
        }
        if (needsApproval(tool, config)) {
          if (!decision || decision.toolCallId !== call.id) {
            return {
              ...this.base(usage, steps, sources, invocations, flags),
              status: "needs_approval",
              output: "",
              model: lastModel,
              pendingApproval: { toolCallId: call.id, toolName: call.name, args: call.arguments, risk: tool.risk },
              state: { messages, pendingCalls: pending, steps, usage, sources },
            };
          }
          const d = decision;
          decision = undefined;
          if (!d.approved) {
            const rec: ToolInvocationRecord = { toolCallId: call.id, name: call.name, args: redactValue(call.arguments), status: "denied", durationMs: 0, error: d.note };
            invocations.push(rec);
            await this.deps.onToolInvocation?.(rec, input);
            messages.push({
              role: "tool",
              toolCallId: call.id,
              name: call.name,
              content: JSON.stringify({ error: "A human reviewer rejected this action.", note: d.note ?? null }),
            });
            pending.shift();
            continue;
          }
        }
        let rec: ToolInvocationRecord;
        try {
          const result = await executeTool(tool, call.arguments, {
            organizationId: input.organizationId,
            agentId: input.agentId,
            conversationId: input.conversationId,
            workflowRunId: input.workflowRunId,
            userId: input.userId,
            config: config.toolConfig[tool.name],
            getSecret: this.deps.getSecret ? (name) => this.deps.getSecret!(input.organizationId, name) : undefined,
          });
          const text = redactSecrets(serializeToolResult(result));
          if (config.guardrails.injectionDetection !== "off") flags.injection.push(...detectPromptInjection(text));
          messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: wrapUntrusted(`tool:${call.name}`, text) });
          rec = { toolCallId: call.id, name: call.name, args: redactValue(call.arguments), status: "success", result: redactValue(result), durationMs: Date.now() - started };
        } catch (e) {
          const msg = e instanceof ToolError ? e.message : "Tool failed";
          messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: JSON.stringify({ error: msg }) });
          rec = { toolCallId: call.id, name: call.name, args: redactValue(call.arguments), status: "error", error: msg, durationMs: Date.now() - started };
        }
        invocations.push(rec);
        await this.deps.onToolInvocation?.(rec, input);
        pending.shift();
      }

      // 2) Limits.
      if (steps >= config.limits.maxSteps) {
        return this.fail(`Maximum number of steps (${config.limits.maxSteps}) reached`, { usage, steps, sources, invocations, flags });
      }
      if (config.limits.maxCostUsdPerRun !== null && usage.costUsd >= config.limits.maxCostUsdPerRun) {
        return this.fail(`Run cost limit reached ($${config.limits.maxCostUsdPerRun})`, { usage, steps, sources, invocations, flags });
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) return this.fail("Run timed out", { usage, steps, sources, invocations, flags });

      // 3) Ask the model.
      steps++;
      let res;
      try {
        res = await this.deps.router.chat(
          {
            model: config.model,
            fallbackModels: config.fallbackModels,
            messages,
            temperature: config.temperature,
            maxTokens: config.limits.maxOutputTokens,
            tools: toolSpecs.length ? toolSpecs : undefined,
            responseFormat: config.outputSchema ? { type: "json_schema", name: "agent_output", schema: config.outputSchema } : undefined,
            timeoutMs: Math.min(remaining, 120_000),
          },
          ctx,
        );
      } catch (e) {
        return this.fail(`LLM error: ${(e as Error).message.slice(0, 300)}`, { usage, steps, sources, invocations, flags });
      }
      lastModel = res.modelRef;
      usage = {
        inputTokens: usage.inputTokens + res.usage.inputTokens,
        outputTokens: usage.outputTokens + res.usage.outputTokens,
        costUsd: usage.costUsd + res.costUsd,
        llmCalls: usage.llmCalls + 1,
      };

      if (res.toolCalls.length) {
        messages.push({ role: "assistant", content: res.content, toolCalls: res.toolCalls });
        pending = [...res.toolCalls];
        continue;
      }

      // 4) Final answer.
      let output = res.content;
      if (config.guardrails.redactSecretsInOutput) output = redactSecrets(output);
      messages.push({ role: "assistant", content: output });
      let structured: Record<string, unknown> | null = null;
      let status: AgentRunStatus = "completed";
      if (config.outputSchema) {
        structured = extractJson(output);
        if (!structured) {
          return { ...this.fail("Model did not return valid JSON", { usage, steps, sources, invocations, flags }), output, model: lastModel };
        }
        const threshold = config.humanApproval.confidenceThreshold;
        const confidence = typeof structured.confidence === "number" ? structured.confidence : null;
        if ((threshold !== null && (confidence === null || confidence < threshold)) || structured.needs_human === true) status = "escalated";
      }
      return { ...this.base(usage, steps, sources, invocations, flags), status, output, structured, model: lastModel };
    }
  }

  private base(usage: RunUsage, steps: number, sources: RetrievedChunk[], invocations: ToolInvocationRecord[], flags: AgentRunResult["flags"]) {
    return { usage, steps, sources, toolInvocations: invocations, flags };
  }

  private fail(
    error: string,
    s: { usage: RunUsage; steps: number; sources: RetrievedChunk[]; invocations: ToolInvocationRecord[]; flags: AgentRunResult["flags"] },
  ): AgentRunResult {
    return { ...this.base(s.usage, s.steps, s.sources, s.invocations, s.flags), status: "failed", output: "", error };
  }
}
