import { describe, expect, it } from "vitest";
import { loadServerEnv } from "../src/config/env";

describe("loadServerEnv", () => {
  it("applies safe defaults in development", () => {
    const env = loadServerEnv({});
    expect(env.APP_ENV).toBe("development");
    expect(env.ALLOW_INSECURE_OUTBOUND).toBe(false);
    expect(env.EMBEDDING_DIMENSIONS).toBe(1536);
  });

  it("requires core secrets in production", () => {
    expect(() => loadServerEnv({ APP_ENV: "production" })).toThrow(/SECRETS_ENCRYPTION_KEYS is required/);
  });

  it("refuses insecure outbound mode in production", () => {
    expect(() =>
      loadServerEnv({
        APP_ENV: "production",
        NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
        SUPABASE_SERVICE_ROLE_KEY: "service",
        DATABASE_URL: "postgres://db",
        SECRETS_ENCRYPTION_KEYS: "v1:abc",
        ALLOW_INSECURE_OUTBOUND: "true",
      }),
    ).toThrow(/ALLOW_INSECURE_OUTBOUND/);
  });
});
