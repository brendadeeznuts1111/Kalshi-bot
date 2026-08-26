// Persistent ML-DSA watermark key (S220): get-or-create via registry + secrets backend.
import { describe, expect, test } from "bun:test";
import { sign, verify, createPublicKey } from "node:crypto";
import { watermarkKey } from "../../src/lib/watermark-sign.ts";
import type { SecretBackend } from "../../src/lib/secrets.ts";
import { secretPolicy } from "../../src/lib/secret-registry.ts";

function memoryBackend(): SecretBackend & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(ref) { return store.get(ref.service + "/" + ref.name) ?? null; },
    async set(ref) { store.set(ref.service + "/" + ref.name, ref.value); },
    async delete(ref) { const k = ref.service + "/" + ref.name; const had = store.has(k); store.delete(k); return had; },
  };
}

describe("watermarkKey (S220)", () => {
  test("registry defines the watermark key as vault+env (never argv)", () => {
    const p = secretPolicy("watermark-mldsa-key");
    expect(p.name).toBe("watermark-mldsa-key");
    expect(p.sources).toContain("vault");
    expect(p.sources).toContain("env");
    expect(p.sources).not.toContain("argv");
    expect(p.envName).toBe("WATERMARK_MLDSA_PRIVATE_KEY");
  });

  test("get-or-create: generates once, reuses the SAME key on later calls", async () => {
    const backend = memoryBackend();
    const a = await watermarkKey({ backend, service: "test-svc" });
    const b = await watermarkKey({ backend, service: "test-svc" });
    expect(a.publicKeyPem).toBe(b.publicKeyPem); // persistent - same key
    expect(backend.store.size).toBe(1); // stored once
    expect(a.keyType).toBe("ml-dsa-65");
    expect(a.publicKeyPem).toContain("BEGIN PUBLIC KEY");
  });

  test("the stored private key signs and the public key verifies", async () => {
    const backend = memoryBackend();
    const { privateKey, publicKeyPem } = await watermarkKey({ backend, service: "test-svc" });
    const data = new Uint8Array([1, 2, 3]);
    const sig = sign(null, data, privateKey);
    expect(verify(null, data, createPublicKey(publicKeyPem), sig)).toBe(true);
  });
});
