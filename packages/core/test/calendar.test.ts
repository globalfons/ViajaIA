import { describe, expect, it, vi } from "vitest";
import {
  buildGoogleAuthUrl,
  computeFreeSlots,
  createCalendarTools,
  exchangeGoogleCode,
  executeTool,
  googleBusy,
  googleCreateEvent,
  normalizeCalendarSettings,
  refreshGoogleAccessToken,
  slotProblem,
  zonedTimeToUtc,
  type CalendarProvider,
} from "../src";

const S = normalizeCalendarSettings({ timeZone: "Europe/Madrid", days: [1, 2, 3, 4, 5], start: "09:00", end: "12:00", slotMinutes: 60, minNoticeMinutes: 60 });

describe("slot computation", () => {
  it("converts local wall time to UTC across DST", () => {
    expect(zonedTimeToUtc("2026-01-15", "09:00", "Europe/Madrid").toISOString()).toBe("2026-01-15T08:00:00.000Z");
    expect(zonedTimeToUtc("2026-07-15", "09:00", "Europe/Madrid").toISOString()).toBe("2026-07-15T07:00:00.000Z");
    expect(zonedTimeToUtc("2026-03-29", "10:00", "Europe/Madrid").toISOString()).toBe("2026-03-29T08:00:00.000Z");
  });

  it("normalizes untrusted settings", () => {
    expect(normalizeCalendarSettings({ timeZone: "Mars/Olympus", days: [9, 1, 1], start: "25:00", end: "08:00", slotMinutes: 5 })).toEqual({
      timeZone: "Europe/Madrid",
      days: [1],
      start: "09:00",
      end: "18:00",
      slotMinutes: 30,
      minNoticeMinutes: 120,
    });
  });

  it("lists free slots in working hours only, skipping busy time, weekends and short notice", () => {
    const now = new Date("2026-01-16T07:30:00Z"); // Friday 08:30 Madrid
    const busy = [{ start: new Date("2026-01-16T09:00:00Z"), end: new Date("2026-01-16T10:00:00Z") }]; // Fri 10-11 local
    const slots = computeFreeSlots(S, busy, { fromDate: "2026-01-16", days: 4, now });
    expect(slots.map((x) => x.start.toISOString())).toEqual([
      // Fri 09:00 is inside the 60 min notice (now 08:30 local); 10:00 is busy
      "2026-01-16T10:00:00.000Z", // Fri 11:00
      "2026-01-19T08:00:00.000Z", // Mon 09:00 (weekend skipped)
      "2026-01-19T09:00:00.000Z",
      "2026-01-19T10:00:00.000Z",
    ]);
  });

  it("validates a requested slot", () => {
    const now = new Date("2026-01-16T07:30:00Z");
    const slot = (iso: string, min = 60) => ({ start: new Date(iso), end: new Date(new Date(iso).getTime() + min * 60000) });
    expect(slotProblem(S, slot("2026-01-19T08:00:00Z"), [], now)).toBeNull();
    expect(slotProblem(S, slot("2026-01-17T08:00:00Z"), [], now)).toMatch(/working days/);
    expect(slotProblem(S, slot("2026-01-19T10:30:00Z"), [], now)).toMatch(/working hours/);
    expect(slotProblem(S, slot("2026-01-16T07:45:00Z"), [], now)).toMatch(/too soon/);
    expect(slotProblem(S, slot("2026-01-19T08:00:00Z"), [slot("2026-01-19T08:30:00Z")], now)).toMatch(/taken/);
  });
});

