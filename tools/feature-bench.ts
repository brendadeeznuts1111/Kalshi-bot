#!/usr/bin/env bun
/**
 * bun run bench:feature — micro-benchmarks for the branding/content surfaces
 * added in the grounding session (color kernel extended formats, markdown
 * pipeline, watermark ML-DSA crypto, theme CSS generation, image pipeline).
 *
 * Emits:
 *   research/outputs/feature-bench.md + feature-bench.json  (full report;
 *     gitignored research/outputs/ pattern)
 *   tools/feature-bench-evidence.json                        (committed snapshot)
 *
 * Grounding rule (mirrors tools/build-artifact-evidence.ts): every number is
 * OBSERVED on this machine against the pinned runtime — docs claims are
 * compared against these observations, never the other way around. The
 * committed evidence file is deterministic in shape: no wall timestamps.
 *
 * @see src/lib/color/kernel.ts (parseExtendedColor / convertColorFallback)
 * @see src/lib/markdown.ts / src/lib/markdown-images.ts
 * @see src/lib/watermark-sign.ts (ML-DSA-65 sign/verify)
 * @see src/institutions/design-tokens.ts (baseCssVars)
 */
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { cpus } from "node:os";

const ROOT = join(import.meta.dir, "..");
const OUT_DIR = join(ROOT, "research/outputs");
const EVIDENCE = join(ROOT, "tools/feature-bench-evidence.json");

// ── imports under test ──────────────────────────────────────────────────
const { convertColorFallback, parseExtendedColor } = await import("../src/lib/color/kernel.ts");
const { markdownToHtml, markdownToHtmlAccent } = await import("../src/lib/markdown.ts");
const { baseCssVars } = await import("../src/institutions/design-tokens.ts");
const { themeManifest } = await import("../src/lib/color/theme.ts");
const { processMarkdownImages } = await import("../src/lib/markdown-images.ts");

// ── harness ──────────────────────────────────────────────────────────────
type Metric = { label: string; unit: string; value: number; note?: string };
const metrics: Metric[] = [];

/** Median-of-runs ns per op for fn(). fn() must execute ONE op. */
async function benchNs(label: string, fn: () => unknown, opts?: { runs?: number; iters?: number; note?: string }): Promise<void> {
  const runs = opts?.runs ?? 7;
  const iters = opts?.iters ?? 50_000;
  for (let i = 0; i < 2000; i++) fn(); // warm-up (JIT)
  const samples: number[] = [];
  for (let r = 0; r < runs; r++) {
    const t0 = Bun.nanoseconds();
    for (let i = 0; i < iters; i++) fn();
    samples.push((Bun.nanoseconds() - t0) / iters);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)]!;
  const entry: Metric = { label, unit: "ns/op", value: Math.round(median) };
  if (opts?.note) entry.note = opts.note;
  metrics.push(entry);
  console.log(label.padEnd(46) + String(Math.round(median)).padStart(10) + " ns/op");
}

async function benchMs(label: string, fn: () => Promise<unknown>, runs = 5): Promise<void> {
  await fn(); // warm-up
  const samples: number[] = [];
  for (let r = 0; r < runs; r++) {
    const t0 = Bun.nanoseconds();
    await fn();
    samples.push((Bun.nanoseconds() - t0) / 1e6);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)]!;
  metrics.push({ label, unit: "ms/op", value: Math.round(median * 100) / 100 });
  console.log(label.padEnd(46) + String(Math.round(median * 100) / 100).padStart(10) + " ms/op");
}

// ── fixtures ─────────────────────────────────────────────────────────────
const HEX = "#4da3ff";
const EXT_INPUTS = ["oklab(0.5 0.1 0.1)", "oklch(0.5 0.2 120)", "hsv(200 80% 70%)", "lab(50% 50 50)", "lch(50% 50 100)"];
const MD_SMALL = "# Heading\n\nSome **bold** text with a [link](https://bun.sh) and `code`.\n\n- a\n- b\n";
const MD_LARGE = Array.from({ length: 60 }, (_, i) => "## Section " + i + "\n\nBody paragraph " + i + " with *emphasis* and `inline` code.\n\n| A | B |\n| - | - |\n| 1 | 2 |\n").join("\n");

// 1×1 PNG (tiny valid file)
const PNG_1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const IMG_DIR = join("/tmp", "feature-bench-img");
const IMG_SRC = join(IMG_DIR, "src.png");
mkdirSync(IMG_DIR, { recursive: true });
await Bun.write(IMG_SRC, PNG_1x1);
const MD_IMG = "![p](" + IMG_SRC + ")\n";

// ── run ──────────────────────────────────────────────────────────────────
console.log("feature bench — Bun " + Bun.version + " · " + process.platform + "/" + process.arch + "\n");

// 1. color kernel: extended output formats (one fn per format)
for (const f of ["lch", "oklab", "oklch", "hsv", "lab", "hsl", "number"] as const) {
  await benchNs("convertColorFallback hex -> " + f, () => { convertColorFallback(HEX, f); });
}

