import { describe, expect, it, vi } from "vitest";
import { captureError, registerErrorReporter, withSpan, registerSpanHook } from "../src/observability/logger";

describe("observability hooks", () => {
  it("forwards captured errors to registered reporters with context", () => {
    const reporter = vi.fn();
    const off = registerErrorReporter(reporter);
    captureError(new Error("boom"), { organizationId: "org-1", workflowRunId: "run-1" });
    off();
    expect(reporter).toHaveBeenCalledOnce();
    expect(reporter.mock.calls[0]![1]).toMatchObject({ organizationId: "org-1", workflowRunId: "run-1" });
  });

  it("a failing reporter does not break the caller", () => {
    const off = registerErrorReporter(() => {
      throw new Error("reporter down");
    });
    expect(() => captureError("x")).not.toThrow();
    off();
  });

  it("reports span duration and outcome", async () => {
    const hook = vi.fn();
    const off = registerSpanHook(hook);
    await withSpan("llm.chat", { model: "m" }, async () => 1);
    await expect(withSpan("llm.chat", {}, async () => Promise.reject(new Error("x")))).rejects.toThrow();
    off();
    expect(hook.mock.calls.map((c) => c[3])).toEqual([true, false]);
  });
});
