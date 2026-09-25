import { lookup as dnsLookup } from "node:dns";
import { isIP } from "node:net";
import { Agent, type Dispatcher } from "undici";

/**
 * SSRF protection for every outbound request whose URL is influenced by a
 * tenant or a model (RAG URLs, webhook nodes, MCP servers, HTTP tools).
 *
 *  1. Scheme allowlist (https only unless insecure mode is on).
 *  2. Hostname checks (no localhost / internal names / credentials in URL).
 *  3. The IP is validated AT CONNECT TIME via a custom DNS lookup on the
 *     undici dispatcher, which defeats DNS-rebinding (validate-then-resolve).
 *  4. Redirects are followed manually and each hop is re-validated.
 *  5. Response size and time are bounded.
 */

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local + cloud metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];

export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const n = ipv4ToInt(ip);
    return BLOCKED_V4.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (ipv4ToInt(base) & mask);
    });
  }
  if (v === 6) {
    const lower = ip.toLowerCase().replace(/^\[|\]$/g, "");
    if (lower === "::" || lower === "::1") return true;
    // IPv4-mapped / compatible addresses (::ffff:127.0.0.1, ::ffff:7f00:1)
    const mapped = /^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPrivateIp(mapped[1]!);
    const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
    if (hexMapped) {
      const n = (parseInt(hexMapped[1]!, 16) << 16) + parseInt(hexMapped[2]!, 16);
      return isPrivateIp([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join("."));
    }
    const first = parseInt(lower.split(":")[0] || "0", 16);
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((first & 0xff00) === 0xff00) return true; // multicast
    if (lower.startsWith("64:ff9b:")) return true; // NAT64 can reach IPv4 private space
    if (lower.startsWith("2001:db8:")) return true; // documentation
    return false;
  }
  return true; // not an IP at all: treat as unsafe
}

export interface OutboundPolicy {
  /** Allow http:// and private addresses (local development only). */
  allowInsecure?: boolean;
  /** Optional hostname allowlist (exact or "*.example.com"). */
  allowedHosts?: string[];
  allowedPorts?: number[];
}

const BLOCKED_HOSTNAMES = [/^localhost$/i, /\.localhost$/i, /\.local$/i, /\.internal$/i, /^metadata(\.google\.internal)?$/i];

export function hostMatches(host: string, patterns: string[]): boolean {
  const h = host.toLowerCase();
  return patterns.some((p) => {
    const pat = p.toLowerCase().trim();
    if (pat.startsWith("*.")) return h.endsWith(pat.slice(1)) && h.length > pat.length - 1;
    return h === pat;
  });
}

/** Static URL validation (before any DNS resolution). */
export function assertSafeUrl(raw: string | URL, policy: OutboundPolicy = {}): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfError("Invalid URL");
  }
  const allowedSchemes = policy.allowInsecure ? ["https:", "http:"] : ["https:"];
  if (!allowedSchemes.includes(url.protocol)) throw new SsrfError(`Scheme ${url.protocol} not allowed`);
  if (url.username || url.password) throw new SsrfError("Credentials in URL are not allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!policy.allowInsecure) {
    if (BLOCKED_HOSTNAMES.some((re) => re.test(host))) throw new SsrfError("Host not allowed");
    if (isIP(host) && isPrivateIp(host)) throw new SsrfError("Private address not allowed");
    // Decimal/octal/hex encoded IPs ("2130706433", "0x7f.1") are rejected outright.
    if (!isIP(host) && /^[0-9x.]+$/i.test(host)) throw new SsrfError("Numeric host not allowed");
  }
  if (policy.allowedHosts?.length && !hostMatches(host, policy.allowedHosts)) throw new SsrfError("Host not in allowlist");
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  const ports = policy.allowedPorts ?? (policy.allowInsecure ? undefined : [443, 80, 8443]);
  if (ports && !ports.includes(port)) throw new SsrfError(`Port ${port} not allowed`);
  return url;
}

type LookupFn = typeof dnsLookup;

/** DNS lookup that refuses private addresses: used by the dispatcher at connect time. */
export function makeSafeLookup(policy: OutboundPolicy = {}, base: LookupFn = dnsLookup): LookupFn {
  return ((hostname: string, options: unknown, callback: (...args: unknown[]) => void) => {
    const opts = typeof options === "function" ? {} : (options as object);
    const cb = (typeof options === "function" ? options : callback) as (...args: unknown[]) => void;
    base(hostname, { ...opts, all: true } as never, ((err: NodeJS.ErrnoException | null, addresses: { address: string; family: number }[]) => {
      if (err) return cb(err);
      const list = Array.isArray(addresses) ? addresses : [];
      if (!policy.allowInsecure) {
        const bad = list.find((a) => isPrivateIp(a.address));
        if (bad || list.length === 0) return cb(new SsrfError(`Resolved to a blocked address`));
      }
      if ((opts as { all?: boolean }).all) return cb(null, list);
      const first = list[0]!;
      return cb(null, first.address, first.family);
    }) as never);
  }) as LookupFn;
}

export function createSafeDispatcher(policy: OutboundPolicy = {}): Dispatcher {
  return new Agent({ connect: { lookup: makeSafeLookup(policy) as never, timeout: 10_000 } });
}

export interface SafeFetchOptions extends OutboundPolicy {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  dispatcher?: Dispatcher;
  fetchImpl?: typeof fetch;
}

export interface SafeResponse {
  status: number;
  headers: Headers;
  url: string;
  body: Uint8Array;
  text(): string;
}

let sharedDispatcher: Dispatcher | undefined;

export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeResponse> {
  const maxRedirects = opts.maxRedirects ?? 3;
  const maxBytes = opts.maxBytes ?? 10 * 1024 * 1024;
  const dispatcher = opts.dispatcher ?? (opts.allowInsecure ? undefined : (sharedDispatcher ??= createSafeDispatcher()));
  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);

  try {
    let url = assertSafeUrl(rawUrl, opts);
    let method = opts.method ?? "GET";
    let body = opts.body;
    for (let hop = 0; ; hop++) {
      const res = await fetchImpl(url, {
        method,
        headers: opts.headers,
        body: body as RequestInit["body"],
        redirect: "manual",
        signal: controller.signal,
        ...(dispatcher ? { dispatcher } : {}),
      } as RequestInit);
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        if (hop >= maxRedirects) throw new SsrfError("Too many redirects");
        url = assertSafeUrl(new URL(res.headers.get("location")!, url), opts);
        if (res.status !== 307 && res.status !== 308) {
          method = "GET";
          body = undefined;
        }
        continue;
      }
      const declared = Number(res.headers.get("content-length") ?? "0");
      if (declared > maxBytes) throw new SsrfError("Response too large");
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (res.body) {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) {
            await reader.cancel();
            throw new SsrfError("Response too large");
          }
          chunks.push(value);
        }
      }
      const buf = new Uint8Array(size);
      let off = 0;
      for (const c of chunks) {
        buf.set(c, off);
        off += c.byteLength;
      }
      return { status: res.status, headers: res.headers, url: url.toString(), body: buf, text: () => new TextDecoder().decode(buf) };
    }
  } finally {
    clearTimeout(timer);
  }
}
