import { randomUUID } from "node:crypto";
import pino, { type Logger } from "pino";

/**
 * Correlation fields attached to every log line. They let us follow a single
 * request / execution across web, worker and provider calls.
 */
export interface LogContext {
  requestId?: string;
  executionId?: string;
  organizationId?: string;
  userId?: string;
  agentId?: string;
  workflowId?: string;
  workflowRunId?: string;
  conversationId?: string;
  jobId?: string;
}

/** Keys whose values must never reach log storage. */
export const REDACT_PATHS = [
  "apiKey",
  "*.apiKey",
  "authorization",
  "*.authorization",
  "headers.authorization",
  "headers.cookie",
  "password",
  "*.password",
  "secret",
  "*.secret",
  "token",
  "*.token",
  "accessToken",
  "*.accessToken",
  "refreshToken",
  "*.refreshToken",
  "ciphertext",
  "*.ciphertext",
];

let root: Logger | undefined;

export function getLogger(): Logger {
  if (!root) {
    root = pino({
      level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
      base: { service: process.env.SERVICE_NAME ?? "dtn", env: process.env.APP_ENV ?? process.env.NODE_ENV },
      redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
    });
  }
  return root;
}

export function logger(ctx: LogContext = {}): Logger {
  return getLogger().child(ctx);
}

export function newRequestId(): string {
  return randomUUID();
}

// ---------------------------------------------------------------------------
// Error tracking hooks. Sentry / OpenTelemetry adapters register here at
// process start-up; the core never imports a vendor SDK directly.
// ---------------------------------------------------------------------------

export type ErrorReporter = (error: unknown, ctx: LogContext & Record<string, unknown>) => void;

const reporters = new Set<ErrorReporter>();

export function registerErrorReporter(reporter: ErrorReporter): () => void {
  reporters.add(reporter);
  return () => reporters.delete(reporter);
}

export function captureError(error: unknown, ctx: LogContext & Record<string, unknown> = {}): void {
  const err = error instanceof Error ? error : new Error(String(error));
  getLogger().error({ ...ctx, err }, err.message);
  for (const r of reporters) {
    try {
      r(err, ctx);
    } catch {
      /* a broken reporter must never crash the caller */
    }
  }
}

/** Lightweight span API compatible with a future OpenTelemetry adapter. */
export type SpanHook = (name: string, attrs: Record<string, unknown>, durationMs: number, ok: boolean) => void;
const spanHooks = new Set<SpanHook>();

export function registerSpanHook(hook: SpanHook): () => void {
  spanHooks.add(hook);
  return () => spanHooks.delete(hook);
}

export async function withSpan<T>(name: string, attrs: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  let ok = true;
  try {
    return await fn();
  } catch (e) {
    ok = false;
    throw e;
  } finally {
    const d = performance.now() - start;
    for (const h of spanHooks) {
      try {
        h(name, attrs, d, ok);
      } catch {
        /* ignore */
      }
    }
  }
}
