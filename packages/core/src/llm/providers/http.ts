import { LLMError, type ProviderId } from "../types";

export type FetchLike = typeof fetch;

/** Status codes worth retrying / falling back on. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

export async function postJson<T>(
  provider: ProviderId,
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw new LLMError(`${provider}: request aborted`, provider, undefined, true);
    throw new LLMError(`${provider}: network error: ${(err as Error).message}`, provider, undefined, true);
  }
  const text = await res.text();
  if (!res.ok) {
    // Never echo request bodies or headers into errors: they may contain secrets.
    const snippet = text.slice(0, 500);
    throw new LLMError(
      `${provider}: HTTP ${res.status}: ${snippet}`,
      provider,
      res.status,
      isRetryableStatus(res.status),
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new LLMError(`${provider}: invalid JSON response`, provider, res.status, true);
  }
}

export function safeParseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== "string" || raw.trim() === "") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : { value: parsed };
  } catch {
    return { _raw: raw };
  }
}
