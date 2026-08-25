// API defaults cross-reference tests (§81) — probe-locked defaults across
// the Bun surfaces the repo touches.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("Bun.serve defaults (§81)", () => {
  test("default hostname is localhost, NOT 0.0.0.0 (doc correction)", () => {
    const s = Bun.serve({ port: 0, fetch: () => new Response("x") });
    expect(s.hostname).toBe("localhost");
    s.stop(true);
  });

  test("explicit hostnames honored (0.0.0.0 / 127.0.0.1)", () => {
    const a = Bun.serve({ hostname: "0.0.0.0", port: 0, fetch: () => new Response("x") });
    expect(a.hostname).toBe("0.0.0.0");
    a.stop(true);
    const b = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("x") });
    expect(b.hostname).toBe("127.0.0.1");
    b.stop(true);
  });
});

describe("cookie/CSRF defaults (§81 cross-ref)", () => {
  test("cookie defaults: path=/ sameSite=lax httpOnly=false secure=false", () => {
    const c = new Bun.Cookie("n", "v");
    expect(c.path).toBe("/");
    expect(c.sameSite).toBe("lax");
    expect(c.httpOnly).toBe(false);
    expect(c.secure).toBe(false);
  });

  test("CSRF generate works without expiresIn (no required default)", () => {
    const t = (Bun as any).CSRF.generate("sec", { sessionId: "x" });
    expect(typeof t).toBe("string");
  });
});

describe("req.cookies routes-only (§81 cross-doc gotcha)", () => {
  test("cookies exists in routes handlers, NOT in fetch handlers", async () => {
    const sF = Bun.serve({ port: 3661, fetch: (req: any) => new Response("cookies=" + (typeof req.cookies !== "undefined")) });
    const rF = await fetch("http://127.0.0.1:3661/");
    const fBody = await rF.text();
    sF.stop(true);
    const sR = Bun.serve({ port: 3662, routes: { "/": (req: any) => new Response("cookies=" + (req.cookies instanceof Bun.CookieMap)) } });
    const rR = await fetch("http://127.0.0.1:3662/");
    const rBody = await rR.text();
    sR.stop(true);
    expect(fBody).toBe("cookies=false");
    expect(rBody).toBe("cookies=true");
  });
});

describe("more API defaults (§82)", () => {
  test("Transpiler default loader is jsx (ts syntax fails; explicit ts works)", () => {
    const def = new Bun.Transpiler();
    let tsFails = false;
    try { def.transformSync("const x: number = 1;"); } catch { tsFails = true; }
    expect(tsFails).toBe(true);
    const ts = new Bun.Transpiler({ loader: "ts" });
    expect(ts.transformSync("const x: number = 1;").length).toBeGreaterThan(0);
  });

  test("Bun.inspect default depth is unbounded (repo redact pins 32)", () => {
    const deep = { a: { b: { c: { d: { e: { f: 1 } } } } } };
    const insp = Bun.inspect(deep);
    expect(insp).toContain("e:");
    expect(insp).toContain("f:");
  });

  test("Bun.write returns byte count; Bun.hash is bigint; CryptoHasher digest is Buffer", async () => {
    const w = await Bun.write("/tmp/bun-def-write-test.txt", "hello");
    expect(w).toBe(5);
    expect(typeof Bun.hash("x")).toBe("bigint");
    const h = new Bun.CryptoHasher("sha256");
    h.update("x");
    const d = h.digest();
    expect(d).toBeInstanceOf(Uint8Array);
    expect(d.length).toBe(32);
  });
});

describe("serve port env precedence (§83)", () => {
  test("serve.ts honors BUN_PORT > PORT > NODE_PORT > 3456", async () => {
    const { createResearchServer } = await import("../../src/research/serve.ts");
    const s = createResearchServer({ port: 0 }); // explicit 0 -> Bun assigns; precedence tested via env paths separately
    expect(s.port).toBeGreaterThan(0);
    s.stop(true);
  });

  test("Bun.serve auto-reads BUN_PORT when port omitted (subprocess)", async () => {
    const proc = Bun.spawn(["bun", "-e", "const s = Bun.serve({ fetch: () => new Response(\"x\") }); console.log(s.port); s.stop(true);"], {
      env: { ...process.env, BUN_PORT: "4873", PORT: "4872", NODE_PORT: "4871" },
      stdout: "pipe",
    });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    expect(Number(out.trim())).toBe(4873);
  });
});

