import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

/**
 * Applies supabase/migrations/*.sql in order. In Supabase projects prefer
 * `supabase db push`; this runner exists for plain Postgres (CI, docker-compose
 * tests) and records applied files in public.schema_migrations.
 */
export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../supabase/migrations");

export async function migrate(connectionString: string, dir = MIGRATIONS_DIR, log = console.log): Promise<string[]> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(
      "create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())",
    );
    const done = new Set(
      (await client.query<{ name: string }>("select name from public.schema_migrations")).rows.map((r) => r.name),
    );
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(join(dir, file), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into public.schema_migrations(name) values ($1)", [file]);
        await client.query("commit");
      } catch (e) {
        await client.query("rollback");
        throw new Error(`Migration ${file} failed: ${(e as Error).message}`);
      }
      applied.push(file);
      log(`applied ${file}`);
    }
  } finally {
    await client.end();
  }
  return applied;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  migrate(url).then(
    (a) => console.log(a.length ? `done (${a.length} applied)` : "up to date"),
    (e) => {
      console.error(e.message);
      process.exit(1);
    },
  );
}
