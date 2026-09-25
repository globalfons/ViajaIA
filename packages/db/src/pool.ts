import pg from "pg";

let pool: pg.Pool | undefined;

/**
 * Service-level Postgres pool (used by the worker and trusted server code).
 * It bypasses RLS, therefore every query issued through it MUST filter by
 * organization_id explicitly. User-facing reads go through Supabase + RLS.
 */
export function getPool(connectionString = process.env.DATABASE_URL): pg.Pool {
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  if (!pool) {
    pool = new pg.Pool({
      connectionString,
      max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
      idleTimeoutMillis: 30_000,
      statement_timeout: 30_000,
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

export type Queryable = Pick<pg.Pool, "query">;

export async function withTransaction<T>(p: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await p.connect();
  try {
    await client.query("begin");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}
