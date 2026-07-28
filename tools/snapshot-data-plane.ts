#!/usr/bin/env bun
/**
 * Data-plane snapshot capture — point-in-time state + append to registry.
 *
 * Usage:
 *   bun tools/snapshot-data-plane.ts
 *   bun tools/snapshot-data-plane.ts --db=/path/to/event-store.db
 *   bun tools/snapshot-data-plane.ts --scope=data-plane
 *   bun tools/snapshot-data-plane.ts --scope=prediction --dry-run
 *   bun tools/snapshot-data-plane.ts --list
 *   bun tools/snapshot-data-plane.ts --grep="mae>0.1"
 */
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { openEventStore } from "../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../src/institutions/event-store/paths.ts";
import { analyzeTennisBookCoverage } from "../src/institutions/event-store/tennis-book-coverage.ts";
import { SCOPE_CONFIGS, type SnapshotScope } from "./snapshot-scopes.ts";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type DataPlaneSnapshot = {
  v: 1;
  ts: string;
  tsUnix: number;
  run: string;
  fingerprint: string;
  scope?: SnapshotScope;
  gitHead?: string | null;
  rows: {
    events: number;
    markets: number;
    resolutions: number;
    book_ticks: number;
    book_ticks_by_source: Record<string, number>;
    event_links: number;
    live_scores: number;
    score_snapshots: number;
    player_profiles: number;
    odds_ticks: number;
  };
  files: {
    event_store_db: number;
    cache_db: number;
    ticker_map_db: number;
    shadow_log_jsonl: number;
  };
  coverage: {
    watchEvents: number;
    watchTickers: number;
    watchWithWs: number;
    watchWithRest: number;
    watchWithBoth: number;
    watchWithNeither: number;
    wsTicksTotal: number;
    restTicksTotal: number;
    wsExchangeClockPct: number | null;
    linkedEventsWithWs: number;
    linkedEventsTotal: number;
  };
  canary: {
    exitCode: number | null;
    watch: number;
    polled: number;
    live: number;
    wouldUpsert: number;
    wireOk: boolean | null;
    liveMatches: Array<{ ticker: string; summary: string }>;
  };
  blockers: {
    gh_auth: boolean;
    protonpass_session: boolean;
    kalshi_ws: boolean;
    odds_api: boolean;
  };
  sources: Record<string, { active: boolean; rows: number; blocker: string | null }>;
};

export type SnapshotArtifact = {
  run: string;
  ts: string;
  tsUnix: number;
  fingerprint: string;
  file: string;
  sizeBytes: number;
  compressed: boolean;
  hasLiveMatches: boolean;
};

export type FindFilter = {
  from?: string;
  to?: string;
  hasLiveMatches?: boolean;
};

export type PruneOptions = {
  compressAfterMs?: number;
  maxHotEntries?: number;
  maxTotalSnapshots?: number;
};

export type ValidationResult = { ok: boolean; errors: string[] };

export type RegistryIndex = {
  v: 1;
  createdAt: string;
  updatedAt: string;
  totalSnapshots: number;
  totalBytes: number;
  compressedBytes: number;
  latestRun: string;
  entries: SnapshotArtifact[];
};

// Public alias
export type SnapshotIndex = RegistryIndex;

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const SNAPSHOTS_DIR = "snapshots";


const HOT_REGISTRY = "data-plane-snapshots.jsonl";
const COLD_ARCHIVE = "data-plane-snapshots.jsonl.gz";

function defaultRegistryDir(): string {
  return "research/registry";
}

export function registryPathForScope(scope: SnapshotScope): string {
  return SCOPE_CONFIGS[scope].outputDir;
}

/* ------------------------------------------------------------------ */
/*  Fingerprint + compression                                          */
/* ------------------------------------------------------------------ */

export function computeFingerprint(snap: DataPlaneSnapshot): string {
  const clone = { ...snap };
  delete (clone as any).fingerprint;
  const hash = createHash("sha256").update(JSON.stringify(clone)).digest("hex");
  return hash.slice(0, 8);
}

export function compressBuffer(buf: Buffer): Buffer {
  return gzipSync(buf);
}

