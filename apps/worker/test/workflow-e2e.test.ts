import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { z } from "zod";
import type { ToolDefinition } from "@dtn/core";
import { FakeProvider } from "@dtn/core/testing/fake-llm";
import {
  createAgent,
  createWorkflow,
  decideApproval,
  enqueueJob,
  NotFoundError,
  publishWorkflow,
  saveWorkflowVersion,
  startWorkflowRun,
  wakeDueRuns,
  WorkflowValidationError,
} from "@dtn/db";
import { createTestDb, TEST_DATABASE_URL, type TestDb } from "../../../packages/db/test/harness";
import { createHandlers } from "../src/handlers";
import { processBatch } from "../src/loop";

describe.skipIf(!TEST_DATABASE_URL)("worker · workflows end to end", () => {
  let db: TestDb;
  let pool: pg.Pool;
  let org: string;
  let otherOrg: string;
  let agentId: string;
  const notify = vi.fn(async (args: { level: string; email: string }) => ({ notified: args.email, level: args.level }));
  const notifyTool: ToolDefinition = { name: "notify_sales", description: "", risk: "write", parameters: z.object({ level: z.string(), email: z.string() }), execute: notify as never };
  let now = new Date();
  const provider = new FakeProvider("openai");
  const handlers = () => createHandlers({ extraTools: [notifyTool], agentRuntime: { providers: { openai: provider } }, now: () => now });
  const drain = async () => {
    for (let i = 0; i < 20; i++) if ((await processBatch(pool, handlers(), "test-worker")) === 0) break;
  };
  const run = async (id: string) => (await pool.query("select status, output, error, state from public.workflow_runs where id = $1", [id])).rows[0];

  const graph = (agent: string) => ({
    nodes: [
      { id: "start", type: "start", data: {} },
      { id: "classify", type: "agent", data: { agentId: agent, message: "Puntúa este lead: {{input.message}}" } },
      { id: "hot", type: "condition", data: { rules: [{ left: "{{nodes.classify.output.structured.score}}", op: "gte", right: 70 }] } },
      { id: "review", type: "approval", data: { title: "¿Pasar {{input.email}} a ventas?", payload: "{{nodes.classify.output.structured}}" } },
      { id: "notify", type: "tool", data: { tool: "notify_sales", args: { level: "hot", email: "{{input.email}}" } } },
      { id: "wait", type: "delay", data: { seconds: 86400 } },
      { id: "end", type: "end", data: { output: { notified: "{{nodes.notify.output.notified}}", score: "{{nodes.classify.output.structured.score}}" } } },
      { id: "cold", type: "end", data: { output: { nurture: true } } },
    ],
    edges: [
      { id: "e1", source: "start", target: "classify" },
      { id: "e2", source: "classify", target: "hot" },
      { id: "e3", source: "hot", target: "review", sourceHandle: "true" },
      { id: "e4", source: "hot", target: "wait", sourceHandle: "false" },
      { id: "e5", source: "review", target: "notify", sourceHandle: "approved" },
      { id: "e6", source: "notify", target: "end" },
      { id: "e7", source: "wait", target: "cold" },
    ],
  });

  beforeAll(async () => {
    db = await createTestDb();
    pool = new pg.Pool({ connectionString: db.url });
    org = (await db.admin.query("insert into public.organizations (name, slug) values ('A', 'a') returning id")).rows[0].id;
    otherOrg = (await db.admin.query("insert into public.organizations (name, slug) values ('B', 'b') returning id")).rows[0].id;
    const schema = { type: "object", properties: { score: { type: "number" } } };
    agentId = (await createAgent(pool, org, { name: "Scorer", status: "active", config: { model: "openai:m", outputSchema: schema } })).id;
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await db?.close();
  });

  it("refuses to publish invalid graphs or graphs using another tenant's agent", async () => {
    const wf = await createWorkflow(pool, org, { name: "Broken" });
    await saveWorkflowVersion(pool, org, wf.id, { nodes: [{ id: "start", type: "start", data: {} }], edges: [] });
    await expect(publishWorkflow(pool, org, wf.id)).rejects.toBeInstanceOf(WorkflowValidationError);

    const foreignAgent = (await createAgent(pool, otherOrg, { name: "Theirs", config: { model: "openai:m" } })).id;
    const wf2 = await createWorkflow(pool, org, { name: "Sneaky", graph: graph(foreignAgent) });
    await expect(publishWorkflow(pool, org, wf2.id)).rejects.toThrow(/does not exist in this organization/);
  });

  it("hot lead: agent → condition → human approval → tool → end", async () => {
    const wf = await createWorkflow(pool, org, { name: "Leads", graph: graph(agentId) });
    await publishWorkflow(pool, org, wf.id);
    provider.push({ content: '{"score": 85}' });
    const { runId } = await startWorkflowRun(pool, org, wf.id, { email: "lead@x.test", message: "Quiero 50 licencias" });

    await drain();
    expect((await run(runId)).status).toBe("waiting");
    const { rows: approvals } = await pool.query("select id, title, payload from public.approvals where workflow_run_id = $1", [runId]);
    expect(approvals[0]).toMatchObject({ title: "¿Pasar lead@x.test a ventas?", payload: { score: 85 } });
    expect(notify).not.toHaveBeenCalled();

    // Another tenant cannot decide it.
    await expect(decideApproval(pool, otherOrg, approvals[0].id, { approved: true })).rejects.toBeInstanceOf(NotFoundError);

    await decideApproval(pool, org, approvals[0].id, { approved: true, note: "ok" });
    await expect(decideApproval(pool, org, approvals[0].id, { approved: true })).rejects.toBeInstanceOf(NotFoundError); // once only
    await drain();

    const done = await run(runId);
    expect(done).toMatchObject({ status: "completed", output: { notified: "lead@x.test", score: 85 } });
    expect(notify).toHaveBeenCalledOnce();

    const steps = await pool.query("select node_id, node_type, status from public.workflow_step_runs where run_id = $1 order by id", [runId]);
    expect(steps.rows.map((r) => `${r.node_id}:${r.status}`)).toEqual(expect.arrayContaining(["classify:succeeded", "hot:succeeded", "notify:succeeded", "end:succeeded"]));
    const agentRuns = await pool.query("select workflow_run_id, workflow_node_id from public.agent_runs where workflow_run_id = $1", [runId]);
    expect(agentRuns.rows).toEqual([{ workflow_run_id: runId, workflow_node_id: "classify" }]);
    const usage = await pool.query("select workflow_run_id from public.usage_events where workflow_run_id = $1", [runId]);
    expect(usage.rows).toHaveLength(1);
  });

  it("cold lead waits one day, then the scheduler wakes it up", async () => {
    const wf = await createWorkflow(pool, org, { name: "Leads 2", graph: graph(agentId) });
    await publishWorkflow(pool, org, wf.id);
    provider.push({ content: '{"score": 20}' });
    const { runId } = await startWorkflowRun(pool, org, wf.id, { email: "cold@x.test", message: "info" });
    await drain();
    expect((await run(runId)).status).toBe("waiting");

    // Nothing happens before the wake-up time.
    expect(await wakeDueRuns(pool)).toBe(0);
    // Time travel: the DB clock and the engine clock both move past next_wake_at.
    await pool.query("update public.workflow_runs set next_wake_at = now() - interval '1 second' where id = $1", [runId]);
    now = new Date(Date.now() + 86_401_000);
    expect(await wakeDueRuns(pool)).toBe(1);
    await drain();
    expect(await run(runId)).toMatchObject({ status: "completed", output: { nurture: true } });
  });

  it("failing nodes fail the run with an explicit error", async () => {
    const wf = await createWorkflow(pool, org, {
      name: "Bad tool",
      graph: {
        nodes: [
          { id: "start", type: "start", data: {} },
          { id: "t", type: "tool", data: { tool: "does_not_exist" } },
          { id: "end", type: "end", data: {} },
        ],
        edges: [
          { id: "a", source: "start", target: "t" },
          { id: "b", source: "t", target: "end" },
        ],
      },
    });
    await publishWorkflow(pool, org, wf.id);
    const { runId } = await startWorkflowRun(pool, org, wf.id, {});
    await drain();
    expect(await run(runId)).toMatchObject({ status: "failed", error: expect.stringMatching(/t: Tool "does_not_exist" is not available/) });
  });

  it("deduplicates concurrent advance jobs for the same run", async () => {
    const first = await enqueueJob(pool, { type: "workflow.advance", payload: { runId: "x" }, dedupeKey: "workflow.advance:dup" });
    const second = await enqueueJob(pool, { type: "workflow.advance", payload: { runId: "x" }, dedupeKey: "workflow.advance:dup" });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    await pool.query("delete from public.jobs where dedupe_key = 'workflow.advance:dup'");
  });

  it("suspended organizations stop their runs", async () => {
    const wf = await createWorkflow(pool, org, { name: "Susp", graph: graph(agentId) });
    await publishWorkflow(pool, org, wf.id);
    const { runId } = await startWorkflowRun(pool, org, wf.id, { email: "a", message: "b" });
    await db.admin.query("update public.organizations set status = 'suspended' where id = $1", [org]);
    await drain();
    await db.admin.query("update public.organizations set status = 'active' where id = $1", [org]);
    expect(await run(runId)).toMatchObject({ status: "failed", error: "Organization suspended" });
  });
});
