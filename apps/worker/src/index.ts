import { hostname } from "node:os";
import { loadServerEnv, logger } from "@dtn/core";
import { blobStoreFromEnv, closePool, getPool } from "@dtn/db";
import { createHandlers } from "./handlers";
import { runLoop } from "./loop";

const env = loadServerEnv();
const log = logger({});
const workerId = `${hostname()}:${process.pid}`;
const controller = new AbortController();

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    log.info({ sig }, "shutting down: finishing current batch");
    controller.abort();
  });
}

log.info({ workerId, env: env.APP_ENV }, "worker started");
try {
  await blobStoreFromEnv().ensureBucket();
} catch (e) {
  log.warn({ err: e }, "document storage not available: document ingestion will fail until Supabase Storage is configured");
}
await runLoop(getPool(), createHandlers({ allowInsecureOutbound: env.ALLOW_INSECURE_OUTBOUND }), { workerId, signal: controller.signal });
await closePool();
log.info("worker stopped");
