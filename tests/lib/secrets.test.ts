import { describe, expect, test } from "bun:test";
import {
  DEFAULT_SECRET_SERVICE,
  deleteSecret,
  getSecret,
  setSecret,
  type SecretBackend,
} from "../../src/lib/secrets.ts";

/** In-memory vault substitute so tests never touch the OS keychain. */
function memoryBackend(
  initial: Map<string, string> = new Map(),
): SecretBackend & { map: Map<string, string> } {
  const map = initial;
  return {
    map,
    async get({ service, name }) {
      return map.get(service + "/" + name) ?? null;
    },
    async set({ service, name, value }) {
      map.set(service + "/" + name, value);
    },
    async delete({ service, name }) {
      return map.delete(service + "/" + name);
    },
  };
}

const REF = { service: DEFAULT_SECRET_SERVICE, name: "kalshi-api-key-id" };

describe("OS keychain credential store wrapper (Bun.secrets)", () => {
  test("getSecret returns the vault value when present", async () => {
    const backend = memoryBackend(
      new Map([["com.kalshi-bot/kalshi-api-key-id", "key-123"]]),
    );
    expect(await getSecret(REF, { backend })).toBe("key-123");
  });

  test("getSecret falls back to the env var when the vault misses", async () => {
    const backend = memoryBackend();
    const env = { KALSHI_API_KEY_ID: "env-key" };
    expect(await getSecret(REF, { backend, envName: "KALSHI_API_KEY_ID", env })).toBe(
      "env-key",
    );
  });

  test("getSecret falls back to env when the vault throws (locked keychain)", async () => {
    const backend: SecretBackend = {
      async get() {
        throw new Error("keychain locked");
      },
      async set() {},
      async delete() { return false; },
    };
    const env = { KALSHI_API_KEY_ID: "env-key" };
    expect(await getSecret(REF, { backend, envName: "KALSHI_API_KEY_ID", env })).toBe(
      "env-key",
    );
  });

  test("getSecret returns null when neither vault nor env has the value", async () => {
    expect(await getSecret(REF, { backend: memoryBackend() })).toBeNull();
  });

  test("vault value wins over the env fallback", async () => {
    const backend = memoryBackend(
      new Map([["com.kalshi-bot/kalshi-api-key-id", "vault-key"]]),
    );
    const env = { KALSHI_API_KEY_ID: "env-key" };
    expect(await getSecret(REF, { backend, envName: "KALSHI_API_KEY_ID", env })).toBe(
      "vault-key",
    );
  });

  test("setSecret stores and getSecret reads back", async () => {
    const backend = memoryBackend();
    await setSecret({ ...REF, value: "PEM" }, backend);
    expect(await getSecret(REF, { backend })).toBe("PEM");
  });

  test("setSecret forwards allowUnrestrictedAccess (macOS CI option)", async () => {
    const received: Array<Record<string, unknown>> = [];
    const backend: SecretBackend = {
      async get() { return null; },
      async set(ref) { received.push({ ...ref }); },
      async delete() { return false; },
    };
    await setSecret({ ...REF, value: "v", allowUnrestrictedAccess: true }, backend);
    expect(received[0]).toMatchObject({ service: REF.service, name: REF.name, value: "v", allowUnrestrictedAccess: true });
  });

  test("deleteSecret removes the entry", async () => {
    const backend = memoryBackend(new Map([["com.kalshi-bot/kalshi-api-key-id", "v"]]));
    await deleteSecret(REF, backend);
    expect(await getSecret(REF, { backend })).toBeNull();
  });
});
