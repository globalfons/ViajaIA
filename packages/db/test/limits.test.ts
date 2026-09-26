import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { FakeProvider } from "@dtn/core/testing/fake-llm";
import { createTestDb, TEST_DATABASE_URL, type TestDb } from "./harness";
import { BudgetGuard, createAgent, createWorkflow, decideLimitApproval, LimitApprovalRequiredError, publishWorkflow, runAgent, startWorkflowRun } from "../src";
import { LimitExceededError } from "@dtn/core";

describe.skipIf(!TEST_DATABASE_URL)("limit policy: block vs require admin approval", () => {
  let db: TestDb;
  let pool: pg.Pool;
  let blockOrg: string;
  let approvalOrg: string;
  const spend = (org: string, usd: number) => db.admin.query("insert into public.usage_events (organization_id, provider, model, cost_usd) values ($1, 'openai', 'm', $2)", [org, usd]);

  beforeAll(async () => {
    db = await createTestDb();
    pool = new pg.Pool({ connectionString: db.url });
    blockOrg = (await db.admin.query("insert into public.organizations (name, slug, limits) values ('Block', 'block', '{\"monthly_llm_cost_usd\": 10}') returning id")).rows[0].id;
    approvalOrg = (await db.admin.query("insert into public.organizations (name, slug, limits, limit_policy) values ('Approve', 'approve', '{\"monthly_llm_cost_usd\": 10, \"max_workflow_runs_per_month\": 1}', 'require_approval') returning id")).rows[0].id;
    await spend(blockOrg, 12);
    await spend(approvalOrg, 12);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await db?.close();
  });

  it("BLOCK: calls are refused without raising approvals", async () => {
    const err = await new BudgetGuard(pool).check({ organizationId: blockOrg }).catch((e) => e);
    expect(err).toBeInstanceOf(LimitExceededError);
    expect(err).not.toBeInstanceOf(LimitApprovalRequiredError);
    expect((await pool.query("select count(*)::int n from public.limit_approvals where organization_id = $1", [blockOrg])).rows[0].n).toBe(0);
  });

  it("REQUIRE_APPROVAL: raises exactly one pending request per limit and month", async () => {
    await expect(new BudgetGuard(pool).check({ organizationId: approvalOrg })).rejects.toBeInstanceOf(LimitApprovalRequiredError);
    await expect(new BudgetGuard(pool).check({ organizationId: approvalOrg })).rejects.toBeInstanceOf(LimitApprovalRequiredError);
    const { rows } = await pool.query("select limit_key, status, limit_value::float, used_value::float from public.limit_approvals where organization_id = $1", [approvalOrg]);
    expect(rows).toEqual([{ limit_key: "monthly_llm_cost_usd", status: "pending", limit_value: 10, used_value: 12 }]);
  });

  it("the agent run fails clearly while waiting for approval", async () => {
    const agent = await createAgent(pool, approvalOrg, { name: "a", status: "active", config: { model: "openai:m" } });
    const llm = new FakeProvider("openai", [{ content: "no debería llamarse" }]);
    const { result } = await runAgent({ db: pool, organizationId: approvalOrg, agentId: agent.id, message: "hola", source: "api", runtime: { providers: { openai: llm } } });
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/Waiting for administrator approval/);
    expect(llm.requests).toHaveLength(0);
  });

  it("approval with extra headroom lets the client continue; rejection keeps it blocked", async () => {
    const pending = (await pool.query("select id from public.limit_approvals where organization_id = $1 and status = 'pending'", [approvalOrg])).rows[0].id;
    await decideLimitApproval(pool, pending, { approved: true, extra: 5 });
    await expect(new BudgetGuard(pool).check({ organizationId: approvalOrg })).resolves.toBeUndefined(); // 12 < 10 + 5
    await spend(approvalOrg, 4); // 16 >= 15 → new request
    await expect(new BudgetGuard(pool).check({ organizationId: approvalOrg })).rejects.toBeInstanceOf(LimitApprovalRequiredError);
    const second = (await pool.query("select id from public.limit_approvals where organization_id = $1 and status = 'pending'", [approvalOrg])).rows[0].id;
    await decideLimitApproval(pool, second, { approved: false, note: "Revisar consumo con el cliente" });
    await expect(decideLimitApproval(pool, second, { approved: true, extra: 100 })).rejects.toThrow(/No pending/);
    await expect(new BudgetGuard(pool).check({ organizationId: approvalOrg })).rejects.toBeInstanceOf(LimitApprovalRequiredError);
  });

  it("max executions: workflow runs per month follow the same policy", async () => {
    const wf = await createWorkflow(pool, approvalOrg, { name: "w" });
    await publishWorkflow(pool, approvalOrg, wf.id);
    await startWorkflowRun(pool, approvalOrg, wf.id, {});
    await expect(startWorkflowRun(pool, approvalOrg, wf.id, {})).rejects.toBeInstanceOf(LimitApprovalRequiredError);
    const { rows } = await pool.query("select limit_key from public.limit_approvals where organization_id = $1 and limit_key = 'max_workflow_runs_per_month'", [approvalOrg]);
    expect(rows).toHaveLength(1);
  });
});
