import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

/**
 * Authentication gate. Supabase points at a closed local port, so getUser()
 * fails exactly like an anonymous/expired session would. No network needed.
 */
describe("proxy (auth gate)", () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:9";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  });
  afterEach(() => {
    process.env = { ...env };
  });

  const req = (path: string, headers: Record<string, string> = {}) =>
    new NextRequest(new URL(path, "http://localhost:3000"), { headers });

  it("redirects anonymous users from app pages to /login preserving the destination", async () => {
    const res = await proxy(req("/agents"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/agents");
  });

  it("returns 401 JSON for anonymous internal API calls", async () => {
    const res = await proxy(req("/api/internal/anything"));
    expect(res.status).toBe(401);
  });

  it("lets public routes through (login, webhooks, public API with its own auth)", async () => {
    for (const p of ["/login", "/api/webhooks/whatsapp", "/api/v1/agents", "/auth/callback"]) {
      const res = await proxy(req(p));
      expect(res.status, p).toBe(200);
    }
  });

  it("propagates or assigns a request id", async () => {
    const res = await proxy(req("/login", { "x-request-id": "req-123" }));
    expect(res.headers.get("x-request-id")).toBe("req-123");
    const res2 = await proxy(req("/login"));
    expect(res2.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("does not gate anything in setup mode (no Supabase configured)", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const res = await proxy(req("/dashboard"));
    expect(res.status).toBe(200);
  });
});
