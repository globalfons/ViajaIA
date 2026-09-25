import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createTestDb, createUser, TEST_DATABASE_URL, type TestDb, type TestUser } from "./harness";

/**
 * Row Level Security: tenant isolation for the core tenancy tables.
 * Requires TEST_DATABASE_URL (docker compose --profile test up -d testdb).
 */
describe.skipIf(!TEST_DATABASE_URL)("RLS · tenancy", () => {
  let db: TestDb;
  let platformAdmin: TestUser;
  let alice: TestUser; // owner of Acme
  let bob: TestUser; // owner of Globex
  let carol: TestUser; // viewer at Acme
  let mallory: TestUser; // no memberships
  let acme: string;
  let globex: string;

  beforeAll(async () => {
    db = await createTestDb();
    platformAdmin = await createUser(db, "admin@agency.test", { platformAdmin: true });
    alice = await createUser(db, "alice@acme.test");
    bob = await createUser(db, "bob@globex.test");
    carol = await createUser(db, "carol@acme.test");
    mallory = await createUser(db, "mallory@evil.test");

    // Platform admin creates both clients, then hands ownership over.
    acme = await as(
      db,
      platformAdmin,
      async (c) => (await c.query("select id from public.create_organization('Acme', 'acme')")).rows[0].id,
      { commit: true },
    );
    globex = await as(
      db,
      platformAdmin,
      async (c) => (await c.query("select id from public.create_organization('Globex', 'globex', 'PRO')")).rows[0].id,
      { commit: true },
    );
    await db.admin.query(
      `insert into public.memberships (organization_id, user_id, role) values
        ($1, $3, 'owner'), ($2, $4, 'owner'), ($1, $5, 'viewer')`,
      [acme, globex, alice.id, bob.id, carol.id],
    );
    await db.admin.query("insert into public.projects (organization_id, name) values ($1, 'Acme web'), ($2, 'Globex web')", [
      acme,
      globex,
    ]);
  }, 60_000);

  afterAll(async () => {
    await db?.close();
  });

  it("creates a profile for every new auth user", async () => {
    const { rows } = await db.admin.query("select email from public.profiles where id = $1", [alice.id]);
    expect(rows[0].email).toBe("alice@acme.test");
  });

  it("members only see their own organizations", async () => {
    const orgs = await as(db, alice, async (c) => (await c.query("select slug from public.organizations order by slug")).rows);
    expect(orgs.map((o) => o.slug)).toEqual(["acme"]);
  });

  it("members only see their own tenant's rows", async () => {
    const projects = await as(db, bob, async (c) => (await c.query("select name from public.projects")).rows);
    expect(projects.map((p) => p.name)).toEqual(["Globex web"]);
  });

  it("users without memberships see nothing", async () => {
    const counts = await as(db, mallory, async (c) => ({
      orgs: (await c.query("select count(*)::int n from public.organizations")).rows[0].n,
      projects: (await c.query("select count(*)::int n from public.projects")).rows[0].n,
      memberships: (await c.query("select count(*)::int n from public.memberships")).rows[0].n,
    }));
    expect(counts).toEqual({ orgs: 0, projects: 0, memberships: 0 });
  });

  it("anonymous requests are denied", async () => {
    await expect(as(db, null, (c) => c.query("select * from public.projects"))).rejects.toThrow(/permission denied/);
  });

  it("cannot insert rows into another tenant", async () => {
    await expect(
      as(db, alice, (c) => c.query("insert into public.projects (organization_id, name) values ($1, 'evil')", [globex])),
    ).rejects.toThrow(/row-level security/);
  });

  it("cannot move a row to another tenant", async () => {
    // Even a user who belongs to both tenants cannot re-parent a row.
    await db.admin.query("insert into public.memberships values ($1, $2, 'admin')", [globex, alice.id]);
    try {
      await expect(
        as(db, alice, (c) => c.query("update public.projects set organization_id = $1 where organization_id = $2", [globex, acme])),
      ).rejects.toThrow(/organization_id is immutable/);
    } finally {
      await db.admin.query("delete from public.memberships where organization_id = $1 and user_id = $2", [globex, alice.id]);
    }
  });

  it("updates and deletes on foreign rows silently affect nothing", async () => {
    const res = await as(db, alice, async (c) => ({
      upd: (await c.query("update public.projects set name = 'x' where organization_id = $1", [globex])).rowCount,
      del: (await c.query("delete from public.projects where organization_id = $1", [globex])).rowCount,
    }));
    expect(res).toEqual({ upd: 0, del: 0 });
  });

  it("viewers can read but not write", async () => {
    const rows = await as(db, carol, async (c) => (await c.query("select name from public.projects")).rows);
    expect(rows).toHaveLength(1);
    await expect(
      as(db, carol, (c) => c.query("insert into public.projects (organization_id, name) values ($1, 'nope')", [acme])),
    ).rejects.toThrow(/row-level security/);
  });

  it("clients cannot change their own plan, status or limits", async () => {
    await expect(
      as(db, alice, (c) => c.query("update public.organizations set plan_code = 'ENTERPRISE' where id = $1", [acme])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(db, alice, (c) => c.query("update public.organizations set status = 'active', limits = '{}' where id = $1", [acme])),
    ).rejects.toThrow(/permission denied/);
    const ok = await as(db, alice, (c) => c.query("update public.organizations set name = 'Acme SL' where id = $1", [acme]));
    expect(ok.rowCount).toBe(1);
  });

  it("users cannot promote themselves to platform admin", async () => {
    await expect(
      as(db, mallory, (c) => c.query("update public.profiles set is_platform_admin = true where id = $1", [mallory.id])),
    ).rejects.toThrow(/permission denied/);
  });

  it("only platform admins can create organizations (self-signup off)", async () => {
    await expect(as(db, mallory, (c) => c.query("select public.create_organization('Evil', 'evil')"))).rejects.toThrow(
      /only platform admins/,
    );
  });

  it("platform admins see every tenant", async () => {
    const n = await as(db, platformAdmin, async (c) => (await c.query("select count(*)::int n from public.projects")).rows[0].n);
    expect(n).toBe(2);
  });

  it("suspended organizations lock their members out of tenant data", async () => {
    await db.admin.query("update public.organizations set status = 'suspended' where id = $1", [globex]);
    try {
      const res = await as(db, bob, async (c) => ({
        org: (await c.query("select status from public.organizations")).rows[0]?.status,
        projects: (await c.query("select count(*)::int n from public.projects")).rows[0].n,
      }));
      // The member still sees the org (to show the suspension notice) but no data.
      expect(res).toEqual({ org: "suspended", projects: 0 });
    } finally {
      await db.admin.query("update public.organizations set status = 'active' where id = $1", [globex]);
    }
  });

  it("admins cannot grant the owner role; the last owner cannot leave", async () => {
    await db.admin.query("insert into public.memberships values ($1, $2, 'admin')", [acme, mallory.id]);
    try {
      await expect(
        as(db, mallory, (c) => c.query("update public.memberships set role = 'owner' where user_id = $1 and organization_id = $2", [mallory.id, acme])),
      ).rejects.toThrow(/row-level security/);
    } finally {
      await db.admin.query("delete from public.memberships where user_id = $1", [mallory.id]);
    }
    // The creating platform admin is also an owner: hand Acme over to Alice alone.
    await db.admin.query("delete from public.memberships where user_id = $1 and organization_id = $2", [platformAdmin.id, acme]);
    await expect(
      as(db, alice, (c) => c.query("delete from public.memberships where user_id = $1 and organization_id = $2", [alice.id, acme])),
    ).rejects.toThrow(/at least one owner/);
  });

  it("pending invitations are accepted for the invited email only", async () => {
    await db.admin.query("insert into public.invitations (organization_id, email, role) values ($1, 'dave@acme.test', 'member')", [acme]);
    const dave = await createUser(db, "dave@acme.test");
    expect(await as(db, mallory, async (c) => (await c.query("select public.accept_pending_invitations() n")).rows[0].n)).toBe(0);
    const accepted = await as(db, dave, async (c) => (await c.query("select public.accept_pending_invitations() n")).rows[0].n, {
      commit: true,
    });
    expect(accepted).toBe(1);
    const orgs = await as(db, dave, async (c) => (await c.query("select slug from public.organizations")).rows);
    expect(orgs.map((o) => o.slug)).toEqual(["acme"]);
  });

  it("writes an audit trail that tenants can read but not tamper with", async () => {
    const rows = await as(db, alice, async (c) => (await c.query("select action, target_type from public.audit_logs")).rows);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => ["insert", "update", "delete"].includes(r.action))).toBe(true);
    await expect(as(db, alice, (c) => c.query("delete from public.audit_logs"))).rejects.toThrow(/permission denied/);
    // Bob cannot read Acme's audit log.
    const foreign = await as(db, bob, async (c) => (await c.query("select count(*)::int n from public.audit_logs where organization_id = $1", [acme])).rows[0].n);
    expect(foreign).toBe(0);
  });

  it("deleting an organization cascades and keeps the audit trail", async () => {
    const tmp = await as(db, platformAdmin, async (c) => (await c.query("select id from public.create_organization('Tmp', 'tmp')")).rows[0].id, {
      commit: true,
    });
    await db.admin.query("delete from public.organizations where id = $1", [tmp]);
    const { rows } = await db.admin.query("select count(*)::int n from public.audit_logs where organization_id = $1", [tmp]);
    expect(rows[0].n).toBeGreaterThan(0);
  });
});