export function decompressBuffer(buf: Buffer): Buffer {
  return gunzipSync(buf);
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function arg(name: string): string | undefined {
  const eq = Bun.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (eq != null) return eq;
  const idx = Bun.argv.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < Bun.argv.length) return Bun.argv[idx + 1];
  return undefined;
}

function hasFlag(name: string): boolean {
  return Bun.argv.includes(`--${name}`);
}

async function getFileSizeBytes(path: string): Promise<number> {
  try {
    const stat = await Bun.file(path).stat();
    return stat.size;
  } catch {
    return 0;
  }
}

async function getGitHead(): Promise<string | null> {
  try {
    const proc = Bun.spawn(["git", "rev-parse", "--short", "HEAD"], { stdout: "pipe", stderr: "pipe" });
    const code = await proc.exited;
    if (code !== 0) return null;
    const out = await new Response(proc.stdout).text();
    return out.trim() || null;
  } catch {
    return null;
  }
}

async function readIndex(registryDir: string): Promise<RegistryIndex> {
  const path = `${registryDir}/index.json`;
  const file = Bun.file(path);
  if (await file.exists()) {
    try {
      return await file.json() as RegistryIndex;
    } catch { /* fall through */ }
  }
  const now = new Date().toISOString();
  return {
    v: 1,
    createdAt: now,
    updatedAt: now,
    totalSnapshots: 0,
    totalBytes: 0,
    compressedBytes: 0,
    latestRun: "",
    entries: [],
  };
}

async function writeIndex(registryDir: string, index: RegistryIndex): Promise<void> {
  index.updatedAt = new Date().toISOString();
  await Bun.write(`${registryDir}/index.json`, JSON.stringify(index, null, 2) + "\n");
}

function ensureDir(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true });
  } catch { /* ignore */ }
}

/* ------------------------------------------------------------------ */
/*  Core capture — data plane                                          */
/* ------------------------------------------------------------------ */

