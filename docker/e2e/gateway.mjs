// Minimal stand-in for Supabase's API gateway (Kong) for local E2E tests:
// routes /auth/v1, /rest/v1 and /storage/v1 to the corresponding services.
import http from "node:http";

const routes = [
  ["/auth/v1", process.env.AUTH_URL ?? "http://auth:9999"],
  ["/rest/v1", process.env.REST_URL ?? "http://rest:3000"],
  ["/storage/v1", process.env.STORAGE_URL ?? "http://storage:5000"],
];

http
  .createServer((req, res) => {
    const match = routes.find(([p]) => req.url.startsWith(p));
    if (!match) {
      res.writeHead(404).end("not found");
      return;
    }
    const target = new URL(match[1]);
    const headers = { ...req.headers, host: target.host };
    // Kong turns the apikey header into Authorization when none is present.
    if (!headers.authorization && headers.apikey) headers.authorization = `Bearer ${headers.apikey}`;
    const upstream = http.request(
      { hostname: target.hostname, port: target.port, path: req.url.slice(match[0].length) || "/", method: req.method, headers },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on("error", (e) => res.writeHead(502).end(String(e)));
    req.pipe(upstream);
  })
  .listen(8000, () => console.log("gateway on :8000"));
