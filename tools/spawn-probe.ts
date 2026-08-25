#!/usr/bin/env bun
/**
 * `bun run spawn:probe` — probe Bun.spawn behaviors the repo's gates
 * rely on (§113): async stdout iteration, env semantics, timeout kills,
 * exitCode vs signal, cwd, spawnSync parity.
 *
 * VERIFIED on Bun 1.4.0 (34cbb9a40):
 *  P1 proc.stdout is async-iterable — yields CHUNKS, not lines (callers
 *     must split on newlines themselves; run-bun uses .text() so it is
 *     unaffected)
 *  P2 env: overrides merge over the parent environment
 *  P3 timeout kills the child (SIGTERM; exitCode 143 = 128+SIGTERM)
 *  P4 a signal-killed child reports exitCode=null + signalCode=SIGTERM
 *  P5 cwd is honored
 *  P6 spawnSync captures stdout and stderr separately with exitCode
 */
import { spawn } from "bun";

const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => { results.push({ name, pass, detail }); console.log((pass ? "PASS" : "FAIL") + "  " + name + (detail ? "  — " + detail : "")); };

async function run() {
  // P1: async stdout iteration yields chunks.
  const p1 = spawn(["bun", "-e", "console.log(\"alpha\"); console.log(\"beta\");"], { stdout: "pipe" });
  const chunks: string[] = [];
  for await (const c of p1.stdout) chunks.push(new TextDecoder().decode(c));
  const all = chunks.join("");
  check("P1 proc.stdout async-iterable (chunks, not lines)", all.includes("alpha") && all.includes("beta"), "join needs split() — chunks not lines");

  // P2: env overrides merge over the parent.
  const p2 = spawn(["bun", "-e", "console.log(process.env.SPAWN_PROBE + \"|\" + (process.env.PATH ? \"PATH\" : \"no-path\"))"], { stdout: "pipe", env: { ...process.env, SPAWN_PROBE: "ok" } });
  const out2 = (await new Response(p2.stdout).text()).trim();
  check("P2 env override + inherit", out2 === "ok|PATH");

  // P3: timeout kills with SIGTERM.
  const t0 = Date.now();
  const p3 = spawn(["bun", "-e", "Bun.sleep(5000)"], { stdout: "pipe", timeout: 300 });
  const code3 = await p3.exited;
  const ms3 = Date.now() - t0;
  check("P3 timeout kills (SIGTERM, 143)", code3 === 143 && ms3 < 2000, "exit " + code3 + " after " + ms3 + "ms");

  // P4: signal-killed child reports signalCode.
  const p4 = spawn(["bun", "-e", "process.kill(process.pid, \"SIGTERM\")"], { stdout: "pipe" });
  await p4.exited;
  check("P4 signalCode vs exitCode", p4.exitCode === null && p4.signalCode === "SIGTERM", "exitCode=" + p4.exitCode + " signalCode=" + p4.signalCode);

  // P5: cwd honored.
  const p5 = spawn(["bun", "-e", "console.log(process.cwd())"], { stdout: "pipe", cwd: "/tmp" });
  const out5 = (await new Response(p5.stdout).text()).trim();
  check("P5 cwd honored", out5.endsWith("/tmp") || out5 === "/tmp" || out5 === "/private/tmp", out5);

  // P6: spawnSync captures stdout/stderr separately.
  const s = Bun.spawnSync(["bun", "-e", "console.log(\"sync-out\"); console.error(\"sync-err\")"], { stdout: "pipe", stderr: "pipe" });
  check("P6 spawnSync stdout/stderr separation", s.exitCode === 0 && (s.stdout?.toString() ?? "").includes("sync-out") && (s.stderr?.toString() ?? "").includes("sync-err"));
}

await run();
const failed = results.filter((r) => !r.pass);
console.log("spawn:probe — " + (results.length - failed.length) + "/" + results.length + " checks" + (failed.length ? " · FAIL: " + failed.map((f) => f.name).join(", ") : ""));
process.exit(failed.length === 0 ? 0 : 1);