export async function captureSnapshot(
  options: { dbPath?: string; registryDir?: string; dryRun?: boolean } = {},
): Promise<DataPlaneSnapshot> {
  const dbPath = options.dbPath ?? DEFAULT_EVENT_STORE_DB;
  const registryDir = options.registryDir ?? defaultRegistryDir();
  const db = openEventStore({ dbPath });

  const now = new Date();
  const iso = now.toISOString();
  const run = `keeper-${iso.slice(0, 10)}-${iso.slice(11, 19).replace(/:/g, "")}-${now.getMilliseconds().toString().padStart(3, "0")}`;

  // Row counts
  const events = Number((db.query("SELECT COUNT(*) AS n FROM events").get() as any)?.n ?? 0);
  const markets = Number((db.query("SELECT COUNT(*) AS n FROM markets").get() as any)?.n ?? 0);
  const resolutions = Number((db.query("SELECT COUNT(*) AS n FROM resolutions").get() as any)?.n ?? 0);
  const book_ticks = Number((db.query("SELECT COUNT(*) AS n FROM book_ticks").get() as any)?.n ?? 0);
  const event_links = Number((db.query("SELECT COUNT(*) AS n FROM event_links").get() as any)?.n ?? 0);
  const live_scores = Number((db.query("SELECT COUNT(*) AS n FROM live_scores").get() as any)?.n ?? 0);
  const score_snapshots = Number((db.query("SELECT COUNT(*) AS n FROM score_snapshots").get() as any)?.n ?? 0);
  const player_profiles = Number((db.query("SELECT COUNT(*) AS n FROM player_profiles").get() as any)?.n ?? 0);
  const odds_ticks = Number((db.query("SELECT COUNT(*) AS n FROM odds_ticks").get() as any)?.n ?? 0);

  const bySource = db
    .query("SELECT source, COUNT(*) AS n FROM book_ticks GROUP BY source")
    .all() as Array<{ source: string; n: number }>;
  const book_ticks_by_source: Record<string, number> = {};
  for (const row of bySource) book_ticks_by_source[row.source] = row.n;

  // File sizes
  const event_store_db = await getFileSizeBytes(dbPath);
  const cache_db = await getFileSizeBytes(dbPath.replace("event-store.db", "cache.db"));
  const ticker_map_db = await getFileSizeBytes(dbPath.replace("event-store.db", "ticker-map.db"));
  const shadow_log_jsonl = await getFileSizeBytes("alpha/tennis-game-model/shadow-log.jsonl");

  // Coverage
  const coverage = analyzeTennisBookCoverage(db, { leadMinutes: 5, limit: 40 });

  // Canary / live — read latest canary history entry
  let canary: DataPlaneSnapshot["canary"] = {
    exitCode: null, watch: 0, polled: 0, live: 0, wouldUpsert: 0, wireOk: null, liveMatches: [],
  };
  try {
    const historyFile = Bun.file("research/cache/tennis-canary/history.jsonl");
    if (await historyFile.exists()) {
      const lines = (await historyFile.text()).trim().split("\n");
      const lastLine = lines[lines.length - 1];
      if (lastLine) {
        const canaryData = JSON.parse(lastLine);
        canary = {
          exitCode: canaryData.exitCode ?? null,
          watch: canaryData.summary?.watched ?? 0,
          polled: canaryData.summary?.polled ?? 0,
          live: canaryData.summary?.live ?? 0,
          wouldUpsert: canaryData.summary?.upserted ?? 0,
          wireOk: canaryData.exitCode === 0,
          liveMatches: (canaryData.liveTickers ?? []).map((t: string) => ({ ticker: t, summary: t })),
        };
      }
    }
  } catch { /* leave defaults */ }

  // Blockers
  const ghProc = Bun.spawn(["gh", "auth", "status"], { stdout: "pipe", stderr: "pipe" });
  const ghAuthOk = (await ghProc.exited) === 0;

  let protonpass_session = false;
  try {
    const ppTest = await Bun.spawn(["pass-cli", "test"], { stdout: "pipe", stderr: "pipe" }).exited;
    const ppVault = await Bun.spawn(["pass-cli", "vault", "list"], { stdout: "pipe", stderr: "pipe" }).exited;
    protonpass_session = ppTest === 0 && ppVault === 0;
  } catch { /* leave false */ }

  const kalshi_ws = !!(Bun.env.KALSHI_API_KEY_ID || Bun.env.KALSHI_ACCESS_KEY);
  const odds_api = !!Bun.env.ODDS_API_KEY;

  // Sources map
  const sources: DataPlaneSnapshot["sources"] = {
    "kalshi-rest-itf": { active: true, rows: events, blocker: null },
    "itf-stadion": { active: true, rows: resolutions, blocker: null },
    "kalshi-rest-books": { active: true, rows: book_ticks_by_source["kalshi-rest"] ?? 0, blocker: null },
    "kalshi-ws-books": {
      active: (book_ticks_by_source["kalshi-ws"] ?? 0) > 0,
      rows: book_ticks_by_source["kalshi-ws"] ?? 0,
      blocker: kalshi_ws ? null : "KALSHI_API_KEY_ID",
    },
    "player-profiles": { active: true, rows: player_profiles, blocker: null },
    "shadow-itf": { active: true, rows: Math.floor(shadow_log_jsonl / 1024), blocker: null },
    "odds-api": { active: odds_api, rows: odds_ticks, blocker: odds_api ? null : "ODDS_API_KEY" },
    "github-research": { active: protonpass_session, rows: 29, blocker: protonpass_session ? null : "GH_TOKEN" },
  };

  const snapshot: DataPlaneSnapshot = {
    v: 1,
    ts: iso,
    tsUnix: now.getTime(),
    run,
    fingerprint: "",
    rows: { events, markets, resolutions, book_ticks, book_ticks_by_source, event_links, live_scores, score_snapshots, player_profiles, odds_ticks },
    files: { event_store_db, cache_db, ticker_map_db, shadow_log_jsonl },
    coverage: {
      watchEvents: coverage.watchEvents,
      watchTickers: coverage.watchTickers,
      watchWithWs: coverage.watchWithWs,
      watchWithRest: coverage.watchWithRest,
      watchWithBoth: coverage.watchWithBoth,
      watchWithNeither: coverage.watchWithNeither,
      wsTicksTotal: coverage.wsTicksTotal,
      restTicksTotal: coverage.restTicksTotal,
      wsExchangeClockPct: coverage.wsExchangeClockPct,
      linkedEventsWithWs: coverage.linkedEventsWithWs,
      linkedEventsTotal: coverage.linkedEventsTotal,
    },
    canary,
    blockers: {
      gh_auth: !ghAuthOk,
      protonpass_session: !protonpass_session,
      kalshi_ws: !kalshi_ws,
      odds_api: !odds_api,
    },
    sources,
  };

  snapshot.fingerprint = computeFingerprint(snapshot);

  if (options.dryRun) {
    console.log(`[dry-run] Would capture data-plane snapshot ${run}`);
    return snapshot;
  }

  ensureDir(`${registryDir}/${SNAPSHOTS_DIR}`);

  // Write individual artifact
  const artifactName = `${run}-${snapshot.fingerprint}.json`;
  const artifactPath = `${registryDir}/${SNAPSHOTS_DIR}/${artifactName}`;
  await Bun.write(artifactPath, JSON.stringify(snapshot, null, 2) + "\n");

  await appendToRegistry(registryDir, snapshot);

  // Update index
  const index = await readIndex(registryDir);
  const artifact: SnapshotArtifact = {
    run,
    ts: iso,
    tsUnix: now.getTime(),
    fingerprint: snapshot.fingerprint,
    file: `${SNAPSHOTS_DIR}/${artifactName}`,
    sizeBytes: JSON.stringify(snapshot).length,
    compressed: false,
    hasLiveMatches: canary.liveMatches.length > 0,
  };
  index.entries.push(artifact);
  index.totalSnapshots = index.entries.length;
  index.totalBytes = index.entries.reduce((s, e) => s + e.sizeBytes, 0);
  index.latestRun = run;
  await writeIndex(registryDir, index);

  return snapshot;
}

