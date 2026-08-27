#!/usr/bin/env bun
/**
 * `bun run ground:check` — verify the Bun grounding LIVE:
 *   1. shape freshness  — tools/bun-shape.json matches the installed runtime
 *   2. coverage drift   — every used Bun.* token has a manifest row
 *   3. probes           — every wired gate runs its consolidated assertions
 *   4. stale URLs       — no dead bun.com/doc references in the repo
 * Optional `--online` HEAD-checks every manifest docsUrl (needs network).
 * Exits 1 on any failure. Wired into `bun run check`.
 */
import { parseArgs } from "node:util";
import {
  MANIFEST_PATH,
  findStaleUrls,
  loadShape,
  resolveToken,
  scanBunTokens,
  shapeLookup,
} from "../src/lib/ground.ts";
import type { GroundManifest, GroundRow } from "../src/lib/ground.ts";
import { runGateProbes } from "./ground-probes/index.ts";

export interface GroundCheckReport {
  code: number;
  lines: string[];
  failures: string[];
  counts: { freshness: number; coverage: number; probes: number; urls: number };
}

export async function runGroundCheck(opts: { online?: boolean; root?: string } = {}): Promise<GroundCheckReport> {
  const ROOT = opts.root ?? import.meta.dir + "/..";
  const lines: string[] = [];
  const failures: string[] = [];
  const counts = { freshness: 0, coverage: 0, probes: 0, urls: 0 };

  // 1. shape freshness
  let shape;
  try {
    shape = await loadShape(ROOT);
  } catch (e) {
    return { code: 1, lines: [], failures: ["ground:check — shape missing: run `bun run shape:gen` (" + (e as Error).message + ")"], counts };
  }
  if (shape.bunVersion !== Bun.version) {
    failures.push("shape version " + shape.bunVersion + " != runtime " + Bun.version + " — run shape:gen");
  } else {
    counts.freshness += 1;
  }
  if (shape.bunRevision !== Bun.revision) {
    failures.push("shape revision " + shape.bunRevision.slice(0, 10) + " != runtime " + Bun.revision.slice(0, 10) + " — run shape:gen");
  } else {
    counts.freshness += 1;
  }
  lines.push("freshness: shape " + shape.bunVersion + "@" + shape.bunRevision.slice(0, 10) + " vs runtime " + Bun.version + "@" + Bun.revision.slice(0, 10));

  // 2. manifest + coverage drift
  let manifest: GroundManifest | null = null;
  try {
    manifest = (await Bun.file(ROOT + "/" + MANIFEST_PATH).json()) as GroundManifest;
  } catch {
    failures.push("manifest missing — run `bun run ground`");
  }
  if (manifest) {
    if (manifest.bunVersion !== shape.bunVersion) {
      failures.push("manifest version " + manifest.bunVersion + " != shape " + shape.bunVersion + " — run ground");
    } else {
      counts.coverage += 1;
    }
    const usage = scanBunTokens(ROOT);
    const lookup = shapeLookup(shape);
    const manifestSymbols = new Set(manifest.rows.map((r) => r.symbol));
    let drift = 0;
    for (const [token] of usage) {
      const member = resolveToken(token, lookup);
      if (!member) continue; // unknown tokens reported below
      const symbol = member.ns ? "Bun." + member.ns + "." + member.name : "Bun." + member.name;
      if (!manifestSymbols.has(symbol)) {
        drift += 1;
        if (drift <= 20) failures.push("coverage drift: used " + symbol + " has no manifest row — run ground");
      }
    }
    if (drift === 0) counts.coverage += 1;
    lines.push("coverage: " + manifest.rows.length + " manifest rows, " + usage.size + " used tokens, drift=" + drift);
    if (manifest.unknownTokens.length > 0) {
      lines.push("unknown tokens (not in shape): " + manifest.unknownTokens.slice(0, 10).join(", ") + (manifest.unknownTokens.length > 10 ? " …" : ""));
    }
  }

  // 3. probes — every wired gate in the manifest
  if (manifest) {
    const gates = [...new Set(manifest.rows.map((r) => r.gate).filter((g) => g !== ""))];
    let probeTotal = 0;
    let probeFails = 0;
    for (const gate of gates) {
      const { failures: gateFails, total } = await runGateProbes(gate);
      probeTotal += total;
      if (total === 0) {
        lines.push("probe: gate " + gate + " — no probes wired (unverified)");
      } else {
        for (const f of gateFails) {
          probeFails += 1;
          failures.push("probe: " + f.detail);
        }
        lines.push("probe: gate " + gate + " — " + (total - gateFails.length) + "/" + total + " pass");
      }
    }
    counts.probes = probeTotal;
    lines.push("probes total: " + probeTotal + " run, " + probeFails + " failed");
  }

  // 4. stale URLs across the repo source dirs
  const parts: string[] = [];
  for (const dir of ["src", "tools", "scripts"]) {
    const proc = Bun.spawnSync(["rg", "--no-heading", "-i", "bun\\.com/docs", dir], { cwd: ROOT, stdout: "pipe" });
    if (proc.exitCode === 0) parts.push(proc.stdout.toString());
  }
  const stale = findStaleUrls(parts.join("\n"));
  if (stale.length > 0) {
    for (const u of stale.slice(0, 20)) failures.push("stale URL: " + u);
    lines.push("stale URLs: " + stale.length + " found (see failures)");
  } else {
    counts.urls += 1;
    lines.push("stale URLs: clean");
  }

  // 5. optional online HEAD check of every manifest docsUrl
  if (opts.online && manifest) {
    const urls = [...new Set(manifest.rows.map((r) => r.docsUrl))];
    let bad = 0;
    for (const url of urls) {
      try {
        const res = await fetch(url, { method: "HEAD", headers: { "User-Agent": "kalshi-bot-verify" } });
        if (res.status !== 200 && res.status !== 301 && res.status !== 302 && res.status !== 308) {
          bad += 1;
          if (bad <= 10) failures.push("docsUrl " + res.status + ": " + url);
        }
      } catch (e) {
        bad += 1;
        if (bad <= 10) failures.push("docsUrl fetch error: " + url + " (" + (e as Error).message.slice(0, 60) + ")");
      }
    }
    lines.push("online: " + urls.length + " docs URLs HEAD-checked, " + bad + " bad");
    if (bad === 0) counts.urls += 1;
  }

  const code = failures.length === 0 ? 0 : 1;
  return { code, lines, failures, counts };
}

if (import.meta.main) {
  const { values } = parseArgs({ args: Bun.argv.slice(2), options: { online: { type: "boolean" } }, strict: false });
  const report = await runGroundCheck({ online: values.online === true });
  for (const line of report.lines) console.log("·", line);
  if (report.code !== 0) {
    console.error("ground:check FAILURES:");
    for (const f of report.failures) console.error("  ✗ " + f);
  }
  process.exit(report.code);
}
