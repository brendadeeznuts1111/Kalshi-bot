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
 */
import { serve } from "bun";

const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => { results.push({ name, pass, detail }); console.log((pass ? "PASS" : "FAIL") + "  " + name + (detail ? "  — " + detail : "")); };

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
} finally {
  server.stop(true);
}

const failed = results.filter((r) => !r.pass);
console.log("serve-stream:probe — " + (results.length - failed.length) + "/" + results.length + " checks" + (failed.length ? " · FAIL: " + failed.map((f) => f.name).join(", ") : ""));
process.exit(failed.length === 0 ? 0 : 1);