// 2. color kernel: inverse parsers
for (const s of EXT_INPUTS) {
  await benchNs("parseExtendedColor(" + s.split("(")[0] + ")", () => { parseExtendedColor(s); });
}

// 3. native Bun.color for reference (lab output)
await benchNs("Bun.color hex -> lab (native)", () => { Bun.color(HEX, "lab"); });

// 4. markdown pipeline
await benchNs("markdownToHtml docs (small)", () => { markdownToHtml(MD_SMALL, "docs"); }, { iters: 5000 });
await benchNs("markdownToHtml docs (large)", () => { markdownToHtml(MD_LARGE, "docs"); }, { iters: 500 });

// 5. theme CSS generation
await benchNs("baseCssVars() theme CSS", () => { baseCssVars(); });
await benchNs("themeManifest() JSON", () => { themeManifest(); });

// 6. watermark crypto (sign + verify, no WebView)
const { generateKeyPairSync, sign, verify } = await import("node:crypto");
const { privateKey, publicKey } = generateKeyPairSync("ml-dsa-65", {});
const payload = new Uint8Array(4096).fill(7);
await benchNs("ml-dsa-65 sign (4 KiB)", () => { sign(null, payload, privateKey); });
const sig = sign(null, payload, privateKey);
await benchNs("ml-dsa-65 verify (4 KiB)", () => { verify(null, payload, publicKey, sig); });
await benchMs("ml-dsa-65 keygen", async () => { generateKeyPairSync("ml-dsa-65", {}); });

// 7. image pipeline (Bun.Image resize -> webp -> write)
await benchMs("processMarkdownImages (1x1 -> webp)", async () => {
  await processMarkdownImages(MD_IMG, { outDir: join(IMG_DIR, "out") });
});

// 8. canonical asset generator (image process + hash + canonicalize)
const { generateCanonicalAsset, sortObjectKeys, normalizeNumbers } = await import("../src/lib/canonical-asset.ts");
const CANON_OPTS = { width: 8, height: 8, fit: "inside", name: "bench", timestamp: 0, extra: { price: 0.1 + 0.2, list: [3, 1, 2, "z"] } } as const;
await benchMs("generateCanonicalAsset (1x1 -> 8x8 png, full tuple)", async () => {
  await generateCanonicalAsset(IMG_SRC, CANON_OPTS);
});
// metadata canonicalization only (no image work)
const META = { asset_hash: "0xabc", version: "1.0.0", created_at: 0, schema: "canonical-asset/v1", name: "x", description: "", extra: { price: 0.1 + 0.2, list: [3, 1, 2, { b: 1, a: 2 }, "z"] } };
await benchNs("metadata canonicalization (sort+normalize+stringify)", () => {
  JSON.stringify(sortObjectKeys(normalizeNumbers(META), true));
});
// CryptoHasher: buffer vs string on 4 KiB (grounds the "pass Uint8Array" claim)
const HASH_BUF = new Uint8Array(4096).fill(9);
const HASH_STR = "x".repeat(4096);
await benchNs("CryptoHasher.hash sha256 (4 KiB buffer)", () => { Bun.CryptoHasher.hash("sha256", HASH_BUF, "hex"); });
await benchNs("CryptoHasher.hash sha256 (4 KiB string)", () => { Bun.CryptoHasher.hash("sha256", HASH_STR, "hex"); });

// ── report ───────────────────────────────────────────────────────────────
mkdirSync(OUT_DIR, { recursive: true });
const report = {
  tool: "tools/feature-bench.ts",
  bunVersion: Bun.version,
  platform: process.platform,
  arch: process.arch,
  cpu: cpus()[0]?.model ?? "unknown",
  metrics,
};
const md = [
  "# Feature bench — branding/content surfaces (Bun " + Bun.version + ")",
  "",
  "Machine: " + report.platform + "/" + report.arch + " · " + report.cpu,
  "",
  "| metric | value |",
  "| --- | --- |",
  ...metrics.map((m) => "| " + m.label + " | " + m.value + " " + m.unit + (m.note ? " (" + m.note + ")" : "") + " |"),
  "",
  "Every number is observed on this machine against the pinned runtime; docs",
  "claims are compared against these observations (AGENT-PITFALLS grounding rule).",
  "",
].join("\n");
writeFileSync(join(OUT_DIR, "feature-bench.json"), JSON.stringify(report, null, 2) + "\n");
writeFileSync(join(OUT_DIR, "feature-bench.md"), md);

// committed evidence: same shape, no wall timestamps (deterministic per machine)
const evidence = { tool: report.tool, bunVersion: report.bunVersion, platform: report.platform, arch: report.arch, cpu: report.cpu, metrics: report.metrics };
writeFileSync(EVIDENCE, JSON.stringify(evidence, null, 2) + "\n");
console.log("\nreport: research/outputs/feature-bench.{md,json} · evidence: " + EVIDENCE);