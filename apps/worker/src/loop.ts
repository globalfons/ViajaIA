import { captureError, logger } from "@dtn/core";
import { claimJobs, completeJob, failJob, requeueStaleJobs, wakeDueRuns, type Queryable } from "@dtn/db";
import type { JobHandler } from "./handlers";

/** Claims and processes one batch. Returns how many jobs were processed. */
export async function processBatch(db: Queryable, handlers: Record<string, JobHandler>, workerId: string, batchSize = 5): Promise<number> {
  const jobs = await claimJobs(db, workerId, batchSize, Object.keys(handlers));
  await Promise.all(
    jobs.map(async (job) => {
      const log = logger({ jobId: String(job.id), organizationId: job.organization_id ?? undefined });
      const started = Date.now();
      try {
        await handlers[job.type]!(job, db);
        await completeJob(db, job.id);
        log.info({ type: job.type, ms: Date.now() - started }, "job done");
      } catch (e) {
        const outcome = await failJob(db, job, e instanceof Error ? e.message : String(e));
        captureError(e, { jobId: String(job.id), organizationId: job.organization_id ?? undefined, type: job.type, outcome });
      }
    }),
  );
  return jobs.length;
}

export interface LoopOptions {
  workerId: string;
  pollMs?: number;
  schedulerEveryMs?: number;
  signal: AbortSignal;
}

export async function runLoop(db: Queryable, handlers: Record<string, JobHandler>, opts: LoopOptions): Promise<void> {
  const pollMs = opts.pollMs ?? 1000;
  let lastTick = 0;
  while (!opts.signal.aborted) {
    try {
      if (Date.now() - lastTick > (opts.schedulerEveryMs ?? 15_000)) {
        lastTick = Date.now();
        await requeueStaleJobs(db);
        await wakeDueRuns(db);
      }
      const n = await processBatch(db, handlers, opts.workerId);
      if (n === 0) await new Promise((r) => setTimeout(r, pollMs));
    } catch (e) {
      captureError(e, { workerId: opts.workerId });
      await new Promise((r) => setTimeout(r, pollMs * 5));
    }
  }
}
