import type { AgentRunResult } from "@dtn/core";
import type { AgentRow } from "@dtn/db";

export const presentAgent = (a: AgentRow) => ({
  id: a.id,
  name: a.name,
  description: a.description,
  status: a.status,
  template_key: a.template_key,
  version: a.version,
  config: a.config,
  created_at: a.created_at,
  updated_at: a.updated_at,
});

/** Never exposes the internal paused state or raw tool results. */
export const presentRun = (runId: string, r: AgentRunResult) => ({
  run_id: runId,
  status: r.status,
  output: r.output,
  structured: r.structured ?? null,
  pending_approval: r.pendingApproval,
  sources: r.sources.map((s) => ({ id: s.id, documentId: s.documentId, title: s.title, score: s.score })),
  tool_invocations: r.toolInvocations.map((t) => ({ name: t.name, status: t.status, durationMs: t.durationMs })),
  usage: r.usage,
  model: r.model,
  error: r.error,
});
