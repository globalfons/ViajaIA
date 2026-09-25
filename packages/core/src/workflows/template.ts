/**
 * Safe template resolution for workflow data: "{{input.email}}",
 * "{{nodes.classify.output.category}}", "{{run.id}}". No code execution, no
 * prototype access. A string that is exactly one placeholder resolves to the
 * raw value (object, number…); mixed strings interpolate as text.
 */

const FORBIDDEN = new Set(["__proto__", "prototype", "constructor"]);
const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.:-]+)\s*\}\}/g;
const SINGLE = /^\{\{\s*([a-zA-Z0-9_.:-]+)\s*\}\}$/;

export type TemplateScope = Record<string, unknown>;

export function getPath(scope: unknown, path: string): unknown {
  let cur: unknown = scope;
  for (const key of path.split(".")) {
    if (FORBIDDEN.has(key)) return undefined;
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur) && /^\d+$/.test(key)) {
      cur = cur[Number(key)];
      continue;
    }
    if (typeof cur !== "object" || !Object.prototype.hasOwnProperty.call(cur, key)) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

const stringify = (v: unknown) => (v === undefined || v === null ? "" : typeof v === "string" ? v : JSON.stringify(v));

/** `secret:` placeholders are left untouched here; only trusted server code resolves them. */
export function resolveTemplate(value: string, scope: TemplateScope): unknown {
  const single = SINGLE.exec(value);
  if (single) {
    if (single[1]!.startsWith("secret:")) return value;
    return getPath(scope, single[1]!);
  }
  return value.replace(PLACEHOLDER, (m, path: string) => (path.startsWith("secret:") ? m : stringify(getPath(scope, path))));
}

/** Recursively resolves templates inside objects/arrays. */
export function resolveDeep(value: unknown, scope: TemplateScope, depth = 0): unknown {
  if (depth > 10) return value;
  if (typeof value === "string") return resolveTemplate(value, scope);
  if (Array.isArray(value)) return value.map((v) => resolveDeep(v, scope, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (!FORBIDDEN.has(k)) out[k] = resolveDeep(v, scope, depth + 1);
    return out;
  }
  return value;
}

/** Replaces {{secret:NAME}} using a resolver. Never call this on text sent to an LLM. */
export async function resolveSecrets(value: string, getSecret: (name: string) => Promise<string | null>): Promise<string> {
  const names = [...value.matchAll(/\{\{\s*secret:([A-Za-z0-9_]{1,64})\s*\}\}/g)].map((m) => m[1]!);
  let out = value;
  for (const name of new Set(names)) {
    const secret = await getSecret(name);
    if (secret === null) throw new Error(`Secret "${name}" is not configured`);
    out = out.replace(new RegExp(`\\{\\{\\s*secret:${name}\\s*\\}\\}`, "g"), secret);
  }
  return out;
}
