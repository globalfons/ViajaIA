import { describe, expect, it } from "vitest";
import { buildOpenApi } from "@/lib/api/openapi";
import { createAgentBody, runAgentBody } from "@/lib/api/schemas";

describe("OpenAPI document", () => {
  const doc = buildOpenApi("https://app.test");

  it("is OpenAPI 3 with bearer auth and all v1 paths", () => {
    expect(doc.openapi).toMatch(/^3\./);
    expect(doc.components.securitySchemes.bearerAuth).toMatchObject({ type: "http", scheme: "bearer" });
    expect(Object.keys(doc.paths)).toEqual(["/agents", "/agents/{id}", "/agents/{id}/runs", "/runs/{id}/decision", "/workflows", "/workflows/{id}", "/workflows/{id}/runs", "/workflow-runs/{id}", "/knowledge-bases", "/knowledge-bases/{id}/documents", "/knowledge-bases/{id}/search", "/usage"]);
    expect(doc.servers[0]!.url).toBe("https://app.test/api/v1");
  });

  it("every $ref resolves to a component", () => {
    const refs = [...JSON.stringify(doc).matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g)].map((m) => m[1]!);
    for (const r of new Set(refs)) expect(doc.components.schemas, r).toHaveProperty(r);
  });

  it("every operation declares its scope", () => {
    for (const path of Object.values(doc.paths) as Record<string, { "x-scope"?: string }>[]) {
      for (const [method, op] of Object.entries(path)) if (method !== "parameters") expect(op["x-scope"], method).toMatch(/^[a-z]+:[a-z]+$/);
    }
  });

  it("request schemas validate what the docs promise", () => {
    expect(createAgentBody.safeParse({ name: "a", config: { model: "openai:m" } }).success).toBe(true);
    expect(createAgentBody.safeParse({ name: "a", config: {} }).success).toBe(false);
    expect(runAgentBody.safeParse({ message: "" }).success).toBe(false);
  });
});
