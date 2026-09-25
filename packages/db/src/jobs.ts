import type { Queryable } from "./pool";

/**
 * Postgres job queue (FOR UPDATE SKIP LOCKED). Good for thousands of jobs per
 * minute without extra infrastructure. dedupe_key guarantees at most one
 * queued/running job per key (e.g. one advance per workflow run at a time).
 */

export interface Job {
  id: number;
  organization_id: string | null;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

export async function enqueueJob(
  db: Queryable,
  job: { type: string; organizationId?: string | null; payload?: Record<string, unknown>; runAt?: Date; dedupeKey?: string; maxAttempts?: number },
): Promise<number | null> {
  const { rows } = await db.query<{ id: number }>(
    `insert into public.jobs (organization_id, type, payload, run_at, dedupe_key, max_attempts)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (dedupe_key) where dedupe_key is not null and status in ('queued', 'running') do nothing
     returning id`,
    [job.organizationId ?? null, job.type, job.payload ?? {}, job.runAt ?? new Date(), job.dedupeKey ?? null, job.maxAttempts ?? 5],
  );
  return rows[0]?.id ?? null;
}

export async function claimJobs(db: Queryable, workerId: string, limit = 5, types?: string[]): Promise<Job[]> {
  const { rows } = await db.query<Job>(
    `update public.jobs j set status = 'running', locked_at = now(), locked_by = $1, attempts = j.attempts + 1
     where j.id in (
       select id from public.jobs
       where status = 'queued' and run_at <= now() and ($3::text[] is null or type = any($3))
       order by run_at, id
       limit $2
       for update skip locked
     )
     returning j.id, j.organization_id, j.type, j.payload, j.attempts, j.max_attempts`,
    [workerId, limit, types ?? null],
  );
  return rows;
}

export async function completeJob(db: Queryable, id: number): Promise<void> {
  await db.query("update public.jobs set status = 'done', finished_at = now(), locked_at = null where id = $1", [id]);
}

/** Retries with exponential backoff (max 1h) until max_attempts, then marks failed. */
export async function failJob(db: Queryable, job: Job, error: string): Promise<"retrying" | "failed"> {
  if (job.attempts >= job.max_attempts) {
    await db.query("update public.jobs set status = 'failed', last_error = $2, finished_at = now(), locked_at = null where id = $1", [job.id, error.slice(0, 2000)]);
    return "failed";
  }
  const delaySec = Math.min(3600, 5 * 2 ** (job.attempts - 1));
  await db.query(
    "update public.jobs set status = 'queued', last_error = $2, locked_at = null, locked_by = null, run_at = now() + make_interval(secs => $3) where id = $1",
    [job.id, error.slice(0, 2000), delaySec],
  );
  return "retrying";
}

/** Requeues jobs whose worker died mid-flight. */
export async function requeueStaleJobs(db: Queryable, staleAfterSeconds = 600): Promise<number> {
  const res = await db.query(
    "update public.jobs set status = 'queued', locked_at = null, locked_by = null where status = 'running' and locked_at < now() - make_interval(secs => $1)",
    [staleAfterSeconds],
  );
  return res.rowCount ?? 0;
}
