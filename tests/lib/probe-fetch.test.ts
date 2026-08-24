// probeFetch — bounded probe network fetch (§57).
import { describe, expect, test } from "bun:test";
import { probeFetch } from "../../src/lib/probe-fetch.ts";

describe("probeFetch", () => {
  test("returns null fast on a non-routable host (no hang)", async () => {
    const t0 = Date.now();
    const res = await probeFetch("http://10.255.255.1/", {}, { timeoutMs: 400, retries: 1 });
    expect(res).toBeNull();
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  test("returns the response for a reachable host", async () => {
    const res = await probeFetch("https://bun.sh/", {}, { timeoutMs: 8000 });
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
  });
});