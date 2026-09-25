import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { closePool, generateApiKey } from "@dtn/db";
import { createTestDb, TEST_DATABASE_URL, type TestDb } from "../../../packages/db/test/harness";

/**
 * API tests: real route handlers + real Postgres (RLS schema) + a local HTTP
 * server that speaks the OpenAI Chat Completions format. No external calls.
 */
describe.skipIf(!TEST_DATABASE_URL)("API v1", () => {
  let db: TestDb;
  let llm: Server;
  let orgA: string;
  let orgB: string;
  const keys: Record<string, string> = {};
  let llmCalls = 0;

  async function key(org: string, scopes: string[]) {
    const k = generateApiKey();
    await db.admin.query("insert into public.api_keys (organization_id, name, prefix, key_hash, scopes) values ($1, 't', $2, $3, $4)", [org, k.prefix, k.hash, scopes]);
    return k.key;
  }

  beforeAll(async () => {
    db = await createTestDb();
    llm = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        llmCalls++;
        const msgs = JSON.parse(body).messages as { role: string; content: string }[];
        const last = msgs.filter((m) => m.role === "user").at(-1)?.content ?? "";
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ choices: [{ message: { content: `eco: ${last}` }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
      });
    });
    await new Promise<void>((r) => llm.listen(0, "127.0.0.1", r));
    process.env.DATABASE_URL = db.url;
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${(llm.address() as AddressInfo).port}`;

    orgA = (await db.admin.query("insert into public.organizations (name, slug, limits) values ('A', 'a', '{\"requests_per_minute\": 1000}') returning id")).rows[0].id;
    orgB = (await db.admin.query("insert into public.organizations (name, slug, limits) values ('B', 'b', '{\"requests_per_minute\": 2}') returning id")).rows[0].id;
    await db.admin.query("insert into public.llm_models (provider, model, input_per_mtok, output_per_mtok) values ('openai', 'm', 1, 1)");
    keys.full = await key(orgA, ["agents:read", "agents:write", "agents:run", "usage:read"]);
    keys.readOnly = await key(orgA, ["agents:read"]);
    keys.b = await key(orgB, ["agents:read", "agents:write"]);
  }, 60_000);

  afterAll(async () => {
    await closePool();
    llm?.close();
    await db?.close();
  });

  const call = async (mod: Promise<Record<string, unknown>>, method: string, path: string, opts: { key?: string; body?: unknown; params?: Record<string, string> } = {}) => {
    const handler = (await mod)[method] as (req: NextRequest, ctx: { params: Promise<unknown> }) => Promise<Response>;
    const req = new NextRequest(new URL(path, "http://localhost"), {
      method,
      headers: { ...(opts.key ? { authorization: `Bearer ${opts.key}` } : {}), ...(opts.body ? { "content-type": "application/json" } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) });
    return { status: res.status, body: res.status === 204 ? null : await res.json(), headers: res.headers };
  };
  const agentsRoute = () => import("@/app/api/v1/agents/route");
  const agentRoute = () => import("@/app/api/v1/agents/[id]/route");
  const runsRoute = () => import("@/app/api/v1/agents/[id]/runs/route");

  it("rejects missing, malformed and unknown keys with 401", async () => {
    expect((await call(agentsRoute(), "GET", "/api/v1/agents")).status).toBe(401);
    expect((await call(agentsRoute(), "GET", "/api/v1/agents", { key: "garbage" })).status).toBe(401);
    expect((await call(agentsRoute(), "GET", "/api/v1/agents", { key: generateApiKey().key })).status).toBe(401);
  });

  it("enforces scopes with 403", async () => {
    const res = await call(agentsRoute(), "POST", "/api/v1/agents", { key: keys.readOnly, body: { name: "x", config: { model: "openai:m" } } });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("insufficient_scope");
  });

  let agentId: string;
  it("creates an agent from a template (201) and validates input (400)", async () => {
    const bad = await call(agentsRoute(), "POST", "/api/v1/agents", { key: keys.full, body: { name: "", config: {} } });
    expect(bad.status).toBe(400);
    const res = await call(agentsRoute(), "POST", "/api/v1/agents", {
      key: keys.full,
      body: { name: "Soporte", template: "customer_support", status: "active", config: { model: "openai:m", outputSchema: null } },
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: "Soporte", status: "active", template_key: "customer_support", version: 1 });
    expect(res.headers.get("x-request-id")).toBeTruthy();
    agentId = res.body.data.id;
  });

  it("isolates tenants: another org's key gets 404 and an empty list", async () => {
    expect((await call(agentRoute(), "GET", `/api/v1/agents/${agentId}`, { key: keys.b, params: { id: agentId } })).status).toBe(404);
    expect((await call(agentsRoute(), "GET", "/api/v1/agents", { key: keys.b })).body.data).toEqual([]);
  });

  it("runs the agent through the LLM router and records usage", async () => {
    const res = await call(runsRoute(), "POST", `/api/v1/agents/${agentId}/runs`, { key: keys.full, body: { message: "hola" }, params: { id: agentId } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "completed", output: "eco: hola", model: "openai:m" });
    expect(res.body).not.toHaveProperty("state");
    const { rows } = await db.admin.query("select count(*)::int n from public.usage_events where organization_id = $1", [orgA]);
    expect(rows[0].n).toBe(1);
  });

  it("updates (new version) and archives agents", async () => {
    const upd = await call(agentRoute(), "PATCH", `/api/v1/agents/${agentId}`, { key: keys.full, body: { config: { temperature: 0.9 } }, params: { id: agentId } });
    expect(upd.body.data).toMatchObject({ version: 2, config: { temperature: 0.9 } });
    expect((await call(agentRoute(), "DELETE", `/api/v1/agents/${agentId}`, { key: keys.full, params: { id: agentId } })).status).toBe(204);
    // Archived agents cannot be run.
    const run = await call(runsRoute(), "POST", `/api/v1/agents/${agentId}/runs`, { key: keys.full, body: { message: "hola" }, params: { id: agentId } });
    expect(run.status).toBe(404);
  });

  it("rate limits per key using the plan's requests_per_minute", async () => {
    const fresh = await key(orgB, ["agents:read"]); // org B allows 2 requests/minute
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await call(agentsRoute(), "GET", "/api/v1/agents", { key: fresh })).status);
    expect(statuses).toEqual([200, 200, 429]);
  });

  it("returns 402 when a plan limit is reached", async () => {
    await db.admin.query("update public.organizations set limits = limits || '{\"max_agents\": 0}' where id = $1", [orgA]);
    const res = await call(agentsRoute(), "POST", "/api/v1/agents", { key: keys.full, body: { name: "x", config: { model: "openai:m" } } });
    expect(res.status).toBe(402);
  });

  it("rejects non-JSON bodies with 415", async () => {
    const handler = (await agentsRoute()).POST as (r: NextRequest, c: { params: Promise<unknown> }) => Promise<Response>;
    const res = await handler(
      new NextRequest("http://localhost/api/v1/agents", { method: "POST", headers: { authorization: `Bearer ${keys.full}`, "content-type": "text/plain" }, body: "x" }),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(415);
  });

  it("suspended organizations lose API access", async () => {
    await db.admin.query("update public.organizations set status = 'suspended' where id = $1", [orgA]);
    expect((await call(agentsRoute(), "GET", "/api/v1/agents", { key: keys.full })).status).toBe(401);
  });

  it("workflows: start a published run (202), poll it, and deny other tenants", async () => {
    await db.admin.query("update public.organizations set status = 'active', limits = '{\"requests_per_minute\": 1000}' where id = $1", [orgA]);
    const { createWorkflow, publishWorkflow } = await import("@dtn/db");
    const { getPool } = await import("@dtn/db");
    const wf = await createWorkflow(getPool(), orgA, { name: "API wf" });
    const wfKey = await key(orgA, ["workflows:read", "workflows:run"]);
    const notPublished = await call(import("@/app/api/v1/workflows/[id]/runs/route"), "POST", `/api/v1/workflows/${wf.id}/runs`, { key: wfKey, body: { input: {} }, params: { id: wf.id } });
    expect(notPublished.status).toBe(404);
    await publishWorkflow(getPool(), orgA, wf.id);
    const started = await call(import("@/app/api/v1/workflows/[id]/runs/route"), "POST", `/api/v1/workflows/${wf.id}/runs`, { key: wfKey, body: { input: { a: 1 } }, params: { id: wf.id } });
    expect(started).toMatchObject({ status: 202, body: { status: "queued", version: 1 } });
    const polled = await call(import("@/app/api/v1/workflow-runs/[id]/route"), "GET", "/", { key: wfKey, params: { id: started.body.run_id } });
    expect(polled.body.data).toMatchObject({ status: "queued", input: { a: 1 }, nodes: { start: { status: "pending" } } });
    const bKey = await key(orgB, ["workflows:read"]);
    expect((await call(import("@/app/api/v1/workflow-runs/[id]/route"), "GET", "/", { key: bKey, params: { id: started.body.run_id } })).status).toBe(404);
  });

  it("never called a real provider", () => {
    expect(llmCalls).toBe(1);
  });
});
