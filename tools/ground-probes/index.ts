/**
 * ground-probes — consolidated runtime assertions for the Bun-grounding gate.
 *
 * P0+P1: every probe below is ported from facts VERIFIED on bun@1.4.0
 * (34cbb9a40, macOS arm64) during the grounding work — the old one-off
 * probe CLIs (fs-probe, image-probe, xml-probe, …) stay until P2 merges them
 * here. Probes are keyed by gate name from src/lib/bun-gates.ts;
 * `bun run ground:check` runs every probe of every wired gate. All probes
 * are offline and use /tmp fixtures only.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface ProbeResult { pass: boolean; detail?: string; }

export interface GroundProbe {
  id: string;
  symbol: string;
  name: string;
  run(): Promise<ProbeResult>;
}

const D = mkdtempSync(join(tmpdir(), "kalshi-ground-"));
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAFElEQVR42mP8z8Dwn4GBgYGJgZGBAQAbYgIBL8f2GQAAAABJRU5ErkJggg==",
  "base64",
);

const p = (id: string, symbol: string, name: string, run: () => Promise<ProbeResult>): GroundProbe => ({ id, symbol, name, run });
const ok = (detail = ""): ProbeResult => ({ pass: true, detail });
const bad = (detail: string): ProbeResult => ({ pass: false, detail });

export const PROBES: Record<string, GroundProbe[]> = {
  // ── fs:probe — Bun.file / Bun.write / stdio / zlib / zstd / Archive / mmap
  "fs:probe": [
    p("fs-1", "Bun.file", "text + MIME inference", async () => {
      const f = Bun.file(D + "/data.txt");
      await Bun.write(f, "hello fs");
      const okText = (await f.text()) === "hello fs";
      const okMime = f.type === "text/plain;charset=utf-8";
      return okText && okMime ? ok(f.type) : bad("text=" + (await f.text()) + " type=" + f.type);
    }),
    p("fs-2", "Bun.file", "missing file: size 0 + exists false", async () => {
      const f = Bun.file(D + "/nope.txt");
      return f.size === 0 && !(await f.exists()) ? ok("size=" + f.size) : bad("size=" + f.size);
    }),
    p("fs-3", "Bun.file.delete", "delete() removes the file", async () => {
      const f = Bun.file(D + "/del.txt");
      await Bun.write(f, "bye");
      await f.delete();
      return !(await f.exists()) ? ok() : bad("still exists");
    }),
    p("fs-4", "Bun.write", "bytes written + overwrite truncates", async () => {
      const n = await Bun.write(D + "/w.txt", "abcdef");
      await Bun.write(D + "/w.txt", "xy");
      const text = await Bun.file(D + "/w.txt").text();
      return n === 6 && text === "xy" ? ok("n=" + n) : bad("n=" + n + " text=" + text);
    }),
    p("fs-5", "Bun.write", "Response body + BunFile copy sources", async () => {
      await Bun.write(D + "/r.txt", new Response("resp-body"));
      await Bun.write(D + "/c.txt", Bun.file(D + "/data.txt"));
      const a = await Bun.file(D + "/r.txt").text();
      const b = await Bun.file(D + "/c.txt").text();
      return a === "resp-body" && b === "hello fs" ? ok() : bad(a + " / " + b);
    }),
    p("fs-6", "Bun.file.slice", "slice offsets read", async () => {
      await Bun.write(D + "/slice.txt", "0123456789");
      return (await Bun.file(D + "/slice.txt").slice(4, 8).text()) === "4567" ? ok() : bad("mismatch");
    }),
    p("fs-7", "Bun.stdout", "stdio handles are Blob (BunFile)", async () => {
      return Bun.stdout instanceof Blob && Bun.stdin instanceof Blob && Bun.stderr instanceof Blob ? ok() : bad("not Blob");
    }),
    p("fs-8", "Bun.gzipSync", "gzip + deflate round-trips", async () => {
      const g = new TextDecoder().decode(Bun.gunzipSync(Bun.gzipSync("compress me")));
      const d = new TextDecoder().decode(Bun.inflateSync(Bun.deflateSync("deflate me")));
      return g === "compress me" && d === "deflate me" ? ok() : bad(g + " / " + d);
    }),
    p("fs-9", "Bun.zstdCompressSync", "zstd sync + async round-trip", async () => {
      const z = Bun.zstdCompressSync("zstd me");
      const s = new TextDecoder().decode(Bun.zstdDecompressSync(z));
      const a = new TextDecoder().decode(await Bun.zstdDecompress(await Bun.zstdCompress("async zstd")));
      return s === "zstd me" && a === "async zstd" ? ok() : bad(s + " / " + a);
    }),
    p("fs-10", "Bun.Archive", "Archive string content round-trips", async () => {
      const A: any = Bun.Archive;
      await A.write(D + "/s.tar", { "s.txt": "hello string" });
      const b = new A(await Bun.file(D + "/s.tar").bytes());
      await b.extract(D + "/xs");
      return (await Bun.file(D + "/xs/s.txt").text()) === "hello string" ? ok() : bad("round-trip failed");
    }),
    p("fs-11", "Bun.Archive", "BunFile VALUE archives as 0 bytes (pinned pitfall)", async () => {
      const A: any = Bun.Archive;
      await A.write(D + "/bf.tar", { "data.txt": Bun.file(D + "/data.txt") }, { compress: "gzip" });
      const b = new A(await Bun.file(D + "/bf.tar").bytes());
      await b.extract(D + "/xbf");
      const content = await Bun.file(D + "/xbf/data.txt").text();
      return content === "" ? ok("0-byte entry confirmed") : bad("expected 0 bytes, got " + JSON.stringify(content));
    }),
    p("fs-12", "Bun.write", "sliced BunFile input is IGNORED (pinned pitfall)", async () => {
      await Bun.write(D + "/full.txt", "0123456789");
      await Bun.write(D + "/out.txt", Bun.file(D + "/full.txt").slice(4, 8));
      const text = await Bun.file(D + "/out.txt").text();
      return text === "0123456789" ? ok("whole file written (slice ignored)") : bad("got " + text);
    }),
    p("fs-13", "Bun.file.size", "size is cached/stale after external grow (pinned pitfall)", async () => {
      const f = Bun.file(D + "/grow.txt");
      await Bun.write(D + "/grow.txt", "0123456789");
      const before = f.size;
      await Bun.write(D + "/grow.txt", "0123456789ABCDEF");
      const stale = f.size === before;
      return stale ? ok("size=" + f.size) : bad("size refreshed unexpectedly: " + f.size);
    }),
    p("fs-14", "BunFile.writer", "FileSink write/flush/end", async () => {
      const w = Bun.file(D + "/sink.txt").writer();
      w.write("abc");
      w.write("def");
      w.flush();
      w.end();
      const text = await Bun.file(D + "/sink.txt").text();
      return text === "abcdef" ? ok() : bad("got " + text);
    }),
    p("fs-15", "Bun.mmap", "mmap length + slice reads", async () => {
      const mm = Bun.mmap(D + "/data.txt");
      return mm.length === 8 && new TextDecoder().decode(mm.slice(0, 5)) === "hello" ? ok("len=" + mm.length) : bad("len=" + mm.length);
    }),
  ],

  // ── format:probe — XML / TOML / JSONL / YAML / JSONC / markdown
  "format:probe": [
    p("fmt-1", "Bun.XML.parse", "compact shape: attributes + arrays (2 clusters)", async () => {
      const parsed: any = Bun.XML.parse('<odds-heat><cluster venue="Center"><print american="-150"/><print american="+120"/></cluster><cluster venue="Court 2"><print american="-200"/></cluster></odds-heat>');
      const c = parsed["odds-heat"]?.cluster?.[0];
      const c2 = parsed["odds-heat"]?.cluster?.[1];
      return c?.["@venue"] === "Center" && c?.print?.[0]?.["@american"] === "-150" && c2?.["@venue"] === "Court 2" ? ok() : bad(JSON.stringify(parsed));
    }),
    p("fmt-2", "Bun.XML.parse", "Blob input parses identically", async () => {
      const xml = '<odds-heat><cluster venue="C"/></odds-heat>';
      const a = JSON.stringify(Bun.XML.parse(xml));
      const b = JSON.stringify(Bun.XML.parse(new Blob([xml])));
      return a === b ? ok() : bad(a + " vs " + b);
    }),
    p("fmt-3", "Bun.XML.parse", "singleton collapse -> object (normalize with asArray)", async () => {
      const parsed: any = Bun.XML.parse('<odds-heat><cluster venue="Only"/></odds-heat>');
      const c = parsed["odds-heat"]?.cluster;
      return c && !Array.isArray(c) && c["@venue"] === "Only" ? ok() : bad(JSON.stringify(c));
    }),
    p("fmt-4", "Bun.TOML.parse", "basic TOML parse", async () => {
      const t: any = Bun.TOML.parse("[server]\nport = 8080\nname = \"x\"");
      return t?.server?.port === 8080 && t?.server?.name === "x" ? ok() : bad(JSON.stringify(t));
    }),
    p("fmt-5", "Bun.JSONL.parse", "basic JSONL parse", async () => {
      const j: any = Bun.JSONL.parse('{"a":1}\n{"b":2}');
      return j?.length === 2 && j[0]?.a === 1 ? ok() : bad(JSON.stringify(j));
    }),
    p("fmt-6", "Bun.YAML.parse", "basic YAML parse", async () => {
      const y: any = Bun.YAML.parse("key: value\nnested:\n  x: 1");
      return y?.key === "value" && y?.nested?.x === 1 ? ok() : bad(JSON.stringify(y));
    }),
    p("fmt-7", "Bun.markdown", "markdown.html renders headings (1.4.0: object with html/ansi/render/react)", async () => {
      const m: string = (Bun.markdown as any).html("# Title\nBody");
      return m.includes("<h1>") ? ok() : bad(m.slice(0, 80));
    }),
  ],

  // ── image:probe — Bun.Image pipeline
  "image:probe": [
    p("img-1", "Bun.Image", "metadata from encoded bytes", async () => {
      const meta = await new Bun.Image(TINY_PNG).metadata();
      return meta.width === 2 && meta.height === 1 && meta.format === "png" ? ok(JSON.stringify(meta)) : bad(JSON.stringify(meta));
    }),
    p("img-2", "Bun.Image", "chainable resize.webp.write round-trip", async () => {
      const out = D + "/thumb.webp";
      await new Bun.Image(TINY_PNG).resize(8, 8).webp({ quality: 80 }).write(out);
      const meta = await new Bun.Image(Bun.file(out)).metadata();
      return meta.width === 8 && meta.height === 8 && meta.format === "webp" ? ok() : bad(JSON.stringify(meta));
    }),
    p("img-3", "Bun.Image", "width/height are -1 before the first terminal", async () => {
      const img = new Bun.Image(TINY_PNG);
      return img.width === -1 && img.height === -1 ? ok() : bad(img.width + "x" + img.height);
    }),
    p("img-4", "Bun.Image", "placeholder returns a data: URL", async () => {
      const ph = await new Bun.Image(TINY_PNG).placeholder();
      return typeof ph === "string" && ph.startsWith("data:") ? ok() : bad(String(ph).slice(0, 40));
    }),
  ],

  // ── crypto:probe
  "crypto:probe": [
    p("cr-1", "Bun.CryptoHasher", "sha256 hex digest", async () => {
      const h = new Bun.CryptoHasher("sha256").update("abc").digest("hex");
      return typeof h === "string" && h.length === 64 ? ok() : bad("len=" + String(h).length);
    }),
    p("cr-2", "Bun.hash", "deterministic 64-bit hash", async () => {
      return Bun.hash("ground-probe") === Bun.hash("ground-probe") ? ok(String(Bun.hash("ground-probe"))) : bad("non-deterministic");
    }),
    p("cr-3", "Bun.deepEquals", "deep equality", async () => {
      return Bun.deepEquals({ a: [1, 2] }, { a: [1, 2] }) && !Bun.deepEquals({ a: 1 }, { a: 2 }) ? ok() : bad("mismatch");
    }),
    p("cr-4", "crypto.subtle ML-DSA", "post-quantum keygen (verified on 1.4.0; types lag — cast)", async () => {
      const subtle = crypto.subtle as any;
      const kp = await subtle.generateKey({ name: "ML-DSA-65" }, false, ["sign", "verify"]);
      const okKp = kp && typeof kp.publicKey === "object" && typeof kp.privateKey === "object";
      const sig = await subtle.sign({ name: "ML-DSA-65" }, kp.privateKey, new TextEncoder().encode("pq"));
      return okKp && sig instanceof ArrayBuffer && sig.byteLength > 0 ? ok("sig=" + sig.byteLength + "B") : bad("keygen/sign failed");
    }),
    p("cr-6", "node:crypto ML-KEM/ML-DSA", "post-quantum via generateKeyPairSync(algorithm) (NOT named exports)", async () => {
      const nc: any = await import("node:crypto");
      const kem = nc.generateKeyPairSync("ml-kem-768");
      const dsa = nc.generateKeyPairSync("ml-dsa-65");
      return kem.publicKey && dsa.publicKey ? ok() : bad("keygen failed");
    }),
    p("cr-7", "bun repl", "native REPL banner (async spawn, piped stdin)", async () => {
      const proc = Bun.spawn({ cmd: ["bun", "repl"], stdin: "pipe", stdout: "pipe", stderr: "pipe" });
      proc.stdin.write("1+1\n");
      proc.stdin.end();
      const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
      const code = await proc.exited;
      return code === 0 && (out + err).includes("Welcome to Bun") ? ok() : bad((out + err).slice(0, 60));
    }),
    p("cr-5", "process.on memoryPressure", "OS low-memory event registers (types lag — not in 1.4.0 bun-types)", async () => {
      let triggered = false;
      const h = () => { triggered = true; };
      process.on("memoryPressure", h);
      process.removeListener("memoryPressure", h);
      return triggered === false ? ok("event registered (not triggered)") : bad("unexpected");
    }),
  ],

  // ── runtime:probe
  "runtime:probe": [
    p("rt-1", "Bun.version", "pinned version", async () => {
      return Bun.version === "1.4.0" ? ok(Bun.version) : bad("expected 1.4.0, got " + Bun.version);
    }),
    p("rt-2", "Bun.revision", "revision is a string", async () => {
      return typeof Bun.revision === "string" && Bun.revision.length > 0 ? ok(Bun.revision.slice(0, 10)) : bad("missing");
    }),
    p("rt-4", "Bun.S3Client", "S3Client class exists on Bun (CORRECTED — not Bun.s3.S3Client); no putObject", async () => {
      const hasCtor = typeof (Bun as any).S3Client === "function";
      let client: any = null;
      try { client = new (Bun as any).S3Client({ accessKeyId: "x", secretAccessKey: "y", region: "us-east-1" }); } catch {}
      const okShape = hasCtor && client && typeof client.file === "function" && typeof client.write === "function";
      const noPut = client ? typeof client.putObject === "undefined" : true;
      return okShape && noPut ? ok("S3Client ctor + file/write; putObject absent") : bad("shape mismatch");
    }),
    p("rt-5", "Bun.serve h2", "h2 option ACCEPTED at runtime (CORRECTED — types lag, option not rejected)", async () => {
      try {
        const s = await (Bun.serve as any)({ port: 0, fetch: () => new Response("x"), h2: true });
        s.stop(true);
        return ok("serve({h2:true}) accepted");
      } catch (e) { return bad((e as Error).message.slice(0, 60)); }
    }),
    p("rt-3", "Bun.env / argv / sleep", "env + argv + sleep resolve", async () => {
      const env = typeof Bun.env === "object" && Bun.env !== null;
      const argv = Array.isArray(Bun.argv) && Bun.argv.length > 0;
      await Bun.sleep(1);
      return env && argv ? ok() : bad("env=" + env + " argv=" + argv);
    }),
  ],

  // ── ansi:probe
  "ansi:probe": [
    p("an-1", "Bun.inspect", "inspect returns a string", async () => {
      const s = Bun.inspect({ a: 1 });
      return typeof s === "string" && s.includes("a") ? ok() : bad(String(s));
    }),
    p("an-2", "Bun.escapeHTML", "escapes HTML", async () => {
      return Bun.escapeHTML("<a&b>") === "&lt;a&amp;b&gt;" ? ok() : bad(Bun.escapeHTML("<a&b>"));
    }),
    p("an-3", "Bun.stringWidth", "string width", async () => {
      return Bun.stringWidth("abc") === 3 ? ok() : bad(String(Bun.stringWidth("abc")));
    }),
  ],

  // ── shell:probe — Bun.$
  "shell:probe": [
    p("sh-1", "Bun.$", "echo round-trip", async () => {
      const out = (await Bun.$`echo ground-probe-shell`.text()).trim();
      return out === "ground-probe-shell" ? ok(out) : bad("got " + out);
    }),
  ],

  // ── fsx:probe — URL helpers + Glob
  "fsx:probe": [
    p("fsx-1", "Bun.fileURLToPath", "file URL <-> path round-trip", async () => {
      const path = "/tmp/kalshi-ground.txt";
      const back = Bun.fileURLToPath(Bun.pathToFileURL(path));
      return back === path ? ok() : bad(back);
    }),
    p("fsx-2", "Bun.Glob", "glob match", async () => {
      const g = new Bun.Glob("*.txt");
      return g.match("a.txt") && !g.match("a.md") ? ok() : bad("match mismatch");
    }),
  ],
};

/** Probes registered for a (normalized) gate name. */
export function probesForGate(gate: string): GroundProbe[] {
  return PROBES[gate] ?? [];
}

/** Gate names that have probes wired. */
export const WIRED_GATES: string[] = Object.keys(PROBES);

/** Run every probe for a gate; returns failures. */
export async function runGateProbes(gate: string): Promise<{ failures: ProbeResult[]; total: number; ids: string[] }> {
  const probes = probesForGate(gate);
  const failures: ProbeResult[] = [];
  const ids: string[] = [];
  for (const probe of probes) {
    ids.push(probe.id);
    try {
      const r = await probe.run();
      if (!r.pass) failures.push({ pass: false, detail: probe.id + " " + probe.name + ": " + (r.detail ?? "") });
    } catch (e) {
      failures.push({ pass: false, detail: probe.id + " " + probe.name + " threw: " + (e as Error).message });
    }
  }
  return { failures, total: probes.length, ids };
}
