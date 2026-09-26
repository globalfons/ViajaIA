import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { parseKeyRing } from "@dtn/core";
import { mockFetch } from "@dtn/core/testing/fake-llm";
import { as, createTestDb, createUser, TEST_DATABASE_URL, type TestDb, type TestUser } from "./harness";
import { advanceWorkflowRun, createWorkflow, getSecret, publishWorkflow, rotateSecrets, setSecret, startWorkflowRun } from "../src";

describe.skipIf(!TEST_DATABASE_URL)("encrypted secrets", () => {
  let db: TestDb;
  let pool: pg.Pool;
  let org: string;
  let other: string;
  let owner: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  const k1 = randomBytes(32).toString("base64");
  const env = process.env.SECRETS_ENCRYPTION_KEYS;

  beforeAll(async () => {
    process.env.SECRETS_ENCRYPTION_KEYS = `v1:${k1}`;
    db = await createTestDb();
    pool = new pg.Pool({ connectionString: db.url });
    org = (await db.admin.query("insert into public.organizations (name, slug) values ('A', 'a') returning id")).rows[0].id;
    other = (await db.admin.query("insert into public.organizations (name, slug) values ('B', 'b') returning id")).rows[0].id;
    owner = await createUser(db, "o@a.test");
    member = await createUser(db, "m@a.test");
    outsider = await createUser(db, "x@b.test");
    await db.admin.query("insert into public.memberships values ($1, $2, 'owner'), ($1, $3, 'member'), ($4, $5, 'owner')", [org, owner.id, member.id, other, outsider.id]);
  }, 60_000);

  afterAll(async () => {
    process.env.SECRETS_ENCRYPTION_KEYS = env;
    await pool?.end();
    await db?.close();
  });

  it("stores ciphertext only and decrypts per tenant", async () => {
    await setSecret(pool, org, "CRM_TOKEN", "tok-1234567890-secret");
    const { rows } = await db.admin.query("select ciphertext, hint, key_version from public.secrets");
    expect(rows[0].ciphertext).not.toContain("secret");
    expect(rows[0]).toMatchObject({ hint: "…cret", key_version: "v1" });
    expect(await getSecret(pool, org, "CRM_TOKEN")).toBe("tok-1234567890-secret");
    expect(await getSecret(pool, other, "CRM_TOKEN")).toBeNull();
  });

  it("a ciphertext copied into another org cannot be decrypted", async () => {
    await db.admin.query("insert into public.secrets (organization_id, name, ciphertext, key_version) select $1, name, ciphertext, key_version from public.secrets where organization_id = $2", [other, org]);
    await expect(getSecret(pool, other, "CRM_TOKEN")).rejects.toThrow();
    await db.admin.query("delete from public.secrets where organization_id = $1", [other]);
  });

  it("RLS: owners see metadata but never ciphertext; members and other orgs see nothing", async () => {
    const meta = await as(db, owner, async (c) => (await c.query("select name, hint from public.secrets")).rows);
    expect(meta).toEqual([{ name: "CRM_TOKEN", hint: "…cret" }]);
    await expect(as(db, owner, (c) => c.query("select ciphertext from public.secrets"))).rejects.toThrow(/permission denied/);
    expect(await as(db, member, async (c) => (await c.query("select count(*)::int n from public.secrets")).rows[0].n)).toBe(0);
    expect(await as(db, outsider, async (c) => (await c.query("select count(*)::int n from public.secrets")).rows[0].n)).toBe(0);
    await expect(as(db, owner, (c) => c.query("insert into public.secrets (organization_id, name, ciphertext, key_version) values ($1, 'X_Y', 'x', 'v1')", [org]))).rejects.toThrow(/permission denied/);
  });

  it("rotates to a new key version", async () => {
    const ring = parseKeyRing(`v1:${k1},v2:${randomBytes(32).toString("base64")}`);
    expect(await rotateSecrets(pool, ring)).toBe(1);
    expect(await getSecret(pool, org, "CRM_TOKEN", ring)).toBe("tok-1234567890-secret");
    const { rows } = await db.admin.query("select key_version from public.secrets");
    expect(rows[0].key_version).toBe("v2");
    await setSecret(pool, org, "CRM_TOKEN", "tok-1234567890-secret"); // back to v1 env ring for next tests
  });

  it("workflow webhooks resolve {{secret:X}} server-side and never persist it", async () => {
    const f = mockFetch(() => ({ body: { ok: true } }));
    const wf = await createWorkflow(pool, org, {
      name: "sync",
      graph: {
        nodes: [
          { id: "start", type: "start", data: {} },
          { id: "w", type: "webhook", data: { url: "https://crm.example.com/leads", headers: { Authorization: "Bearer {{secret:CRM_TOKEN}}" }, body: "{}" } },
          { id: "end", type: "end", data: {} },
        ],
        edges: [
          { id: "a", source: "start", target: "w" },
          { id: "b", source: "w", target: "end" },
        ],
      },
    });
    await publishWorkflow(pool, org, wf.id);
    const { runId } = await startWorkflowRun(pool, org, wf.id, {});
    await advanceWorkflowRun(pool, runId, { fetchImpl: f });
    expect((f.calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer tok-1234567890-secret");
    const { rows } = await pool.query("select status, state::text s from public.workflow_runs where id = $1", [runId]);
    expect(rows[0].status).toBe("completed");
    expect(rows[0].s).not.toContain("tok-1234567890");
  });
});
