import "server-only";
import { blobStoreFromEnv, type BlobStore } from "@dtn/db";

let store: BlobStore | undefined;
/** Supabase Storage (service role) — server-side only. */
export const blobs = () => (store ??= blobStoreFromEnv());
