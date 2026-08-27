import { describe, expect, test } from "bun:test";

// Probe-locked direct ReadableStream behavior on Bun 1.4.0 — see docs/BUN_DIRECT_STREAMS.md.

function direct(events: (c: any) => void): ReadableStream {
  return new ReadableStream({ type: "direct", pull: events } as any);
}

describe("Direct ReadableStream (Bun 1.4.0)", () => {
  test("write+close in pull, consumed via Response.text", async () => {
    const s = direct((c) => { c.write("hello"); c.write(" world"); c.close(); });
    expect(await new Response(s as any).text()).toBe("hello world");
  });

  test("consumable via for-await", async () => {
    const s = direct((c) => { c.write("abc"); c.close(); });
    const out: string[] = [];
    for await (const chunk of s as any) {
      out.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk as any));
    }
    expect(out.join("")).toBe("abc");
  });

  test("write() returns the number of bytes written", async () => {
    const returns: unknown[] = [];
    const s = direct((c) => {
      returns.push(c.write("hello")); // 5
      returns.push(c.write(new Uint8Array([1, 2, 3]))); // 3
      c.close();
    });
    await new Response(s as any).text();
    expect(returns).toEqual([5, 3]);
  });

  test("the exact backpressure snippet still produces correct output (branch is dead code)", async () => {
    const chunks = ["chunk-1-", "chunk-2-", "chunk-3-", "chunk-4"];
    const stream = new ReadableStream({
      type: "direct",
      async pull(controller: any) {
        for (const chunk of chunks) {
          const n = controller.write(chunk);
          if (typeof n === "number" && n < 0) {
            await controller.flush(true);
          }
        }
        controller.close();
      },
    } as any);
    expect(await new Response(stream as any).text()).toBe(chunks.join(""));
  });

  test("pull is called exactly once when everything is written inside it", async () => {
    let pulls = 0;
    const s = direct((c) => { pulls++; c.write("x"); c.close(); });
    await new Response(s as any).text();
    expect(pulls).toBe(1);
  });

  test("flush() variants return undefined and keep the stream intact", async () => {
    const s = direct((c) => {
      c.write("a");
      expect(typeof c.flush()).toBe("undefined");
      c.write("b");
      expect(typeof c.flush(true)).toBe("undefined");
      c.write("c");
      expect(typeof c.flush(false)).toBe("undefined");
      c.close();
    });
    expect(await new Response(s as any).text()).toBe("abc");
  });

  test("write() after close() is silently accepted and returns a number", async () => {
    const s = direct((c) => {
      c.close();
      const r = c.write("x");
      expect(typeof r).toBe("number");
    });
    await new Response(s as any).text();
  });

  test("write() throws on wrong argument counts", async () => {
    const s = direct((c) => {
      let threw0 = false;
      let extraArgReturn: unknown;
      try { c.write(); } catch { threw0 = true; } // zero args: throws
      try { extraArgReturn = c.write("x", "y"); } catch { /* extra args: accepted */ }
      expect(threw0).toBe(true); // zero args -> sync TypeError
      expect(typeof extraArgReturn).toBe("number"); // extra args ignored, bytes returned
      c.write("ok");
      c.close();
    });
    // the extra-arg write still wrote "x", so the body is "xok"
    expect(await new Response(s as any).text()).toBe("xok");
  });
});
