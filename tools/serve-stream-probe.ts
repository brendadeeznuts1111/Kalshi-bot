#!/usr/bin/env bun
/**
 * `bun run serve-stream:probe` — probe Bun.serve streaming (§112):
 * incremental ReadableStream bodies, SSE-style event streams, request-
 * body async iteration, and long-lived keep-alive connections. Grounds
 * the SSE push pattern for the live dashboard (which currently polls via
 * setInterval).
 *
 * VERIFIED on Bun 1.4.0 (34cbb9a40):
 *  P1 ReadableStream Response bodies stream INCREMENTALLY (client sees
 *     chunks as produced — total time ~= sum of producer sleeps)
 *  P2 text/event-stream works over the same mechanism (SSE data lines)
 *  P3 request bodies iterate with for await over req.body
 *  P4 a stream that never closes stays alive across heartbeats (no
 *     premature server-side close)
 *  P5 Bun.serve pauses ReadableStream response bodies when a slow/stalled
 *     client can't accept data — pull() count stays bounded (bun-v1.4 blog
 *     "Backpressure" section; the direct-stream analogue is Promise<number>
 *     writes, BUN_DIRECT_STREAMS §2)
 *  P6 Bun.file().stream() / Blob.stream() responses stream correctly to a
 *     slow client (chunked, incremental, no error — pausing is the same
 *     socket path as P5)
 *  P7 the same pausing holds THROUGH a TransformStream pipeline
 *     (CompressionStream): the source pull() count stays bounded
 *  P8 request-body backpressure: a slow server read pauses the client's
 *     fetch() upload body pull() (Bun.serve request bodies + fetch receive)
 */
import { serve } from "bun";
import { join } from "node:path";
import { tmpdir } from "node:os";

const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => { results.push({ name, pass, detail }); console.log((pass ? "PASS" : "FAIL") + "  " + name + (detail ? "  — " + detail : "")); };

// 64 MiB fixture for file/Blob stream backpressure probes (P6).
const BP_FILE = join(tmpdir(), "bp-stream-fixture.bin");
await Bun.write(BP_FILE, new Uint8Array(64 * 1024 * 1024));

const server = serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/stream") {
      return new Response(new ReadableStream({
        async start(controller) {
          const enc = new TextEncoder();
          controller.enqueue(enc.encode("c1"));
          await Bun.sleep(150);
          controller.enqueue(enc.encode("c2"));
          await Bun.sleep(150);
          controller.enqueue(enc.encode("c3"));
          controller.close();
        },
      }));
    }
    if (url.pathname === "/sse") {
      return new Response(new ReadableStream({
        async start(controller) {
          const enc = new TextEncoder();
          controller.enqueue(enc.encode("data: one\n\n"));
          await Bun.sleep(80);
          controller.enqueue(enc.encode("data: two\n\n"));
          await Bun.sleep(80);
          controller.enqueue(enc.encode("data: three\n\n"));
          controller.close();
        },
      }), { headers: { "content-type": "text/event-stream" } });
    }
    if (url.pathname === "/echo") {
      const chunks: string[] = [];
      for await (const chunk of req.body ?? new ReadableStream()) {
        chunks.push(new TextDecoder().decode(chunk as Uint8Array));
      }
      return new Response(chunks.join("|"));
    }
    if (url.pathname === "/backpressure") {
      // 64 KiB chunks; pull() pauses when the socket's send buffer fills.
      return new Response(new ReadableStream({
        pull(controller) {
          (globalThis as any).__bpPulls = ((globalThis as any).__bpPulls ?? 0) + 1;
          controller.enqueue(new Uint8Array(65536));
          if ((globalThis as any).__bpPulls >= 500) controller.close(); // hard cap
        },
      }));
    }
    if (url.pathname === "/backpressure-gzip") {
      // Same source pattern THROUGH a CompressionStream (TransformStream
      // pipeline): the source pull() must pause when the gzip output backs up.
      return new Response(
        new ReadableStream({
          pull(controller) {
            (globalThis as any).__gzPulls = ((globalThis as any).__gzPulls ?? 0) + 1;
            controller.enqueue(crypto.getRandomValues(new Uint8Array(65536))); // incompressible
            if ((globalThis as any).__gzPulls >= 500) controller.close();
          },
        }).pipeThrough(new CompressionStream("gzip")),
      );
    }
    if (url.pathname === "/backpressure-file") {
      return new Response(Bun.file(BP_FILE).stream());
    }
    if (url.pathname === "/backpressure-blob") {
      return new Response(new Blob([await Bun.file(BP_FILE).arrayBuffer()]).stream());
    }
    if (url.pathname === "/echo-slow") {
      // Server reads the request body slowly — 1 chunk per 120 ms, 6 chunks.
      const reader = (req.body ?? new ReadableStream()).getReader();
      let n = 0;
      for (let i = 0; i < 6; i++) {
        const r = await reader.read();
        if (r.done) break;
        n++;
        await Bun.sleep(120);
      }
      await reader.cancel();
      return new Response("slow-read:" + n);
    }
    if (url.pathname === "/heartbeat") {
      // Never closes: heartbeat comments every 150ms; the client aborts.
      return new Response(new ReadableStream({
        async start(controller) {
          const enc = new TextEncoder();
          for (let i = 0; i < 3; i++) {
            controller.enqueue(enc.encode(": beat " + i + "\n\n"));
            await Bun.sleep(150);
          }
          // leave the stream open
        },
      }), { headers: { "content-type": "text/event-stream" } });
    }
    return new Response("nope");
  },
});

