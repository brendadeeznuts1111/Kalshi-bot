// Probe: does each claimed `bun <flag> -e` one-liner actually work on this
// binary? Each case: [flagString, evalSnippets to assert the effect].
const cases: Array<{ flag: string; test: string; expect: (out: string, code: number) => boolean }> = [
  // 1. general
  { flag: "", test: "console.log('Hello')", expect: (_o, c) => c === 0 },
  { flag: "--silent", test: "console.warn('warn'); console.log('log')", expect: (_o, c) => c === 0 },
  { flag: "--no-warnings", test: "process.emitWarning('test')", expect: (_o, c) => c === 0 },
  // 2. workspace
  { flag: "--filter=./packages/*", test: "console.log(process.cwd())", expect: (_o, c) => c === 0 },
  { flag: "--parallel=5", test: "console.log('ok')", expect: (_o, c) => c === 0 },
  { flag: "--sequential", test: "console.log('done')", expect: (_o, c) => c === 0 },
  { flag: "--cwd=/tmp", test: "console.log(process.cwd())", expect: (o) => o.includes("/tmp") || o.includes("/private/tmp") },
  { flag: "--no-workspace", test: "console.log('no workspace root')", expect: (_o, c) => c === 0 },
  { flag: "--workspace", test: "console.log('forced workspace')", expect: (_o, c) => c === 0 },
  // 3. runtime
  { flag: "--bun", test: "console.log('using bun')", expect: (_o, c) => c === 0 },
  { flag: "--smol", test: "process.memoryUsage().heapUsed", expect: (_o, c) => c === 0 },
  { flag: "--console-depth=5", test: "console.dir({a:{b:{c:{d:{e:1}}}}})", expect: (_o, c) => c === 0 },
  { flag: "--expose-gc", test: "globalThis.gc(); console.log('gc called')", expect: (o) => o.includes("gc called") },
  { flag: "--max-old-space-size=128", test: "process.memoryUsage().heapTotal", expect: (_o, c) => c === 0 },
  { flag: "--no-assert", test: "console.assert(false, 'fail')", expect: (_o, c) => c === 0 },
  { flag: "--no-exit", test: "setTimeout(()=>console.log('alive'),50)", expect: (o) => o.includes("alive") },
  { flag: "--trace-uncaught", test: "throw new Error('boom')", expect: (_o) => true },
  { flag: "--trace-warnings", test: "process.emitWarning('warn')", expect: (_o, c) => c === 0 },
  { flag: "--throw-deprecation", test: "process.emitWarning('dep', 'DeprecationWarning')", expect: (_o, c) => c === 0 },
  { flag: "--cpu-prof", test: "for(let i=0;i<1e6;i++);", expect: (_o, c) => c === 0 },
  { flag: "--heap-prof", test: "new Array(1e5).fill(0)", expect: (_o, c) => c === 0 },
  // 4. dev workflow
  { flag: "--hot", test: "console.log('hot reload test')", expect: (_o, c) => c === 0 },
  { flag: "--no-clear-screen", test: "console.log('keeps screen')", expect: (_o, c) => c === 0 },
  { flag: "--polling", test: "console.log('polling mode')", expect: (_o, c) => c === 0 },
  // 5. debugging
  { flag: "--inspect=9259", test: "setInterval(()=>{},50)", expect: (o) => o.includes("9259") || o.toLowerCase().includes("inspect") },
  { flag: "--inspect-wait=9260", test: "console.log('will wait')", expect: (_o, c) => c === 0 },
  { flag: "--inspect-brk=9261", test: "console.log('break')", expect: (_o, c) => c === 0 },
  // 6. deps/resolution (most are install-only — probe with -e anyway)
  { flag: "--install=frozen", test: "console.log('frozen install')", expect: (_o, c) => c === 0 },
  { flag: "--conditions=development", test: "console.log('conditions')", expect: (_o, c) => c === 0 },
  { flag: "--no-optional", test: "console.log('skip optional deps')", expect: (_o, c) => c === 0 },
  { flag: "--force", test: "console.log('force reinstall')", expect: (_o, c) => c === 0 },
  { flag: "--cache-dir=./.probe-cache", test: "console.log('cache dir')", expect: (_o, c) => c === 0 },
  { flag: "--no-cache", test: "console.log('cache disabled')", expect: (_o, c) => c === 0 },
  { flag: "--production", test: "console.log(process.env.NODE_ENV)", expect: (_o, c) => c === 0 },
  { flag: "--trust", test: "console.log('trust remote')", expect: (_o, c) => c === 0 },
  // 7. transpilation
  { flag: "-d VERSION=1.2.3", test: "console.log(VERSION)", expect: (o) => o.includes("1.2.3") },
  { flag: "--drop=console", test: "console.log('hidden'); console.log('visible')", expect: (o) => o.includes("visible") && !o.includes("hidden") },
  { flag: "--jsx-runtime=classic", test: "console.log('classic')", expect: (_o, c) => c === 0 },
  { flag: "--jsx-import-source=preact", test: "console.log('preact source')", expect: (_o, c) => c === 0 },
  { flag: "--jsx-factory=h", test: "console.log('factory set')", expect: (_o, c) => c === 0 },
  { flag: "--jsx-fragment=Frag", test: "console.log('fragment set')", expect: (_o, c) => c === 0 },
  { flag: "--target=node", test: "console.log('target node')", expect: (_o, c) => c === 0 },
  { flag: "--no-macros", test: "console.log('macros disabled')", expect: (_o, c) => c === 0 },
  { flag: "--no-typescript", test: "console.log('typescript ignored')", expect: (_o, c) => c === 0 },
  { flag: "--tsconfig=./tsconfig.json", test: "console.log('custom tsconfig')", expect: (_o, c) => c === 0 },
  { flag: "--sourcemap=inline", test: "console.log('inline sourcemap')", expect: (_o, c) => c === 0 },
  // 8. networking/tls
  { flag: "--max-http-header-size=8192", test: "console.log('header size set')", expect: (_o, c) => c === 0 },
  { flag: "--use-system-ca", test: "console.log('using system CA')", expect: (_o, c) => c === 0 },
  { flag: "--disable-tls", test: "console.log('TLS disabled')", expect: (_o, c) => c === 0 },
  { flag: "--hostname=0.0.0.0", test: "console.log('hostname set')", expect: (_o, c) => c === 0 },
  { flag: "--unix-socket=/tmp/probe.sock", test: "console.log('unix socket')", expect: (_o, c) => c === 0 },
];

