import {
  advanceWorkflowRun,
  blobStoreFromEnv,
  ConcurrentUpdateError,
  createAgentRuntime,
  enqueueJob,
  ingestDocument,
  type BlobStore,
  type Job,
  type Queryable,
  type WorkflowRuntimeOptions,
} from "@dtn/db";

export type JobHandler = (job: Job, db: Queryable) => Promise<void>;

export interface HandlerOptions extends WorkflowRuntimeOptions {
  blobs?: BlobStore;
}

export function createHandlers(opts: HandlerOptions = {}): Record<string, JobHandler> {
  let blobs = opts.blobs;
  return {
    "document.ingest": async (job, db) => {
      blobs ??= blobStoreFromEnv();
      // Same router as agents: pricing, usage_events and budget checks apply to embeddings too.
      const { router } = await createAgentRuntime({ db, providers: opts.agentRuntime?.providers });
      await ingestDocument(db, String(job.payload.documentId ?? ""), { router, blobs, outbound: { allowInsecure: opts.allowInsecureOutbound ?? false }, fetchImpl: opts.fetchImpl });
    },
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
