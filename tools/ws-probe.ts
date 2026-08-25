#!/usr/bin/env bun
/**
 * `bun run ws:probe` — probe the Bun.serve WebSocket surface the live
 * channel + tennis orderbook ride on (§114).
 */
import { serve } from "bun";

const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => { results.push({ name, pass, detail }); console.log((pass ? "PASS" : "FAIL") + "  " + name + (detail ? "  — " + detail : "")); };

const seen: string[] = [];
let publishCount = -1;
const server = serve({
  port: 0,
  fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === "/refuse") return new Response("no", { status: 403 });
    if (srv.upgrade(req, { data: { who: "probe" } } as any)) return undefined;
    return new Response("no");
  },
  websocket: {
    open(ws) { seen.push("open:" + (ws.data as unknown as { who?: string }).who); ws.subscribe("topic"); ws.ping(); },
    message(ws, msg) {
      seen.push("msg:" + (typeof msg === "string" ? "string" : msg instanceof Uint8Array ? "Uint8Array" : typeof msg));
      if (typeof msg === "string") { if (msg === "pub") { publishCount = server.publish("topic", "broadcast"); } else { ws.send("echo:" + msg); } }
    },
    pong(ws) { seen.push("pong"); },
    close(ws, code) { seen.push("close:" + code); },
  },
});

async function run() {
  const base = "ws://localhost:" + server.port;
  // B connects first and subscribes to the topic.
  const wsB = new WebSocket(base + "/");
  let bGot: string | null = null;
  wsB.onmessage = (e) => { bGot = String(e.data); };
  await new Promise((r) => (wsB.onopen = r));
  await Bun.sleep(50);
  // A connects and runs the echo + binary tests.
  const wsA = new WebSocket(base + "/");
  await new Promise((r) => (wsA.onopen = r));
  wsA.send("hello");
  const echo = await new Promise((r) => (wsA.onmessage = (e) => r(e.data)));
  seen.push("echo:" + echo);
  wsA.send(new Uint8Array([1, 2, 3]));
  await Bun.sleep(50);
  // Trigger a broadcast publish (server publishes to the topic B joined).
  wsA.send("pub");
  await Bun.sleep(100);
  seen.push("b-got:" + bGot);
  wsA.close(4001, "bye");
  await Bun.sleep(150);
  const refused = await fetch("http://localhost:" + server.port + "/refuse");
  seen.push("refuse-status:" + refused.status);
  const wsRef = new WebSocket(base + "/refuse");
  await Bun.sleep(100);
  seen.push("refuse-state:" + wsRef.readyState);
  check("P1 upgrade data -> open", seen.includes("open:probe"));
  check("P2 text string + echo", seen.includes("msg:string") && seen.includes("echo:echo:hello"));
  check("P3 binary Uint8Array", seen.includes("msg:Uint8Array"));
  check("P4 ping -> auto-pong", seen.includes("pong"));
  check("P5 close code received", seen.includes("close:4001"));
  check("P6 refused upgrade -> client CLOSED", seen.includes("refuse-status:403") && seen.includes("refuse-state:3"));
  check("P7 publish broadcasts to subscribers (not publisher)", typeof publishCount === "number" && publishCount >= 0 && seen.includes("b-got:broadcast"), "publish=" + publishCount + " b-got=" + bGot);
}

await run();
server.stop(true);
const failed = results.filter((r) => !r.pass);
console.log("ws:probe — " + (results.length - failed.length) + "/" + results.length + " checks" + (failed.length ? " · FAIL: " + failed.map((f) => f.name).join(", ") : ""));
process.exit(failed.length === 0 ? 0 : 1);

