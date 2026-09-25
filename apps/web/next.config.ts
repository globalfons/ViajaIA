import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: "standalone",
  transpilePackages: ["@dtn/core", "@dtn/db"],
  serverExternalPackages: ["pg", "pino", "pdf-parse", "mammoth"],
  experimental: {
    // Document uploads (max 20 MB + multipart overhead). The proxy would otherwise
    // truncate bodies above 10 MB silently.
    serverActions: { bodySizeLimit: "21mb" },
    proxyClientMaxBodySize: "21mb",
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Everything except the embeddable public chat must never be framed (clickjacking).
      { source: "/((?!chat/).*)", headers: [{ key: "X-Frame-Options", value: "DENY" }, { key: "Content-Security-Policy", value: "frame-ancestors 'none'" }] },
      // The public chat is designed to be embedded on clients' websites (no session cookies are used there).
      { source: "/chat/:path*", headers: [{ key: "Content-Security-Policy", value: "frame-ancestors *" }] },
    ];
  },
};

export default config;
