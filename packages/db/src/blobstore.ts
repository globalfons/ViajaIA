/**
 * Object storage for original documents. Production uses Supabase Storage
 * through its REST API (service role, server-side only); tests use memory.
 */
export interface BlobStore {
  put(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(path: string): Promise<Uint8Array>;
  remove(paths: string[]): Promise<void>;
}

export function memoryBlobStore(): BlobStore & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    async put(path, bytes) {
      files.set(path, bytes);
    },
    async get(path) {
      const f = files.get(path);
      if (!f) throw new Error(`Blob not found: ${path}`);
      return f;
    },
    async remove(paths) {
      for (const p of paths) files.delete(p);
    },
  };
}

export function supabaseBlobStore(opts: { url: string; serviceKey: string; bucket?: string; fetchImpl?: typeof fetch }): BlobStore & { ensureBucket(): Promise<void> } {
  const bucket = opts.bucket ?? "documents";
  const f = opts.fetchImpl ?? fetch;
  const base = `${opts.url.replace(/\/$/, "")}/storage/v1`;
  const headers = { authorization: `Bearer ${opts.serviceKey}`, apikey: opts.serviceKey };
  const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");
  return {
    async ensureBucket() {
      const res = await f(`${base}/bucket`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ id: bucket, name: bucket, public: false, file_size_limit: 20 * 1024 * 1024 }),
      });
      // 409/400 "already exists" is fine.
      if (!res.ok && res.status !== 409 && res.status !== 400) throw new Error(`Storage bucket: HTTP ${res.status}`);
    },
    async put(path, bytes, contentType) {
      const res = await f(`${base}/object/${bucket}/${enc(path)}`, {
        method: "POST",
        headers: { ...headers, "content-type": contentType, "x-upsert": "true" },
        body: bytes as unknown as RequestInit["body"],
      });
      if (!res.ok) throw new Error(`Storage upload: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    },
    async get(path) {
      const res = await f(`${base}/object/${bucket}/${enc(path)}`, { headers });
      if (!res.ok) throw new Error(`Storage download: HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    async remove(paths) {
      if (!paths.length) return;
      const res = await f(`${base}/object/${bucket}`, {
        method: "DELETE",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ prefixes: paths }),
      });
      if (!res.ok) throw new Error(`Storage delete: HTTP ${res.status}`);
    },
  };
}

/** Blob store from env (server-side). */
export function blobStoreFromEnv(env: Record<string, string | undefined> = process.env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase Storage is not configured (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)");
  return supabaseBlobStore({ url, serviceKey: key });
}
