import { describe, expect, it } from "vitest";
import { assertCan, can, ForbiddenError, PERMISSIONS, ROLES } from "../src/security/rbac";

describe("rbac", () => {
  it("viewers are read-only", () => {
    for (const p of Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[]) {
      if (can("viewer", p)) expect(p.endsWith(".read")).toBe(true);
    }
  });

  it("owners can do everything", () => {
    for (const p of Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[]) expect(can("owner", p)).toBe(true);
  });

  it("only owners manage billing", () => {
    expect(ROLES.filter((r) => can(r, "billing.manage"))).toEqual(["owner"]);
  });

  it("members cannot manage secrets or integrations", () => {
    expect(can("member", "secrets.manage")).toBe(false);
    expect(can("member", "integrations.manage")).toBe(false);
  });

  it("no role means no access; platform admin overrides", () => {
    expect(can(null, "org.read")).toBe(false);
    expect(can(null, "billing.manage", { platformAdmin: true })).toBe(true);
  });

  it("assertCan throws a 403 error", () => {
    expect(() => assertCan("viewer", "agents.write")).toThrow(ForbiddenError);
  });
});