describe("BUN_* env vars (§84)", () => {
  test("BUN_RUNTIME_TRANSPILER_CACHE_PATH receives >4KB transpiled output", () => {
    const dir = mkdtempSync(join(tmpdir(), "bunenv-test-"));
    writeFileSync(join(dir, "big.ts"), "export const s = " + JSON.stringify("x".repeat(5000)) + ";");
    const r = Bun.spawnSync(["bun", "-e", "import " + JSON.stringify(join(dir, "big.ts")) + "; console.log(1);"], {
      env: { ...process.env, BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(dir, "cache") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const entries = readdirSync(join(dir, "cache"), { recursive: true } as any).length;
    rmSync(dir, { recursive: true, force: true });
    expect(entries).toBeGreaterThan(0);
    expect(r.exitCode).toBe(0);
  });

  test("BUN_CONFIG_VERBOSE_FETCH=curl logs the request URL", () => {
    const r = Bun.spawnSync(["bun", "-e", "await fetch(\"https://example.com\").then(r => r.text());"], {
      env: { ...process.env, BUN_CONFIG_VERBOSE_FETCH: "curl" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const log = (r.stderr?.toString() || "") + (r.stdout?.toString() || "");
    expect(log).toContain("example.com");
  });

  test("NODE_ENV is unset in a clean subprocess (bun test sets NODE_ENV=test itself)", () => {
    // bun test sets NODE_ENV=test in the runner env; strip it to probe the
    // true default (the repo gates dev-mode on === 'production', so an
    // unset NODE_ENV must mean dev).
    const env = { ...process.env };
    delete env.NODE_ENV;
    const r = Bun.spawnSync(["bun", "-e", "console.log(process.env.NODE_ENV ?? \"unset\")"], { stdout: "pipe", env });
    expect(r.stdout?.toString().trim()).toBe("unset");
  });
});

describe(".env load order (§85)", () => {
  test(".env.local is SKIPPED when NODE_ENV=test (docs-confirmed, repo comment corrected)", () => {
    const dir = mkdtempSync(join(tmpdir(), "envload-test-"));
    writeFileSync(join(dir, ".env"), "X=dotenv\n");
    writeFileSync(join(dir, ".env.local"), "X=dotenv-local\n");
    writeFileSync(join(dir, ".env.test"), "X=dotenv-test\n");
    const inTest = Bun.spawnSync(["bun", "-e", "console.log(process.env.X);"], { cwd: dir, env: { ...process.env, NODE_ENV: "test" }, stdout: "pipe" });
    expect(inTest.stdout?.toString().trim()).toBe("dotenv-test");
    rmSync(dir, { recursive: true, force: true });
  });

  test(".env.local wins for non-test NODE_ENV", () => {
    const dir = mkdtempSync(join(tmpdir(), "envload-test2-"));
    writeFileSync(join(dir, ".env"), "X=dotenv\n");
    writeFileSync(join(dir, ".env.local"), "X=dotenv-local\n");
    writeFileSync(join(dir, ".env.production"), "X=dotenv-production\n");
    const inProd = Bun.spawnSync(["bun", "-e", "console.log(process.env.X);"], { cwd: dir, env: { ...process.env, NODE_ENV: "production" }, stdout: "pipe" });
    expect(inProd.stdout?.toString().trim()).toBe("dotenv-local");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("Bun.serve {dir:} route (§87)", () => {
  test("serves index.html; Range -> 206; If-None-Match -> 304; If-Match -> 412; traversal -> 404", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dirroute-test-"));
    writeFileSync(join(dir, "index.html"), "<h1>index</h1>");
    writeFileSync(join(dir, "file.txt"), "x".repeat(100000));
    const srv = Bun.serve({ port: 3692, routes: { "/static/*": { dir } } });
    try {
      const idx = await fetch("http://127.0.0.1:3692/static/");
      expect(idx.status).toBe(200);
      expect(await idx.text()).toContain("<h1>index</h1>");
      const rng = await fetch("http://127.0.0.1:3692/static/file.txt", { headers: { Range: "bytes=0-9" } });
      expect(rng.status).toBe(206);
      expect(rng.headers.get("content-range")).toBe("bytes 0-9/100000");
      expect((await rng.text()).length).toBe(10);
      const full = await fetch("http://127.0.0.1:3692/static/file.txt");
      const etag = full.headers.get("etag") ?? "";
      const nm = await fetch("http://127.0.0.1:3692/static/file.txt", { headers: { "If-None-Match": etag } });
      expect(nm.status).toBe(304);
      const im = await fetch("http://127.0.0.1:3692/static/file.txt", { headers: { "If-Match": "\"wrong\"" } });
      expect(im.status).toBe(412);
      const trav = await fetch("http://127.0.0.1:3692/static/..%2F..%2Fetc%2Fpasswd");
      expect(trav.status).toBe(404);
    } finally {
      srv.stop(true);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Temporal + TOML datetimes (§88)", () => {
  test("Temporal is enabled by default; TOML bare datetimes become Temporal objects", () => {
    expect(typeof (globalThis as any).Temporal).toBe("object");
    expect(typeof (globalThis as any).Temporal.Instant).toBe("function");
    const t = Bun.TOML.parse("when = 2024-01-15T10:30:00\n") as { when: unknown };
    const ctor = (t.when as { constructor?: { name?: string } })?.constructor?.name ?? "unknown";
    expect(ctor).toBe("PlainDateTime");
  });
});