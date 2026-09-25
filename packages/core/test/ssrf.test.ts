import { describe, expect, it } from "vitest";
import { assertSafeUrl, hostMatches, isPrivateIp, makeSafeLookup, safeFetch, SsrfError } from "../src/security/ssrf";

describe("isPrivateIp", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "224.0.0.1"])(
    "blocks %s",
    (ip) => expect(isPrivateIp(ip)).toBe(true),
  );
  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111"])("allows %s", (ip) => expect(isPrivateIp(ip)).toBe(false));
});

describe("assertSafeUrl", () => {
  it.each([
    "http://example.com",
    "file:///etc/passwd",
    "gopher://x",
    "https://localhost/x",
    "https://127.0.0.1/",
    "https://[::1]/",
    "https://169.254.169.254/latest/meta-data",
    "https://2130706433/",
    "https://0x7f.0.0.1/",
    "https://user:pass@example.com/",
    "https://example.com:22/",
    "https://metadata.google.internal/",
    "https://db.internal/",
  ])("rejects %s", (u) => expect(() => assertSafeUrl(u)).toThrow(SsrfError));

  it("accepts public https URLs", () => {
    expect(assertSafeUrl("https://example.com/a?b=1").hostname).toBe("example.com");
  });

  it("enforces host allowlists with wildcards", () => {
    expect(() => assertSafeUrl("https://api.example.com", { allowedHosts: ["*.example.com"] })).not.toThrow();
    expect(() => assertSafeUrl("https://evil.com", { allowedHosts: ["*.example.com"] })).toThrow(/allowlist/);
    expect(hostMatches("example.com", ["*.example.com"])).toBe(false);
    expect(hostMatches("notexample.com", ["*.example.com"])).toBe(false);
  });

  it("insecure mode allows http and private hosts (dev only)", () => {
    expect(() => assertSafeUrl("http://localhost:3000", { allowInsecure: true })).not.toThrow();
  });
});

describe("DNS rebinding protection", () => {
  const fakeDns = (addrs: string[]) =>
    ((_h: string, _o: unknown, cb: (e: Error | null, a: { address: string; family: number }[]) => void) =>
      cb(null, addrs.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })))) as never;

  it("fails the connection when a public name resolves to a private IP", async () => {
    const lookup = makeSafeLookup({}, fakeDns(["93.184.216.34", "127.0.0.1"]));
    const err = await new Promise<Error | null>((resolve) => lookup("evil.test", {}, ((e: Error | null) => resolve(e)) as never));
    expect(err).toBeInstanceOf(SsrfError);
  });

  it("passes public addresses through", async () => {
    const lookup = makeSafeLookup({}, fakeDns(["93.184.216.34"]));
    const addr = await new Promise((resolve) => lookup("ok.test", {}, ((_e: unknown, a: string) => resolve(a)) as never));
    expect(addr).toBe("93.184.216.34");
  });
});

describe("safeFetch", () => {
  it("re-validates every redirect hop", async () => {
    const fetchImpl = (async () => new Response(null, { status: 302, headers: { location: "https://169.254.169.254/latest" } })) as typeof fetch;
    await expect(safeFetch("https://example.com", { fetchImpl, dispatcher: undefined as never })).rejects.toThrow(/Private address/);
  });

  it("limits response size", async () => {
    const fetchImpl = (async () => new Response("x".repeat(2000))) as typeof fetch;
    await expect(safeFetch("https://example.com", { fetchImpl, maxBytes: 1000 })).rejects.toThrow(/too large/);
  });

  it("returns body and final URL", async () => {
    let n = 0;
    const fetchImpl = (async () =>
      n++ === 0 ? new Response(null, { status: 301, headers: { location: "/final" } }) : new Response("ok")) as typeof fetch;
    const res = await safeFetch("https://example.com/start", { fetchImpl });
    expect(res.text()).toBe("ok");
    expect(res.url).toBe("https://example.com/final");
  });
});
