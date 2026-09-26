import { decryptSecret, encryptSecret, parseKeyRing, secretHint, type KeyRing } from "@dtn/core";
import type { Queryable } from "./pool";

/**
 * Per-organization encrypted credentials (WhatsApp tokens, CRM keys…).
 * Plaintext only exists in server memory while a tool/integration uses it.
 */
export const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]{1,63}$/;

let cachedRing: { raw: string; ring: KeyRing } | undefined;
export function keyRingFromEnv(env: Record<string, string | undefined> = process.env): KeyRing {
  const raw = env.SECRETS_ENCRYPTION_KEYS ?? "";
  if (cachedRing?.raw !== raw) cachedRing = { raw, ring: parseKeyRing(raw) };
  return cachedRing.ring;
}

const context = (organizationId: string, name: string) => `${organizationId}/${name}`;

export async function setSecret(db: Queryable, organizationId: string, name: string, value: string, opts: { ring?: KeyRing; userId?: string | null } = {}) {
  if (!SECRET_NAME_RE.test(name)) throw new Error("Invalid secret name (use UPPER_SNAKE_CASE)");
  if (!value || value.length > 10_000) throw new Error("Invalid secret value");
  const ring = opts.ring ?? keyRingFromEnv();
  await db.query(
    `insert into public.secrets (organization_id, name, ciphertext, key_version, hint, created_by)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (organization_id, name) do update set ciphertext = excluded.ciphertext, key_version = excluded.key_version, hint = excluded.hint`,
    [organizationId, name, encryptSecret(value, ring, context(organizationId, name)), ring.current, secretHint(value), opts.userId ?? null],
  );
}

export async function getSecret(db: Queryable, organizationId: string, name: string, ring?: KeyRing): Promise<string | null> {
  const { rows } = await db.query<{ ciphertext: string }>("select ciphertext from public.secrets where organization_id = $1 and name = $2", [organizationId, name]);
  if (!rows[0]) return null;
  return decryptSecret(rows[0].ciphertext, ring ?? keyRingFromEnv(), context(organizationId, name));
}

export async function deleteSecret(db: Queryable, organizationId: string, name: string) {
  await db.query("delete from public.secrets where organization_id = $1 and name = $2", [organizationId, name]);
}

/** Re-encrypts every secret with the current key (after adding a new key version). */
export async function rotateSecrets(db: Queryable, ring: KeyRing = keyRingFromEnv()): Promise<number> {
  const { rows } = await db.query<{ organization_id: string; name: string; ciphertext: string }>(
    "select organization_id, name, ciphertext from public.secrets where key_version <> $1",
    [ring.current],
  );
  for (const r of rows) {
    const plain = decryptSecret(r.ciphertext, ring, context(r.organization_id, r.name));
    await db.query("update public.secrets set ciphertext = $3, key_version = $4 where organization_id = $1 and name = $2", [
      r.organization_id,
      r.name,
      encryptSecret(plain, ring, context(r.organization_id, r.name)),
      ring.current,
    ]);
  }
  return rows.length;
}

/** Default resolver for tools/workflows: `(orgId, name) => plaintext | null`. */
export const secretResolver = (db: Queryable) => (organizationId: string, name: string) => getSecret(db, organizationId, name);
