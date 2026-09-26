import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createTestDb, TEST_DATABASE_URL, type TestDb } from "./harness";
import { ConversationEventHub } from "../src";

describe.skipIf(!TEST_DATABASE_URL)("realtime conversation events", () => {
  let db: TestDb;
  let pool: pg.Pool;
  let hub: ConversationEventHub;
  let org: string;
  const conv = async () =>
    (await pool.query("insert into public.conversations (organization_id, channel_type, visitor_id) values ($1, 'web', 'v') returning id", [org])).rows[0].id as string;
  const nextEvent = (id: string, ms = 3000) =>
    new Promise<boolean>((resolve) => {
      let unsub: (() => void) | undefined;
      const t = setTimeout(() => (unsub?.(), resolve(false)), ms);
      void hub.subscribe(id, () => (clearTimeout(t), unsub?.(), resolve(true))).then((u) => (unsub = u));
    });

  beforeAll(async () => {
    db = await createTestDb();
    pool = new pg.Pool({ connectionString: db.url });
    hub = new ConversationEventHub(db.url);
    org = (await db.admin.query("insert into public.organizations (name, slug) values ('A', 'a') returning id")).rows[0].id;
  }, 60_000);
  afterAll(async () => {
    await hub?.close();
    await pool?.end();
    await db?.close();
  });

  it("notifies subscribers of the affected conversation only, with ids and no content", async () => {
    const a = await conv();
    const b = await conv();
    const gotA = nextEvent(a);
    const gotB = nextEvent(b, 800);
    await new Promise((r) => setTimeout(r, 100));
    await pool.query("insert into public.messages (organization_id, conversation_id, role, content) values ($1, $2, 'user', 'secreto del cliente')", [org, a]);
    expect(await gotA).toBe(true);
    expect(await gotB).toBe(false);

    // Payload shape: ids only.
    const listener = new pg.Client({ connectionString: db.url });
    await listener.connect();
    await listener.query("listen conversation_events");
    const payload = new Promise<string>((r) => listener.on("notification", (m) => r(m.payload ?? "")));
    await pool.query("update public.conversations set status = 'escalated' where id = $1", [a]);
    const p = await payload;
    expect(JSON.parse(p)).toEqual({ o: org, c: a });
    expect(p).not.toContain("secreto");
    await listener.end();
  });

  it("unsubscribing stops delivery", async () => {
    const a = await conv();
    let calls = 0;
    const unsub = await hub.subscribe(a, () => calls++);
    unsub();
    await pool.query("insert into public.messages (organization_id, conversation_id, role, content) values ($1, $2, 'user', 'x')", [org, a]);
    await new Promise((r) => setTimeout(r, 300));
    expect(calls).toBe(0);
    expect(hub.subscriberCount).toBe(0);
  });
});