// Alias for backward compatibility
export const captureDataPlane = captureSnapshot;

/* ------------------------------------------------------------------ */
/*  Scope-aware report capture                                         */
/* ------------------------------------------------------------------ */

export async function captureReport(
  scope: SnapshotScope,
  options: { registryDir?: string; dryRun?: boolean } = {},
): Promise<DataPlaneSnapshot> {
  if (scope === "data-plane") {
    return captureSnapshot({ registryDir: options.registryDir, dryRun: options.dryRun });
  }

  const config = SCOPE_CONFIGS[scope];
  const registryDir = options.registryDir ?? config.outputDir;
  const now = new Date();
  const iso = now.toISOString();
  const run = `${scope}-${iso.slice(0, 10)}-${iso.slice(11, 19).replace(/:/g, "")}-${now.getMilliseconds().toString().padStart(3, "0")}`;

  let rows: DataPlaneSnapshot["rows"] = {
    events: 0, markets: 0, resolutions: 0, book_ticks: 0,
    book_ticks_by_source: {}, event_links: 0, live_scores: 0,
    score_snapshots: 0, player_profiles: 0, odds_ticks: 0,
  };
  let files: DataPlaneSnapshot["files"] = {
    event_store_db: 0, cache_db: 0, ticker_map_db: 0, shadow_log_jsonl: 0,
  };
  let canary: DataPlaneSnapshot["canary"] = {
    exitCode: null, watch: 0, polled: 0, live: 0, wouldUpsert: 0, wireOk: null, liveMatches: [],
  };

  if (config.baseUrl && !options.dryRun) {
    try {
      const summaryRes = await fetch(`${config.baseUrl}/summary.json`);
      if (summaryRes.ok) {
        const summary = await summaryRes.json();
        rows.events = summary.events ?? 0;
        rows.markets = summary.markets ?? 0;
        canary.watch = summary.watch ?? 0;
        canary.polled = summary.polled ?? 0;
      }
    } catch { /* ignore fetch errors */ }
  }

  const snapshot: DataPlaneSnapshot = {
    v: 1,
    ts: iso,
    tsUnix: now.getTime(),
    run,
    fingerprint: "",
    scope,
    gitHead: await getGitHead(),
    rows,
    files,
    coverage: {
      watchEvents: 0, watchTickers: 0, watchWithWs: 0, watchWithRest: 0,
      watchWithBoth: 0, watchWithNeither: 0, wsTicksTotal: 0, restTicksTotal: 0,
      wsExchangeClockPct: null, linkedEventsWithWs: 0, linkedEventsTotal: 0,
    },
    canary,
    blockers: { gh_auth: false, protonpass_session: false, kalshi_ws: false, odds_api: false },
    sources: {},
  };

  snapshot.fingerprint = computeFingerprint(snapshot);

  if (options.dryRun) {
    console.log(`[dry-run] Would capture ${scope} snapshot ${run}`);
    return snapshot;
  }

  ensureDir(`${registryDir}/${SNAPSHOTS_DIR}`);
  const artifactName = `${run}-${snapshot.fingerprint}.json`;
  const artifactPath = `${registryDir}/${SNAPSHOTS_DIR}/${artifactName}`;
  await Bun.write(artifactPath, JSON.stringify(snapshot, null, 2) + "\n");

  await appendToRegistry(registryDir, snapshot);

  const index = await readIndex(registryDir);
  index.entries.push({
    run, ts: iso, tsUnix: now.getTime(), fingerprint: snapshot.fingerprint,
    file: `${SNAPSHOTS_DIR}/${artifactName}`,
    sizeBytes: JSON.stringify(snapshot).length,
    compressed: false,
    hasLiveMatches: false,
  });
  index.totalSnapshots = index.entries.length;
  index.totalBytes = index.entries.reduce((s, e) => s + e.sizeBytes, 0);
  index.latestRun = run;
  await writeIndex(registryDir, index);

  return snapshot;
}

