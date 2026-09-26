import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, parseKeyRing, secretHint, SecretsConfigError } from "../src/security/crypto";

const k = () => randomBytes(32).toString("base64");

describe("secrets crypto", () => {
  const v1 = k();
  const ring = parseKeyRing(`v1:${v1}`);

  it("round-trips and never stores plaintext", () => {
    const enc = encryptSecret("EAAB-super-secret-token", ring, "org-1/WHATSAPP_TOKEN");
    expect(enc).not.toContain("super-secret");
    expect(enc.startsWith("v1.")).toBe(true);
    expect(decryptSecret(enc, ring, "org-1/WHATSAPP_TOKEN")).toBe("EAAB-super-secret-token");
  });

  it("uses a fresh IV per encryption", () => {
    expect(encryptSecret("x", ring, "c")).not.toBe(encryptSecret("x", ring, "c"));
  });

  it("binds ciphertexts to tenant + name (copying to another org fails)", () => {
    const enc = encryptSecret("token", ring, "org-A/API_KEY");
    expect(() => decryptSecret(enc, ring, "org-B/API_KEY")).toThrow();
    expect(() => decryptSecret(enc, ring, "org-A/OTHER")).toThrow();
  });

  it("detects tampering", () => {
    const [v, iv, tag, ct] = encryptSecret("token", ring, "c").split(".");
    const flipped = Buffer.from(ct!, "base64url");
    flipped[0] ^= 1;
    expect(() => decryptSecret([v, iv, tag, flipped.toString("base64url")].join("."), ring, "c")).toThrow();
  });

  it("rotates: new key encrypts, old key still decrypts", () => {
    const old = encryptSecret("legacy", ring, "c");
    const rotated = parseKeyRing(`v1:${v1},v2:${k()}`);
    expect(rotated.current).toBe("v2");
    expect(encryptSecret("new", rotated, "c").startsWith("v2.")).toBe(true);
    expect(decryptSecret(old, rotated, "c")).toBe("legacy");
  });

  it("validates configuration", () => {
    expect(() => parseKeyRing(undefined)).toThrow(SecretsConfigError);
    expect(() => parseKeyRing("v1:short")).toThrow(/32 bytes/);
    expect(() => parseKeyRing(`key:${k()}`)).toThrow(/Invalid key/);
  });

  it("hints reveal almost nothing", () => {
    expect(secretHint("sk-1234567890abcd")).toBe("…abcd");
    expect(secretHint("short")).toBe("…");
  });
});
