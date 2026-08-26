// Secret registry (S218): typed secret policies + argv-leak scan.
import { describe, expect, test } from "bun:test";
import {
  SECRET_REGISTRY,
  secretPolicy,
  secretAllows,
  argvSecretLeaks,
} from "../../src/lib/secret-registry.ts";

describe("SECRET_REGISTRY", () => {
  test("every Kalshi secret is vault+env only (NEVER argv)", () => {
    for (const name of ["kalshi-api-key-id", "kalshi-private-key"]) {
      const p = secretPolicy(name);
      expect(secretAllows(p, "vault")).toBe(true);
      expect(secretAllows(p, "env")).toBe(true);
      expect(secretAllows(p, "argv")).toBe(false); // process-list leak protection
    }
  });

  test("registry is the single source of truth (S218)", () => {
    expect(secretPolicy("kalshi-api-key-id").name).toBe("kalshi-api-key-id");
    expect(secretPolicy("kalshi-api-key-id").envName).toBe("KALSHI_API_KEY_ID");
    expect(secretPolicy("kalshi-private-key").envName).toBe("KALSHI_PRIVATE_KEY");
    expect(Object.keys(SECRET_REGISTRY).length).toBeGreaterThanOrEqual(2);
  });

  test("unknown secret name throws (no silent raw strings)", () => {
    expect(() => secretPolicy("ghost-secret" as any)).toThrow(/Unknown secret/);
  });
});

describe("argvSecretLeaks", () => {
  test("flags secret-bearing argv flags (values redacted from report)", () => {
    expect(argvSecretLeaks(["--key-secret", "PEMDATA"])).toEqual(["--key-secret"]);
    expect(argvSecretLeaks(["--api-token=sk-123"])).toEqual(["--api-token"]);
    expect(argvSecretLeaks(["--key-file=/path", "--json"])).toEqual(["--key-file"]);
  });

  test("safe flags are not flagged", () => {
    expect(argvSecretLeaks(["--json", "--service=x", "--verbose"])).toEqual([]);
  });
});