/* ------------------------------------------------------------------ */
/*  Registry operations                                                */
/* ------------------------------------------------------------------ */

export async function appendToRegistry(registryDir: string, snapshot: DataPlaneSnapshot): Promise<void> {
  const hotPath = `${registryDir}/${HOT_REGISTRY}`;
  const hotFile = Bun.file(hotPath);
  let hotExisting = "";
  if (await hotFile.exists()) {
    hotExisting = await hotFile.text();
    if (hotExisting.length > 0 && !hotExisting.endsWith("\n")) hotExisting += "\n";
  }
  await Bun.write(hotPath, hotExisting + JSON.stringify(snapshot) + "\n");
}

export async function readRegistry(registryDir: string = defaultRegistryDir()): Promise<DataPlaneSnapshot[]> {
  const hotFile = Bun.file(`${registryDir}/${HOT_REGISTRY}`);
  if (!(await hotFile.exists())) return [];
  const lines = (await hotFile.text()).trim().split("\n").filter(Boolean);
  const entries: DataPlaneSnapshot[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as DataPlaneSnapshot);
    } catch { /* skip corrupt line */ }
  }
  return entries.sort((a, b) => b.tsUnix - a.tsUnix);
}

export async function pruneSnapshots(
  registryDir: string = defaultRegistryDir(),
  options: PruneOptions = {},
): Promise<{ compressed: number; deleted: number; bytesSaved: number }> {
  const compressAfterMs = options.compressAfterMs ?? 7 * 24 * 60 * 60 * 1000;
  const maxHotEntries = options.maxHotEntries ?? 30;
  const maxTotalSnapshots = options.maxTotalSnapshots ?? 365;
  const now = Date.now();

  let compressed = 0;
  let deleted = 0;
  let bytesSaved = 0;

  const index = await readIndex(registryDir);
  const hotPath = `${registryDir}/${HOT_REGISTRY}`;
  const coldPath = `${registryDir}/${COLD_ARCHIVE}`;

  // 1. Compress old individual snapshot files
  for (const entry of index.entries) {
    if (entry.compressed) continue;
    if (now - entry.tsUnix < compressAfterMs) continue;

    const srcPath = `${registryDir}/${entry.file}`;
    const dstPath = `${srcPath}.gz`;
    const srcFile = Bun.file(srcPath);
    if (!(await srcFile.exists())) continue;

    const buf = Buffer.from(await srcFile.arrayBuffer());
    const gz = compressBuffer(buf);
    await Bun.write(dstPath, gz);

    await srcFile.delete?.() ?? Bun.spawn(["rm", srcPath]).exited;

    entry.compressed = true;
    bytesSaved += buf.length - gz.length;
    compressed++;
  }

  // 2. Trim hot registry to maxHotEntries (keep newest)
  const hotFile = Bun.file(hotPath);
  if (await hotFile.exists()) {
    const lines = (await hotFile.text()).trim().split("\n").filter(Boolean);
    if (lines.length > maxHotEntries) {
      const keep = lines.slice(-maxHotEntries);
      const coldLines = lines.slice(0, lines.length - maxHotEntries);

      const coldBuf = Buffer.from(coldLines.join("\n") + "\n");

      const coldFile = Bun.file(coldPath);
      let existingCold = Buffer.alloc(0);
      if (await coldFile.exists()) {
        existingCold = Buffer.from(await coldFile.arrayBuffer());
      }
      let combined = coldBuf;
      if (existingCold.length > 0) {
        try {
          const existing = decompressBuffer(existingCold);
          combined = Buffer.concat([existing, coldBuf]);
        } catch { /* existing corrupted */ }
      }
      await Bun.write(coldPath, compressBuffer(combined));

      await Bun.write(hotPath, keep.join("\n") + "\n");
    }
  }

  // 3. Delete oldest snapshots if over maxTotalSnapshots
  index.entries.sort((a, b) => a.tsUnix - b.tsUnix);
  while (index.entries.length > maxTotalSnapshots) {
    const oldest = index.entries.shift()!;
    const filePath = `${registryDir}/${oldest.file}`;
    const gzPath = `${filePath}.gz`;
    for (const p of [filePath, gzPath]) {
      const f = Bun.file(p);
      if (await f.exists()) {
        await f.delete?.() ?? Bun.spawn(["rm", p]).exited;
      }
    }
    deleted++;
  }

  index.totalSnapshots = index.entries.length;
  index.compressedBytes = index.entries
    .filter((e) => e.compressed)
    .reduce((s, e) => s + e.sizeBytes, 0);
  await writeIndex(registryDir, index);

  return { compressed, deleted, bytesSaved };
}