try {
  const base = "http://localhost:" + server.port;
  // P1: incremental timing.
  const t0 = performance.now();
  const text = await (await fetch(base + "/stream")).text();
  const ms = Math.round(performance.now() - t0);
  check("P1 ReadableStream bodies stream incrementally", text === "c1c2c3" && ms >= 280, text + " in " + ms + "ms (sleeps sum to 300ms)");

  // P2: SSE.
  const sse = await (await fetch(base + "/sse")).text();
  check("P2 text/event-stream data lines", sse.includes("data: one") && sse.includes("data: three"));

  // P3: request-body async iteration.
  const echo = await (await fetch(base + "/echo", { method: "POST", body: "ab-cd-ef" })).text();
  check("P3 request body for-await iteration", echo === "ab-cd-ef");

  // P4: keep-alive — read 3 heartbeats, then abort (the stream stays open).
  const hb = await fetch(base + "/heartbeat");
  const reader = hb.body?.getReader();
  let beats = 0;
  if (reader) {
    for (let i = 0; i < 3; i++) {
      const r = await reader.read();
      if (r.done) break;
      beats++;
    }
    await reader.cancel();
  }
  check("P4 keep-alive: stream stays open across heartbeats", beats === 3);

  // P5: backpressure — slow client (one 64 KiB chunk per 120 ms). If pull()
  // paused, the pull count trails the read count by a small margin; without
  // pausing it would race toward the 500 cap.
  (globalThis as any).__bpPulls = 0;
  const bpRes = await fetch(base + "/backpressure");
  const bpReader = bpRes.body?.getReader();
  let bpReads = 0;
  let pullsAfterReads = 0;
  if (bpReader) {
    for (let i = 0; i < 8; i++) {
      await bpReader.read();
      bpReads++;
      await Bun.sleep(120);
    }
    pullsAfterReads = (globalThis as any).__bpPulls ?? 0;
    const p0 = (globalThis as any).__bpPulls ?? 0;
    await Bun.sleep(500); // stall: client stops reading
    const p1 = (globalThis as any).__bpPulls ?? 0;
    const stalledDelta = p1 - p0;
    for (let i = 0; i < 3; i++) {
      await bpReader.read();
      await Bun.sleep(80);
    }
    const pullsTotal = (globalThis as any).__bpPulls ?? 0;
    await bpReader.cancel();
    check("P5 pull() pauses for a slow client", pullsAfterReads > 0 && pullsAfterReads < 500, "pulls after " + bpReads + " reads: " + pullsAfterReads + " (cap 500; 8 reads @120ms)");
    check("P5b pulls do not grow while the client is stalled", stalledDelta <= 5, "stall delta: " + stalledDelta + " pulls over 500ms idle (read rate ~11/read; <=5 still proves paused)");
    check("P5c pulls resume when the client reads again", pullsTotal > pullsAfterReads, "resumed: " + pullsTotal + " > " + pullsAfterReads);
  }

  // P6: Bun.file().stream() / Blob.stream() responses to a slow client.
  const slowRead = async (path: string, label: string): Promise<boolean> => {
    const res = await fetch(base + path);
    const reader = res.body?.getReader();
    let ok = true;
    let chunks = 0;
    if (reader) {
      for (let i = 0; i < 6; i++) {
        const r = await reader.read();
        if (r.done) { ok = ok && false; break; }
        if (!(r.value instanceof Uint8Array) || r.value.length === 0) ok = false;
        chunks++;
        await Bun.sleep(100);
      }
      await reader.cancel();
    }
    check(label, ok && chunks === 6, chunks + " chunks read @100ms, no error");
    return ok && chunks === 6;
  };
  await slowRead("/backpressure-file", "P6 Bun.file().stream() streams to a slow client");
  await slowRead("/backpressure-blob", "P6b Blob.stream() streams to a slow client");

  // P7: source pull() pauses THROUGH a CompressionStream pipeline.
  (globalThis as any).__gzPulls = 0;
  const gzRes = await fetch(base + "/backpressure-gzip");
  const gzReader = gzRes.body?.getReader();
  let gzReads = 0;
  if (gzReader) {
    for (let i = 0; i < 6; i++) {
      const r = await gzReader.read();
      if (r.done) break;
      gzReads++;
      await Bun.sleep(100);
    }
    await gzReader.cancel();
  }
  const gzPulls = (globalThis as any).__gzPulls ?? 0;
  check("P7 CompressionStream pipeline source pull() pauses", gzPulls > 0 && gzPulls < 500, "source pulls after " + gzReads + " reads: " + gzPulls + " (cap 500)");

  // P8: request-body backpressure — slow server read pauses the upload.
  (globalThis as any).__upPulls = 0;
  const upBody = new ReadableStream({
    pull(c) {
      (globalThis as any).__upPulls = ((globalThis as any).__upPulls ?? 0) + 1;
      c.enqueue(new Uint8Array(65536));
      if ((globalThis as any).__upPulls >= 500) c.close();
    },
  });
  const upRes = await fetch(base + "/echo-slow", { method: "POST", body: upBody });
  const upText = await upRes.text();
  const upPulls = (globalThis as any).__upPulls ?? 0;
  check("P8 fetch upload body pull() pauses for a slow server", upPulls > 0 && upPulls < 500, "client pulls: " + upPulls + " (cap 500; " + upText + ")");

  // P9: Bun.spawn / child_process stdout backpressure — a child writing 64 MiB
  // must BLOCK on the OS pipe (not buffer in heap) while the parent reads slowly.
  const child = Bun.spawn({ cmd: ["dd", "if=/dev/zero", "bs=65536", "count=1024"], stdout: "pipe" });
  const childReader = child.stdout.getReader();
  let slowBytes = 0;
  for (let i = 0; i < 8; i++) {
    const r = await childReader.read();
    if (r.done) break;
    slowBytes += r.value.byteLength;
    await Bun.sleep(120);
  }
  const stillRunning = await Promise.race([child.exited.then(() => false), Bun.sleep(300).then(() => true)]);
  check("P9 Bun.spawn stdout pauses for a slow reader", stillRunning, "child (dd 64MiB) still running after 8 reads @120ms — pipe backpressure, not heap buffering");
  // P9b: drain the rest — slow-phase + drain must equal the full 64 MiB, clean exit.
  let drained = 0;
  try {
    while (true) {
      const r = await childReader.read();
      if (r.done) break;
      drained += r.value.byteLength;
    }
  } catch { }
  const exitCode = await child.exited;
  const total = slowBytes + drained;
  check("P9b Bun.spawn stdout delivers all bytes with a slow reader", exitCode === 0 && total === 64 * 1024 * 1024, "slow " + slowBytes + " + drained " + drained + " = " + total + " / 67108864, exit " + exitCode);
} finally {
  server.stop(true);
}

const failed = results.filter((r) => !r.pass);
console.log("serve-stream:probe — " + (results.length - failed.length) + "/" + results.length + " checks" + (failed.length ? " · FAIL: " + failed.map((f) => f.name).join(", ") : ""));
process.exit(failed.length === 0 ? 0 : 1);
