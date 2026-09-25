import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, TEST_DATABASE_URL, type TestDb } from "./harness";
import { migrate, MIGRATIONS_DIR } from "../src/migrate";

describe.skipIf(!TEST_DATABASE_URL)("migrations", () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb();
  }, 60_000);
  afterAll(async () => db?.close());

  it("are idempotent (re-running applies nothing)", async () => {
    expect(await migrate(db.url, MIGRATIONS_DIR, () => {})).toEqual([]);
  });

  it("enable RLS on every table in the public schema", async () => {
    const { rows } = await db.admin.query(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity and c.relname <> 'schema_migrations'`,
    );
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it("every table with organization_id has a tenant select policy", async () => {
    const { rows } = await db.admin.query(
      `select t.table_name from information_schema.columns t
       where t.table_schema = 'public' and t.column_name = 'organization_id'
         and t.table_name <> 'audit_logs'
         and not exists (
           select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.table_name and p.cmd in ('SELECT', 'ALL')
         )`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([]);
  });

  it("anon has no privileges on tenant tables", async () => {
    const { rows } = await db.admin.query(
      `select distinct table_name from information_schema.role_table_grants
       where grantee = 'anon' and table_schema = 'public' and table_name <> 'schema_migrations'`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([]);
  });
});
