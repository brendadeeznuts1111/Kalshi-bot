#!/usr/bin/env bun
/**
 * `bun run shell:probe` — probe the Bun.Shell surface (§127): `$` from
 * "bun" (NOT a global), capture methods, error handling, redirection,
 * escaping. All checks verified against Bun 1.4.0 (34cbb9a40) and the
 * installed bun-types docs (docs/runtime/shell.mdx).
 */
const results: { name: string; pass: boolean; detail: string }[] = [];
const check = (name: string, pass: boolean, detail = "") => { results.push({ name, pass, detail }); console.log((pass ? "PASS" : "FAIL") + "  " + name + (detail ? "  — " + detail : "")); };

let dollar: any = (globalThis as any).$;
let dollarSource = "global";
if (typeof dollar === "undefined") {
  const b = await import("bun");
  dollar = (b as any).$;
  dollarSource = "bun-import";
}

// P1: `$` is importable from "bun" (NOT a global) — shell.mdx quickstart.
check("P1 $ importable from bun (not global)", typeof dollar === "function" && dollarSource === "bun-import", dollarSource);

if (typeof dollar === "function") {
  // P2: .text() captures stdout including the trailing newline.
  const t = (await dollar`echo hello world`.text());
  check("P2 .text() captures", t === "hello world\n", JSON.stringify(t));

  // P3: .quiet() -> { stdout: Buffer, exitCode }; awaiting without a
  // capture method inherits stdout to the parent instead.
  const plain = await dollar`echo plain`.quiet();
  check("P3 .quiet() yields Buffer stdout", Buffer.isBuffer(plain.stdout) && plain.exitCode === 0 && plain.stdout.toString() === "plain\n", "hex=" + plain.stdout.toString("hex"));

  // P4: non-zero exit throws ShellError carrying exitCode (default).
  try { await dollar`exit 3`.text(); check("P4 non-zero throws", false, "no-throw"); }
  catch (e) { check("P4 non-zero throws", (e as Error).name === "ShellError" && (e as any).exitCode === 3, "exitCode=" + String((e as any).exitCode)); }

  // P5: .nothrow() per-promise AND $.nothrow() global toggle.
  const nt = await dollar`exit 3`.nothrow().quiet();
  dollar.nothrow();
  const gnt = await dollar`exit 3`.quiet();
  check("P5 .nothrow() + $.nothrow() global", nt.exitCode === 3 && gnt.exitCode === 3, "per=" + nt.exitCode + " global=" + gnt.exitCode);

  // P6: .cwd() and .env() overrides.
  const cwd = await dollar`pwd`.cwd(process.cwd() + "/tools").text();
  const env = await dollar`echo $SHELL_PROBE_X`.env({ SHELL_PROBE_X: "yes" }).text();
  check("P6 .cwd() + .env()", cwd === process.cwd() + "/tools\n" && env === "yes\n", cwd.trim());

  // P7: .json() parses stdout.
  const j = JSON.stringify({ a: 1 });
  const jv = await dollar`echo ${j}`.json();
  check("P7 .json() parses", jv && (jv as any).a === 1, JSON.stringify(jv));

  // P8: .lines() is an ASYNC ITERABLE (for await) — NOT a plain array.
  const got: string[] = [];
  for await (const line of dollar`echo one; echo two`.lines()) { got.push(String(line)); }
  check("P8 .lines() for-await", got.length >= 2 && got.includes("one") && got.includes("two"), JSON.stringify(got));

  // P9: .bytes() -> Uint8Array.
  const b = await dollar`printf hello`.bytes();
  check("P9 .bytes() Uint8Array", b instanceof Uint8Array && new TextDecoder().decode(b) === "hello", new TextDecoder().decode(b));

  // P10: stdin via < ${Response} and < ${Buffer}; a plain JS string is
  // treated as a FILE PATH (docs list only Buffer/typed-array/Response/
  // Bun.file as stdin sources).
  const rIn = await dollar`cat < ${new Response("hi")}`.text();
  const bIn = await dollar`cat < ${Buffer.from("buf")}`.text();
  const strIn = await dollar`cat < ${"str-in"}`.quiet();
  check("P10 stdin Response/Buffer (string = file path)", rIn === "hi" && bIn === "buf" && strIn.exitCode === 1, "str exit=" + strIn.exitCode);

  // P11: interpolation is auto-escaped — no shell injection.
  const inj = "a$(touch scratch/pwn)";
  const iv = await dollar`echo ${inj}`.text();
  const pwned = await import("node:fs").then((f) => f.existsSync("scratch/pwn"));
  check("P11 interpolation escaped (no injection)", iv === inj + "\n" && !pwned, JSON.stringify(iv));
  await import("node:fs").then(async (f) => { if (pwned) { try { await f.promises.unlink("scratch/pwn"); } catch { /* ok */ } } });

  // P12: $.escape/$.braces helpers + stderr/stdout separation (2>&1).
  const sep = await dollar`echo err-out 1>&2; echo out`.quiet();
  check("P12 helpers + stderr separation", typeof dollar.escape === "function" && typeof dollar.braces === "function" && sep.stdout.toString() === "out\n" && sep.stderr.toString() === "err-out\n", "esc=" + typeof dollar.escape + " brace=" + typeof dollar.braces);
}

const failed = results.filter((r) => !r.pass);
console.log("shell:probe — " + (results.length - failed.length) + "/" + results.length + " checks" + (failed.length ? " · FAIL: " + failed.map((f) => f.name).join(", ") : ""));
process.exit(failed.length === 0 ? 0 : 1);

export {};
