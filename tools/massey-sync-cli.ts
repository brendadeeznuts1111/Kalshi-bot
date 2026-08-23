#!/usr/bin/env bun
/**
 * Fetch + parse + store Massey Ratings tables for configured sports.
 *
 * Massey blocks plain fetch with a Cloudflare challenge (403); the fetch layer
 * tries Bun native fetch first (fast) and falls back to a headless Bun.WebView
 * (webkit on macOS, chrome elsewhere) that renders the page through the
 * challenge — the same data Massey "More → Export CSV" generates client-side.
 *
 * Usage:
 *   bun run massey:sync -- --sport=cvol --sub=ncaa-d1 --dry-run
 *   bun run massey:sync -- --sport=cvol/ncaa-d1 --write --json
 *   bun run massey:sync -- --sport=volleyball,basketball --write --concurrency=2
 *   bun run massey:sync -- --sport=all --write --max-age-hours=24
 *
 * Flags:
 *   --sport          massey path ("cvol/ncaa-d1"), bucket ("volleyball"),
 *                    bucket:sub ("volleyball:ncaa-d2"), CSV list, or "all".
 *   --sub            subdivision override for bucket specs (optional).
 *   --dry-run        print parsed rows only — no DB writes (default).
 *   --write          persist snapshot + rows to research/cache/massey.db.
 *   --rows=N         print only the first N rows per target (default 5; 0 = all).
 *   --json           emit JSON (one object per target, NDJSON when multiple).
 *   --concurrency=N  parallel targets (default 2, max 4).
 *   --max-age-hours=H  skip targets whose latest snapshot is fresher than H hours.
 *   --no-native-fetch  disable the native fetch fast path (WebView only).
 *   --db=PATH        override massey.db path (tests use :memory:).
 */
import { argValue, hasFlag } from '../src/cli/argv.ts';
import { assertBunAtLeast } from '../src/research/bun-native.ts';
import {
  listMasseyBuckets,
  masseyTargetsForBucket,
  resolveMasseyTarget,
  type MasseySportTarget,
} from '../src/institutions/massey/sports.ts';
import {
  fetchMasseyRatingsTable,
  resolveMasseyWebViewBackend,
} from '../src/institutions/massey/fetch.ts';
import { parseMasseyRatingRows, type MasseyRatingRow } from '../src/institutions/massey/parse.ts';
import {
  latestMasseySnapshotAgeMs,
  openMasseyDb,
  upsertMasseyRatings,
} from '../src/institutions/massey/store.ts';

