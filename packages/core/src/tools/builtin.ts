import { z } from "zod";
import { safeFetch } from "../security/ssrf";
import type { ToolDefinition } from "./registry";

/** Current date/time in a given IANA time zone (default Europe/Madrid). */
export const currentDateTimeTool: ToolDefinition = {
  name: "current_datetime",
  description: "Returns the current date and time. Use it before reasoning about dates, schedules or deadlines.",
  risk: "read",
  parameters: z.object({ timeZone: z.string().max(64).optional().describe("IANA time zone, e.g. Europe/Madrid") }),
  async execute({ timeZone }) {
    const tz = timeZone ?? "Europe/Madrid";
    let formatted: string;
    try {
      formatted = new Intl.DateTimeFormat("es-ES", { dateStyle: "full", timeStyle: "long", timeZone: tz }).format(new Date());
    } catch {
      throw new Error(`Unknown time zone ${tz}`);
    }
    return { iso: new Date().toISOString(), timeZone: tz, formatted };
  },
};

/**
 * HTTP GET against an explicit per-agent host allowlist (config.allowedHosts).
 * Without an allowlist the tool refuses to run: an open HTTP tool is a data
 * exfiltration channel for prompt-injected content.
 */
export const httpGetTool: ToolDefinition = {
  name: "http_get",
  description: "Fetches a public web page or JSON API over HTTPS from the hosts this assistant is allowed to use.",
  risk: "external",
  timeoutMs: 20_000,
  parameters: z.object({ url: z.string().url().max(2048) }),
  async execute({ url }, ctx) {
    const allowedHosts = Array.isArray(ctx.config?.allowedHosts) ? (ctx.config!.allowedHosts as string[]) : [];
    if (allowedHosts.length === 0) throw new Error("http_get has no allowed hosts configured for this agent");
    const res = await safeFetch(url, { allowedHosts, maxBytes: 2 * 1024 * 1024, timeoutMs: 15_000 });
    const type = res.headers.get("content-type") ?? "";
    const text = res.text();
    const body = type.includes("html") ? htmlToText(text) : text;
    return { status: res.status, contentType: type, body: body.slice(0, 15_000) };
  },
};

/** Minimal, dependency-free HTML → text conversion (scripts/styles removed). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|template|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

export const BUILTIN_TOOLS: ToolDefinition[] = [currentDateTimeTool, httpGetTool];
