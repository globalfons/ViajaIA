import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { migrate, MIGRATIONS_DIR } from "../src/migrate";

/**
 * Integration-test harness: creates a throw-away database, loads the Supabase
 * auth shim and all migrations, and lets tests run SQL as specific users so
 * that RLS is exercised exactly as PostgREST/Supabase would.
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

export interface TestDb {
  url: string;
  admin: pg.Client;
  close(): Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  if (!TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL not set");
  const name = `dtn_t_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const server = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await server.connect();
  await server.query(`create database ${name}`);
  await server.end();

  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${name}`;
  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  await admin.query("create extension if not exists vector with schema extensions").catch(async () => {
    await admin.query("create schema if not exists extensions");
    await admin.query("create extension if not exists vector with schema extensions");
  });
  await admin.query(await readFile(join(MIGRATIONS_DIR, "../tests/auth-shim.sql"), "utf8"));
  await migrate(url.toString(), MIGRATIONS_DIR, () => {});

  return {
    url: url.toString(),
    admin,
    async close() {
      await admin.end();
      const s = new pg.Client({ connectionString: TEST_DATABASE_URL });
      await s.connect();
      await s.query(`drop database if exists ${name} with (force)`);
      await s.end();
    },
  };
}

export interface TestUser {
  id: string;
  email: string;
}

export async function createUser(db: TestDb, email: string, opts: { platformAdmin?: boolean } = {}): Promise<TestUser> {
  const { rows } = await db.admin.query<{ id: string }>("insert into auth.users (email) values ($1) returning id", [email]);
  const id = rows[0]!.id;
  if (opts.platformAdmin) await db.admin.query("update public.profiles set is_platform_admin = true where id = $1", [id]);
  return { id, email };
}

/**
 * Runs `fn` inside a transaction as the `authenticated` role with the given
 * JWT claims (or as `anon` when user is null). Always rolls back unless
 * `commit` is true, so tests stay independent.
 */
export async function as<T>(
  db: TestDb,
  user: TestUser | null,
  fn: (c: pg.Client) => Promise<T>,
  opts: { commit?: boolean } = {},
): Promise<T> {
  const c = new pg.Client({ connectionString: db.url });
  await c.connect();
  try {
    await c.query("begin");
    if (user) {
      await c.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: user.id, email: user.email, role: "authenticated" }),
      ]);
      await c.query("set local role authenticated");
    } else {
      await c.query("set local role anon");
    }
    const out = await fn(c);
    await c.query(opts.commit ? "commit" : "rollback");
    return out;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}
