import { advanceWorkflowRun, ConcurrentUpdateError, enqueueJob, type Job, type Queryable, type WorkflowRuntimeOptions } from "@dtn/db";

export type JobHandler = (job: Job, db: Queryable) => Promise<void>;

export function createHandlers(opts: WorkflowRuntimeOptions = {}): Record<string, JobHandler> {
  return {
    "workflow.advance": async (job, db) => {
      const runId = String(job.payload.runId ?? "");
      try {
        await advanceWorkflowRun(db, runId, opts);
      } catch (e) {
        if (e instanceof ConcurrentUpdateError) {
          // Someone (e.g. a reviewer) changed the run meanwhile: advance again on fresh state.
          await enqueueJob(db, { type: "workflow.advance", organizationId: job.organization_id, payload: { runId }, runAt: new Date(Date.now() + 500) });
          return;
        }
        throw e;
      }
    },
  };
}