function resolveTargets(): MasseySportTarget[] {
  const sportFlag = argValue('sport') ?? 'volleyball';
  const sub = argValue('sub');
  const out: MasseySportTarget[] = [];
  for (const spec of sportFlag.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (spec === 'all') {
      out.push(...listMasseyBuckets().flatMap((b) => masseyTargetsForBucket(b)));
      continue;
    }
    const target = resolveMasseyTarget(spec);
    if (!target) {
      throw new Error("unknown massey target: " + spec + " (try 'volleyball', 'cvol/ncaa-d1', or 'all')");
    }
    if (sub && target.subdivision !== sub) {
      const withSub = resolveMasseyTarget(target.masseySport + "/" + sub);
      out.push(withSub ?? { ...target, subdivision: sub, label: target.label + " " + sub });
    } else {
      out.push(target);
    }
  }
  const seen = new Set<string>();
  return out.filter((t) => {
    const key = t.masseySport + "/" + t.subdivision;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatRow(r: MasseyRatingRow): string {
  return [
    String(r.rank).padStart(4),
    r.team.padEnd(32).slice(0, 32),
    (r.conference || "-").padEnd(18).slice(0, 18),
    String(r.wins ?? "-"),
    String(r.losses ?? "-"),
    String(r.rating ?? "-"),
    String(r.power ?? "-"),
    String(r.sos ?? "-"),
    String(r.ew ?? "-"),
    String(r.el ?? "-"),
  ].join(" ");
}

async function fetchOne(
  target: MasseySportTarget,
  opts: { dryRun: boolean; db: ReturnType<typeof openMasseyDb> | null; maxAgeHours: number; noNative: boolean; json: boolean; rowsLimit: number; },
): Promise<{ skippedFresh: boolean }> {
  const key = target.masseySport + "/" + (target.subdivision || "-");
  if (opts.db && opts.maxAgeHours > 0) {
    const ageMs = latestMasseySnapshotAgeMs(opts.db, target);
    if (ageMs !== null && ageMs < opts.maxAgeHours * 3_600_000) {
      if (opts.json) {
        console.log(JSON.stringify({ target: key, bucket: target.inventoryBucket, skipped: "fresh", ageHours: +(ageMs / 3_600_000).toFixed(2) }));
      } else {
        console.log(target.label + " (" + key + "): fresh (" + (ageMs / 3_600_000).toFixed(1) + "h) — skipping");
      }
      return { skippedFresh: true };
    }
  }

  const startedAt = Date.now();
  const table = await fetchMasseyRatingsTable(target, { nativeFastPath: !opts.noNative });
  const rows = parseMasseyRatingRows(table.headers, table.rows);
  const result = opts.db ? upsertMasseyRatings(opts.db, table) : null;

  if (opts.json) {
    console.log(JSON.stringify({
      target: key,
      bucket: target.inventoryBucket,
      url: table.url,
      title: table.title,
      fetchedAtMs: table.fetchedAtMs,
      fetchedMs: Date.now() - startedAt,
      path: table.path,
      headers: table.headers,
      rowCount: table.rows.length,
      parsedCount: rows.length,
      snapshotId: result?.snapshotId ?? null,
      rows: rows.slice(0, opts.rowsLimit || undefined).map((r) => ({
        rank: r.rank, team: r.team, conference: r.conference,
        wins: r.wins, losses: r.losses, rating: r.rating, power: r.power,
        sos: r.sos, ew: r.ew, el: r.el,
      })),
    }));
    return { skippedFresh: false };
  }

  console.log(target.label + " (" + key + ")");
  console.log("  url: " + table.url);
  console.log("  title: " + table.title);
  console.log("  path: " + table.path + (table.path === "webview" ? " (native fetch blocked by Cloudflare)" : " (Bun native fetch)"));
  console.log("  headers: " + table.headers.join(", "));
  console.log("  rows: " + table.rows.length + " raw / " + rows.length + " parsed, fetched in " + (Date.now() - startedAt) + "ms");
  if (result) console.log("  stored: snapshot=" + result.snapshotId + " rows=" + result.parsedCount);
  if (opts.rowsLimit > 0) {
    console.log("  " + ["rank", "team", "conference", "W", "L", "Rat", "Pwr", "SoS", "EW", "EL"].join(" "));
    for (const r of rows.slice(0, opts.rowsLimit)) console.log("  " + formatRow(r));
  }
  return { skippedFresh: false };
}

async function main(): Promise<void> {
  assertBunAtLeast('1.4.0', 'Bun.WebView-based Massey fetch');
  const targets = resolveTargets();
  const dryRun = !hasFlag('write');
  const json = hasFlag('json');
  const rowsLimit = Number(argValue('rows') ?? '5') || 0;
  const requestedConcurrency = Math.min(Math.max(Number(argValue('concurrency') ?? '2') || 2, 1), 4);
  // Verified: the macOS webkit backend shares one host process and serializes page loads
  // (parallel fetches measured slower than sequential). Only chrome/native paths parallelize.
  const concurrency = resolveMasseyWebViewBackend() === 'webkit' ? 1 : requestedConcurrency;
  const maxAgeHours = Number(argValue('max-age-hours') ?? '0') || 0;
  const noNative = hasFlag('no-native-fetch');
  const dbPath = argValue('db');
  const db = (!dryRun || maxAgeHours > 0) ? openMasseyDb(dbPath ?? undefined) : null;

  const opts = { dryRun, db, maxAgeHours, noNative, json, rowsLimit };
  const started = Date.now();
  let fetched = 0;
  let skipped = 0;

  for (let i = 0; i < targets.length; i += concurrency) {
    const batch = targets.slice(i, i + concurrency);
    const results = await Promise.all(batch.map((t) => fetchOne(t, opts)));
    for (const r of results) {
      if (r.skippedFresh) skipped += 1;
      else fetched += 1;
    }
  }

  if (!json) {
    console.log("");
    console.log("summary: " + fetched + " fetched, " + skipped + " skipped-fresh, " + targets.length + " targets, " + (Date.now() - started) + "ms total (concurrency=" + concurrency + (concurrency !== requestedConcurrency ? ", webkit serializes; requested " + requestedConcurrency + ")" : ")"));
  }
  if (db) db.close();
}

await main();