describe("calendar tools", () => {
  const provider = () => {
    const created: unknown[] = [];
    const p: CalendarProvider = {
      settings: { ...S, minNoticeMinutes: 0 },
      busy: vi.fn(async () => []),
      createEvent: vi.fn(async (e) => {
        created.push(e);
        return { id: "evt_1" };
      }),
    };
    return { p, created };
  };
  const ctx = { organizationId: "org-1", conversationId: "conv-1" };

  it("reports honestly when no calendar is connected", async () => {
    const [find] = createCalendarTools(async () => null);
    expect(await executeTool(find!, {}, ctx)).toMatchObject({ ok: false, error: expect.stringMatching(/No calendar is connected/) });
  });

  it("finds slots and books a confirmed one; rejects invalid times without writing", async () => {
    const { p, created } = provider();
    const [find, book] = createCalendarTools(async (c) => (c.organizationId === "org-1" ? p : null));
    const found = (await executeTool(find!, { from_date: "2099-01-05", days: 1 }, ctx)) as { slots: { start: string; label: string }[] };
    expect(found.slots.length).toBe(3);
    expect(found.slots[0]!.label).toMatch(/lunes/);
    const ok = await executeTool(book!, { start: found.slots[0]!.start, customer_name: "Ana", service: "Revisión", contact: "600111222" }, ctx);
    expect(ok).toMatchObject({ ok: true, eventId: "evt_1" });
    expect(created[0]).toMatchObject({ summary: "Revisión · Ana", description: expect.stringContaining("conversación conv-1") });
    const bad = await executeTool(book!, { start: "2099-01-04T10:00:00+01:00", customer_name: "Ana", service: "Revisión" }, ctx);
    expect(bad).toMatchObject({ ok: false, error: expect.stringMatching(/working days/) });
    expect(created.length).toBe(1);
    await expect(executeTool(book!, { start: "mañana", customer_name: "Ana", service: "x" }, ctx)).rejects.toThrow(/Invalid arguments/);
  });
});

describe("Google OAuth + Calendar client", () => {
  const endpoints = { auth: "http://g.test/auth", token: "http://g.test/token", revoke: "http://g.test/revoke", calendar: "http://g.test/calendar/v3" };

  it("builds a consent URL with offline access, minimal scopes and state", () => {
    const u = new URL(buildGoogleAuthUrl({ clientId: "cid", redirectUri: "https://app.test/cb", state: "st", endpoints }));
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("state")).toBe("st");
    expect(u.searchParams.get("scope")).toContain("calendar.events");
    expect(u.searchParams.get("scope")).not.toMatch(/auth\/calendar(\s|$)/); // never full calendar access
  });

  it("exchanges the code, requires a refresh token and reads the account email", async () => {
    const idToken = `x.${Buffer.from(JSON.stringify({ email: "citas@clinica.es" })).toString("base64url")}.y`;
    const f = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      const body = new URLSearchParams(String(init!.body));
      if (body.get("grant_type") === "authorization_code") return new Response(JSON.stringify({ access_token: "at", refresh_token: "rt", scope: "openid email https://www.googleapis.com/auth/calendar.events", id_token: idToken }));
      return new Response(JSON.stringify({ access_token: "at2" }));
    });
    const r = await exchangeGoogleCode({ code: "c", clientId: "cid", clientSecret: "cs", redirectUri: "https://app.test/cb", endpoints, fetch: f as unknown as typeof fetch });
    expect(r).toMatchObject({ refreshToken: "rt", email: "citas@clinica.es" });
    expect(await refreshGoogleAccessToken({ refreshToken: "rt", clientId: "cid", clientSecret: "cs", endpoints, fetch: f as unknown as typeof fetch })).toBe("at2");
    const noRefresh = vi.fn(async () => new Response(JSON.stringify({ access_token: "at" })));
    await expect(exchangeGoogleCode({ code: "c", clientId: "cid", clientSecret: "cs", redirectUri: "x", endpoints, fetch: noRefresh as unknown as typeof fetch })).rejects.toThrow(/refresh token/);
  });

  it("queries free/busy and creates events without notifying anyone", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const f = vi.fn(async (u: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(u), body: init?.body ? JSON.parse(String(init.body)) : null });
      if (String(u).endsWith("/freeBusy")) return new Response(JSON.stringify({ calendars: { primary: { busy: [{ start: "2026-01-19T08:00:00Z", end: "2026-01-19T09:00:00Z" }] } } }));
      return new Response(JSON.stringify({ id: "evt_9", htmlLink: "https://calendar.google.com/x" }));
    });
    const o = { accessToken: "at", endpoints, fetch: f as unknown as typeof fetch };
    const busy = await googleBusy(o, new Date("2026-01-19T00:00:00Z"), new Date("2026-01-20T00:00:00Z"));
    expect(busy[0]!.start.toISOString()).toBe("2026-01-19T08:00:00.000Z");
    const ev = await googleCreateEvent(o, { start: new Date("2026-01-19T10:00:00Z"), end: new Date("2026-01-19T11:00:00Z"), summary: "Revisión · Ana", description: "d", timeZone: "Europe/Madrid" });
    expect(ev.id).toBe("evt_9");
    expect(calls[1]!.url).toBe("http://g.test/calendar/v3/calendars/primary/events?sendUpdates=none");
    expect(calls[1]!.body).not.toHaveProperty("attendees");
  });
});
