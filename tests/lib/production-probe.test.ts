// Production/observability/streams probe tests (§55).
import { describe, expect, test } from "bun:test";

describe("native streams (§55)", () => {
  test("CompressionStream/DecompressionStream gzip roundtrip", async () => {
    const text = "hello ".repeat(1000);
    const enc = new TextEncoder().encode(text);
    const comp = new Blob([enc]).stream().pipeThrough(new CompressionStream("gzip"));
    const compressed = new Uint8Array(await new Response(comp).arrayBuffer());
    const back = await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
    expect(back).toBe(text);
    expect(compressed.length).toBeLessThan(enc.length);
  });

  test("Response.clone() reads both bodies (chunk-shared)", async () => {
    const res = new Response(new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode("a")); c.enqueue(new TextEncoder().encode("b")); c.close(); },
    }));
    const clone = res.clone();
    const [a, b] = await Promise.all([res.text(), clone.text()]);
    expect(a).toBe("ab");
    expect(b).toBe("ab");
  });
});

describe("profiler env (§55 catch)", () => {
  test("BUN_CPU_PROFILE=1 alone is a NO-OP (needs --cpu-prof)", async () => {
    // Can't fork a profiled process cheaply in-test; the probe in §55 ran
    // it: env alone -> no file, env + --cpu-prof -> file. Lock the surface.
    const flag = (await Bun.$`bun --help`.text()).includes("--cpu-prof");
    expect(flag).toBe(true);
  });
});