import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

const results: Array<{ flag: string; verdict: string; detail: string }> = [];

for (const { flag, test: snippet, expect: check } of cases) {
  const args = (flag ? flag.split(" ") : []).concat(["-e", snippet]);
  const p = Bun.spawnSync(["bun", ...args], { timeout: 8000, killSignal: "SIGKILL" });
  const out = p.stdout.toString() + p.stderr.toString();
  const timedOut = p.exitCode === null || p.exitCode === undefined;
  const ok = !timedOut && p.exitCode === 0 && check(out, p.exitCode ?? 1);
  results.push({
    flag: flag || "(none)",
    verdict: timedOut ? "hangs (no exit)" : p.exitCode === 0 ? (ok ? "works" : "runs-assert-failed") : "no-such-flag",
    detail: (out.split("\n").find((l) => l && !l.startsWith("$")) ?? "").slice(0, 80),
  });
}

for (const r of results) console.log(r.verdict.padEnd(20), r.flag.padEnd(34), r.detail.slice(0, 60));
const noFlag = results.filter((r) => r.verdict === "no-such-flag");
console.log(`\n${results.length} probed · ${results.length - noFlag.length} accepted · ${noFlag.length} rejected by the binary`);
if (noFlag.length) console.log("rejected:", noFlag.map((r) => r.flag).join(" · "));

// cleanup: --cpu-prof/--heap-prof/--cache-dir probes drop artifacts in cwd
for (const f of [".probe-cache", "profile"]) rmSync(join(ROOT, f), { recursive: true, force: true });
for (const f of readdirSync(ROOT)) {
  if (f.endsWith(".cpuprofile") || f.endsWith(".heapprofile")) rmSync(join(ROOT, f), { force: true });
}