export async function listSnapshots(registryDir: string = defaultRegistryDir()): Promise<DataPlaneSnapshot[]> {
  const index = await readIndex(registryDir);
  const results: DataPlaneSnapshot[] = [];
  for (const entry of index.entries) {
    try {
      const artifactPath = `${registryDir}/${entry.file}`;
      const data = await Bun.file(artifactPath).text();
      results.push(JSON.parse(data) as DataPlaneSnapshot);
    } catch { /* skip unreadable */ }
  }
  return results.sort((a, b) => b.tsUnix - a.tsUnix);
}

export async function findSnapshots(
  filter: FindFilter,
  registryDir: string = defaultRegistryDir(),
): Promise<DataPlaneSnapshot[]> {
  const index = await readIndex(registryDir);
  const results: DataPlaneSnapshot[] = [];
  for (const entry of index.entries) {
    try {
      const artifactPath = `${registryDir}/${entry.file}`;
      const data = await Bun.file(artifactPath).text();
      const snap = JSON.parse(data) as DataPlaneSnapshot;
      const d = snap.ts.slice(0, 10);
      if (filter.from && d < filter.from) continue;
      if (filter.to && d > filter.to) continue;
      if (filter.hasLiveMatches != null && (snap.canary?.liveMatches?.length > 0) !== filter.hasLiveMatches) continue;
      results.push(snap);
    } catch { /* skip unreadable */ }
  }
  return results.sort((a, b) => b.tsUnix - a.tsUnix);
}

