import { describe, expect, test } from "bun:test";

// Probe-locked stream/body behavior on Bun 1.4.0 — see docs/BUN_STREAMS_TLS_WS.md.

async function roundTrip(alg: "gzip" | "deflate", text: string) {
  const cs = new CompressionStream(alg);
  const w = cs.writable.getWriter();
  w.write(new TextEncoder().encode(text));
  await w.close();
  const enc: Uint8Array[] = [];
  for await (const chunk of cs.readable as any) enc.push(chunk as Uint8Array);
  const packed = new Uint8Array(enc.reduce((n, c) => n + c.length, 0));
  let off = 0;
  for (const c of enc) { packed.set(c, off); off += c.length; }
  const ds = new DecompressionStream(alg);
  const dw = ds.writable.getWriter();
  dw.write(packed);
  await dw.close();
  const dec: Uint8Array[] = [];
  for await (const chunk of ds.readable as any) dec.push(chunk as Uint8Array);
  const out = new Uint8Array(dec.reduce((n, c) => n + c.length, 0));
  off = 0;
  for (const c of dec) { out.set(c, off); off += c.length; }
  return { packed: packed.length, out: new TextDecoder().decode(out) };
}

describe("Streams & bodies (Bun 1.4.0)", () => {
  test("ReadableStream/WritableStream are functional", async () => {
    const s = new ReadableStream({ start(c) { c.enqueue("x"); c.close(); } });
    const out: string[] = [];
    for await (const c of s as any) out.push(String(c));
    expect(out).toEqual(["x"]);
  });

  test("CompressionStream/DecompressionStream round-trip gzip", async () => {
    const text = "hello ".repeat(200);
    const { packed, out } = await roundTrip("gzip", text);
    expect(out).toBe(text);
    expect(packed).toBeLessThan(text.length);
  });

  test("CompressionStream/DecompressionStream round-trip deflate", async () => {
    const text = "hello ".repeat(200);
    const { packed, out } = await roundTrip("deflate", text);
    expect(out).toBe(text);
    expect(packed).toBeLessThan(text.length);
  });

  describe("Web Streams fixes (bun-v1.4 blog)", () => {
    test("#25484 clone() after .body access keeps both bodies readable", async () => {
      const resp = new Response("body-data");
      expect(resp.body).toBeTruthy(); // access .body FIRST — the #25484 trigger
      const c = resp.clone();
      expect(await resp.text()).toBe("body-data");
      expect(await c.text()).toBe("body-data");
    });

    test("#29229 Bun.inspect(ReadableStream) prints [class ReadableStream]", () => {
      expect(Bun.inspect(ReadableStream)).toBe("[class ReadableStream]");
    });

    test("removed .formData()/.arrayBuffer() from ReadableStream", () => {
      const s = new ReadableStream();
      expect(typeof (s as any).formData).toBe("undefined");
      expect(typeof (s as any).arrayBuffer).toBe("undefined");
    });

    test("#37692 direct flush-then-write inside pull delivers to pipeTo", async () => {
      let piped = "";
      const s = new ReadableStream({
        type: "direct",
        pull(c: any) {
          c.write("part1-");
          c.flush(true);
          c.write("part2");
          c.close();
        },
      } as any);
      await s.pipeTo(new WritableStream({ write(c) { piped += new TextDecoder().decode(c as any); } }));
      expect(piped).toBe("part1-part2");
    });

    test("#33782 direct pull() serialized on the JS reader path", async () => {
      let concurrent = 0;
      let maxConcurrent = 0;
      const s = new ReadableStream({
        type: "direct",
        async pull(c: any) {
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await Bun.sleep(20);
          concurrent--;
          c.write("x");
          c.close();
        },
      } as any);
      const rd = s.getReader();
      await Promise.all([rd.read(), rd.read()]);
      expect(maxConcurrent).toBe(1);
    });

    test("#32640 contract: direct write() returns non-negative numbers (no n<0 branch)", async () => {
      // Blog claims "write() returns a negative number under backpressure" — on the
      // JS path (and per the 100 MiB slow-client probe) returns are numbers >= 0 or
      // Promise<number>; the n < 0 guard is dead code. See docs/BUN_DIRECT_STREAMS.md §2.
      const returns: unknown[] = [];
      const s = new ReadableStream({
        type: "direct",
        pull(c: any) {
          returns.push(c.write("a"), c.write("b"), c.write("c"));
          c.close();
        },
      } as any);
      const out: string[] = [];
      for await (const chunk of s as any) out.push(new TextDecoder().decode(chunk as Uint8Array));
      expect(out.join("")).toBe("abc");
      for (const r of returns) {
        expect(typeof r).toBe("number");
        expect(r as number).toBeGreaterThanOrEqual(0); // never negative — #32640 contradicted
      }
    });
  });

  test("TextEncoderStream/TextDecoderStream round-trip", async () => {
    const tes = new TextEncoderStream();
    const tw = tes.writable.getWriter();
    tw.write("héllo");
    await tw.close();
    const bytes: BufferSource[] = [];
    for await (const c of tes.readable as any) bytes.push(c as BufferSource);
    const tds = new TextDecoderStream();
    const dw = tds.writable.getWriter();
    for (const b of bytes) dw.write(b);
    await dw.close();
    const parts: string[] = [];
    for await (const s of tds.readable as any) parts.push(String(s));
    expect(parts.join("")).toBe("héllo");
  });

  test("Response.clone()/Request.clone() bodies both readable", async () => {
    const resp = new Response("body-data");
    const r2 = resp.clone();
    expect(await resp.text()).toBe("body-data");
    expect(await r2.text()).toBe("body-data");
    const req = new Request("https://example.com", { method: "POST", body: "payload" });
    const q2 = req.clone();
    expect(await req.text()).toBe("payload");
    expect(await q2.text()).toBe("payload");
  });

  test("WebSocket CloseEvent reports code/wasClean/reason", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req: Request, s: any) { if (s.upgrade(req)) return; return new Response("no"); },
      websocket: { open(ws: any) { ws.close(4001, "bye-now"); }, message() {}, close() {} },
    } as any);
    try {
      const ev = await new Promise<{ code: number; wasClean: boolean; reason: string }>((resolve, reject) => {
        const ws = new WebSocket("ws://localhost:" + server.port);
        ws.onclose = (e) => resolve({ code: e.code, wasClean: e.wasClean, reason: e.reason });
        ws.onerror = () => reject(new Error("ws error"));
      });
      expect(ev).toEqual({ code: 4001, wasClean: true, reason: "bye-now" });
    } finally {
      server.stop();
    }
  });

  test.skip("TransformStream readable terminates after writable close (known 1.4.0 bug)", async () => {
    // KNOWN BUG on Bun 1.4.0 (narrow pattern): the readable side of a generic
    // TransformStream never signals done once the writer closes —
    // for-await/getReader/pipeTo/Response(ts.readable) all hang. NOT covered by
    // bun's own streams suite (274/281 pass on 1.4.0; none exercise this
    // writable.close() -> read-to-done shape). docs/BUN_STREAMS_TLS_WS.md §1.
    // Remove the skip when Bun fixes it.
    const ts = new TransformStream<string, string>({ transform(c, ctrl) { ctrl.enqueue(c); } });
    const w = ts.writable.getWriter();
    w.write("a");
    await w.close();
    const out: string[] = [];
    for await (const c of ts.readable as any) out.push(c as string);
    expect(out).toEqual(["a"]);
  });
});
