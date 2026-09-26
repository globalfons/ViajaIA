import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { createCalendarTools, executeTool } from "@dtn/core";
import { as, createTestDb, createUser, TEST_DATABASE_URL, type TestDb, type TestUser } from "./harness";
import { calendarResolver, disconnectGoogleCalendar, getCalendarConnection, getSecret, GOOGLE_REFRESH_SECRET, saveGoogleCalendarConnection, updateCalendarSettings } from "../src";

describe.skipIf(!TEST_DATABASE_URL)("Google Calendar connection", () => {
  let db: TestDb;
  let pool: pg.Pool;
  let org: string;
  let other: string;
  let owner: TestUser;
  let outsider: TestUser;
  const env = { GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "cs", GOOGLE_OAUTH_TOKEN_URL: "http://g.test/token", GOOGLE_OAUTH_REVOKE_URL: "http://g.test/revoke", GOOGLE_CALENDAR_BASE_URL: "http://g.test/cal" };
  const keys = process.env.SECRETS_ENCRYPTION_KEYS;
  let tokenStatus = 200;
  const events: unknown[] = [];
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u === "http://g.test/token") {
      const body = new URLSearchParams(String(init!.body));
      if (tokenStatus !== 200 || body.get("refresh_token") !== "rt-org-a") return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
      return new Response(JSON.stringify({ access_token: "at-a" }));
    }
    if (u === "http://g.test/revoke") return new Response("{}");
    if (u.endsWith("/freeBusy")) return new Response(JSON.stringify({ calendars: { primary: { busy: [] } } }));
    events.push(JSON.parse(String(init!.body)));
    return new Response(JSON.stringify({ id: "evt_1" }));
  });

  beforeAll(async () => {
    process.env.SECRETS_ENCRYPTION_KEYS = `v1:${randomBytes(32).toString("base64")}`;
    db = await createTestDb();
    pool = new pg.Pool({ connectionString: db.url });
    org = (await db.admin.query("insert into public.organizations (name, slug) values ('A', 'a') returning id")).rows[0].id;
    other = (await db.admin.query("insert into public.organizations (name, slug) values ('B', 'b') returning id")).rows[0].id;
    owner = await createUser(db, "o@a.test");
    outsider = await createUser(db, "x@b.test");
    await db.admin.query("insert into public.memberships values ($1, $2, 'owner'), ($3, $4, 'owner')", [org, owner.id, other, outsider.id]);
  }, 60_000);

  afterAll(async () => {
    process.env.SECRETS_ENCRYPTION_KEYS = keys;
    await pool?.end();
    await db?.close();
  });

  it("stores the refresh token encrypted and only metadata in the connection", async () => {
    await saveGoogleCalendarConnection(pool, org, { refreshToken: "rt-org-a", account: "agenda@a.test" }, owner.id);
    const raw = (await pool.query("select * from public.integration_connections where organization_id = $1", [org])).rows[0];
    expect(JSON.stringify(raw)).not.toContain("rt-org-a");
    expect(await getSecret(pool, org, GOOGLE_REFRESH_SECRET)).toBe("rt-org-a");
    expect((await getCalendarConnection(pool, org))?.settings.timeZone).toBe("Europe/Madrid");
    const s = await updateCalendarSettings(pool, org, { days: [0, 1, 2, 3, 4, 5, 6], start: "00:00", end: "23:30", slotMinutes: 30, minNoticeMinutes: 0, timeZone: "Europe/Madrid" });
    expect(s.days.length).toBe(7);
  });

  it("tools use the organization's own calendar; other orgs get 'not connected'", async () => {
    const [find, book] = createCalendarTools(calendarResolver(pool, env, f as unknown as typeof fetch));
    const found = (await executeTool(find!, { days: 2 }, { organizationId: org })) as { ok: boolean; slots: { start: string }[] };
    expect(found.ok).toBe(true);
    expect(found.slots.length).toBeGreaterThan(0);
    const booked = await executeTool(book!, { start: found.slots[0]!.start, customer_name: "Ana", service: "Revisión" }, { organizationId: org, conversationId: "c1" });
    expect(booked).toMatchObject({ ok: true, eventId: "evt_1" });
    expect(events[0]).toMatchObject({ summary: "Revisión · Ana", start: { timeZone: "Europe/Madrid" } });
    expect(await executeTool(find!, {}, { organizationId: other })).toMatchObject({ ok: false });
  });

  it("revoked consent marks the connection for reconnection instead of failing silently", async () => {
    tokenStatus = 400;
    const [find] = createCalendarTools(calendarResolver(pool, env, f as unknown as typeof fetch));
    expect(await executeTool(find!, {}, { organizationId: org })).toMatchObject({ ok: false });
    expect(await getCalendarConnection(pool, org)).toMatchObject({ status: "error", last_error: expect.stringMatching(/vuelve a conectar/) });
    tokenStatus = 200;
    await executeTool(find!, {}, { organizationId: org });
    expect((await getCalendarConnection(pool, org))?.status).toBe("connected");
  });

  it("RLS: members read, nobody writes directly; outsiders see nothing", async () => {
    expect(await as(db, owner, async (c) => (await c.query("select account from public.integration_connections")).rows)).toEqual([{ account: "agenda@a.test" }]);
    expect(await as(db, outsider, async (c) => (await c.query("select 1 from public.integration_connections where organization_id = $1", [org])).rowCount)).toBe(0);
    const upd = await as(db, owner, (c) => c.query("update public.integration_connections set account = 'x' where organization_id = $1", [org]).then((r) => r.rowCount).catch(() => 0));
    expect(upd).toBe(0);
  });

  it("disconnect revokes at Google and deletes token and connection", async () => {
    await disconnectGoogleCalendar(pool, org, env, f as unknown as typeof fetch);
    expect(f.mock.calls.some(([u]) => String(u) === "http://g.test/revoke")).toBe(true);
    expect(await getSecret(pool, org, GOOGLE_REFRESH_SECRET)).toBeNull();
    expect(await getCalendarConnection(pool, org)).toBeNull();
  });
});
