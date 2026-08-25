// probeHttp retry behavior (§108) — network-level failures retried once,
// HTTP statuses never retried. Injected fetch keeps this offline.
import { describe, expect, test } from "bun:test";
import { probeHttp } from "../../src/institutions/url-health.ts";

describe("probeHttp retry (§108)", () => {
  test("transient network failure self-heals on the retry", async () => {
    let heads = 0;
    const fake = (async (input: any, init: any) => {
      if (init?.method === "HEAD") heads++;
      if (heads === 1) throw new Error("socket hang up");
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    const r = await probeHttp("https://example.test/status", [200], 5_000, fake);
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    expect(heads).toBe(2); // one retry
  });

  test("a dead endpoint fails both attempts with the retry noted", async () => {
    const fake = (async () => { throw new Error("ENOTFOUND"); }) as unknown as typeof fetch;
    const r = await probeHttp("https://dead.test/status", [200], 5_000, fake);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(0);
    expect(r.error ?? "").toContain("after 1 retry");
  });

  test("HTTP statuses are real signals and are NOT retried", async () => {
    let heads = 0;
    const fake = (async (input: any, init: any) => { if (init?.method === "HEAD") heads++; return new Response(null, { status: 503 }); }) as unknown as typeof fetch;
    const r = await probeHttp("https://example.test/status", [200], 5_000, fake);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(503);
    expect(heads).toBe(1); // no retry on an answered request
  });
});
