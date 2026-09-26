import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Envelope-less AES-256-GCM for integration credentials.
 *  - Keys come from SECRETS_ENCRYPTION_KEYS="v1:<base64 32B>,v2:<base64 32B>".
 *    The LAST key encrypts; every listed key can decrypt (rotation).
 *  - Additional authenticated data binds a ciphertext to its tenant and name,
 *    so copying it to another organization/secret makes decryption fail.
 * Format: "<version>.<iv b64url>.<tag b64url>.<ciphertext b64url>".
 */

export interface KeyRing {
  current: string;
  keys: Map<string, Buffer>;
}

export class SecretsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretsConfigError";
  }
}

export function parseKeyRing(raw: string | undefined): KeyRing {
  if (!raw?.trim()) throw new SecretsConfigError("SECRETS_ENCRYPTION_KEYS is not configured");
  const keys = new Map<string, Buffer>();
  let current = "";
  for (const part of raw.split(",").map((p) => p.trim()).filter(Boolean)) {
    const idx = part.indexOf(":");
    const version = part.slice(0, idx);
    const key = Buffer.from(part.slice(idx + 1), "base64");
    if (idx <= 0 || !/^v\d+$/.test(version)) throw new SecretsConfigError(`Invalid key entry "${part.slice(0, 8)}…" (expected v1:<base64>)`);
    if (key.length !== 32) throw new SecretsConfigError(`Key ${version} must be 32 bytes (openssl rand -base64 32)`);
    keys.set(version, key);
    current = version;
  }
  if (!current) throw new SecretsConfigError("No encryption keys configured");
  return { current, keys };
}

const aad = (context: string) => Buffer.from(`dtn-secret:${context}`, "utf8");

export function encryptSecret(plaintext: string, ring: KeyRing, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", ring.keys.get(ring.current)!, iv);
  cipher.setAAD(aad(context));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [ring.current, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(payload: string, ring: KeyRing, context: string): string {
  const [version, iv, tag, ct] = payload.split(".");
  const key = version ? ring.keys.get(version) : undefined;
  if (!key || !iv || !tag || ct === undefined) throw new SecretsConfigError("Unknown key version or malformed secret");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAAD(aad(context));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

/** Last characters for recognition in the UI; never enough to be useful. */
export function secretHint(value: string): string {
  return value.length >= 12 ? `…${value.slice(-4)}` : "…";
}