export async function validateRegistry(registryDir: string = defaultRegistryDir()): Promise<ValidationResult> {
  const errors: string[] = [];
  const index = await readIndex(registryDir);

  if (index.v !== 1) errors.push(`index.v expected 1, got ${index.v}`);
  if (index.totalSnapshots !== index.entries.length) {
    errors.push(`totalSnapshots (${index.totalSnapshots}) != entries.length (${index.entries.length})`);
  }

  const runs = new Set<string>();
  const fingerprints = new Set<string>();
  let prevTs = 0;

  for (const entry of index.entries) {
    if (runs.has(entry.run)) errors.push(`duplicate run: ${entry.run}`);
    runs.add(entry.run);

    if (fingerprints.has(entry.fingerprint)) errors.push(`duplicate fingerprint: ${entry.fingerprint}`);
    fingerprints.add(entry.fingerprint);

    if (entry.tsUnix < prevTs) errors.push(`out-of-order timestamp: ${entry.run}`);
    prevTs = entry.tsUnix;

    const filePath = `${registryDir}/${entry.file}`;
    const gzPath = `${filePath}.gz`;
    const file = Bun.file(filePath);
    const gzFile = Bun.file(gzPath);
    const exists = await file.exists();
    const gzExists = await gzFile.exists();

    if (!exists && !gzExists) {
      errors.push(`missing artifact: ${entry.file} (and .gz)`);
      continue;
    }

    if (exists && !entry.compressed) {
      try {
        const snap = await file.json() as DataPlaneSnapshot;
        const expected = computeFingerprint(snap);
        if (snap.fingerprint !== expected) {
          errors.push(`fingerprint mismatch for ${entry.run}: ${snap.fingerprint} != ${expected}`);
        }
      } catch {
        errors.push(`unreadable artifact: ${entry.file}`);
      }
    }
  }

  const hotPath = `${registryDir}/${HOT_REGISTRY}`;
  const hotFile = Bun.file(hotPath);
  if (await hotFile.exists()) {
    const lines = (await hotFile.text()).trim().split("\n").filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      try {
        JSON.parse(lines[i]!);
      } catch {
        errors.push(`hot registry line ${i + 1} invalid JSON`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/* ------------------------------------------------------------------ */
/*  CLI                                                                */
/* ------------------------------------------------------------------ */

if (import.meta.main) {
  const scopeArg = arg("scope");
  const resolvedScope: SnapshotScope = scopeArg && (scopeArg in SCOPE_CONFIGS) ? (scopeArg as SnapshotScope) : "data-plane";

  if (hasFlag("list")) {
    const dir = arg("registry") ?? registryPathForScope(resolvedScope);
    const snaps = await listSnapshots(dir);
    console.log(`Scope: ${resolvedScope} — ${snaps.length} snapshot(s)`);
    for (const s of snaps.slice(0, 20)) {
      console.log(`  ${s.run}  ${s.ts}  events=${s.rows.events}`);
    }
    process.exit(0);
  }

  if (hasFlag("grep")) {
    const pattern = arg("grep") ?? "";
    const dir = arg("registry") ?? registryPathForScope(resolvedScope);
    const entries = await readRegistry(dir);
    const matched = entries.filter((e) => JSON.stringify(e).includes(pattern));
    console.log(`Grep "${pattern}" in ${resolvedScope}: ${matched.length} match(es)`);
    for (const m of matched.slice(0, 10)) {
      console.log(`  ${m.run}  ${m.ts}`);
    }
    process.exit(0);
  }

  const dryRun = hasFlag("dry-run");
  const snapshot = await captureReport(resolvedScope, { dryRun });

  console.log(`Snapshot captured: ${snapshot.run}  scope=${resolvedScope}`);
  console.log(`Registry: ${registryPathForScope(resolvedScope)}`);
  console.log("");
  console.log("=== Snapshot summary ===");
  console.log(`events=${snapshot.rows.events} markets=${snapshot.rows.markets} resolutions=${snapshot.rows.resolutions}`);
  console.log(`book_ticks=${snapshot.rows.book_ticks} (rest=${snapshot.rows.book_ticks_by_source["kalshi-rest"] ?? 0} ws=${snapshot.rows.book_ticks_by_source["kalshi-ws"] ?? 0})`);
  console.log(`event_links=${snapshot.rows.event_links} player_profiles=${snapshot.rows.player_profiles}`);
  console.log(`canary: watch=${snapshot.canary.watch} polled=${snapshot.canary.polled} live=${snapshot.canary.live}`);
  console.log(`blockers: gh=${snapshot.blockers.gh_auth} pp=${snapshot.blockers.protonpass_session} kalshi_ws=${snapshot.blockers.kalshi_ws} odds_api=${snapshot.blockers.odds_api}`);
}
