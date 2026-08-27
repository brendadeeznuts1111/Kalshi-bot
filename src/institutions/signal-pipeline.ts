/**
 * signal-pipeline.ts — the multi-source dashboard signal pipeline.
 *
 * Sources -> signals -> channels -> actions:
 *   - design   (bundle budgets/largest/delta from dist metafiles + history)
 *   - deps     (dedupe --check / prune --dry-run / audit — offline gates)
 *   - brand    (metrics: cache hits/misses/errors, generation ms)
 *   - releases (bun.sh RSS + GitHub releases.atom, cross-checked)
 *   - ops      (videos count, uptime, health features)
 *
 * Consumed by /api/signals (JSON) and /dashboard (rendered page with
 * POST actions). Token-built page; audited design surface.
 */
import { join } from 'node:path';
import { readdirSync } from 'node:fs';
import { loadOddsRegistryConfig, oddsRegistryHealth } from './odds-registry/index.ts';
import {
  DESIGN_MODULES,
  DESIGN_MODULE_NAMES,
  bundleHistoryPath,
  deltaPct,
  largestContributorBytes,
  metaJsonPath,
  moduleBytesFromMetaJson,
  readBundleHistory,
} from '../lib/design-budget.ts';
import { BRAND, DESIGN_SYSTEM_VERSION, themeToggleButton, themeChrome } from './design-tokens.ts';
import { isVideoFile } from '../research/video-page.ts';
import { latestRelease, parseAtomEntries, parseRssEntries } from '../lib/release-blog.ts';
import { CHANNEL_DEFS, CHANNEL_ORDER, type ChannelId } from './channel-registry.ts';
import { collectGithubBudget, githubTokenSource } from './github-budget.ts';
import { parseMapsPins } from '../lib/maps-lock.ts';
import { versionGt } from '../lib/semver.ts';
import type { GitHubRateLimitSnapshot } from '../research/github-rate-limit.ts';

export type SignalSeverity = 'ok' | 'warn' | 'bad' | 'info';

export type Signal = {
  id: string;
  /** Channel id from the registry (src/institutions/channel-registry.ts). */
  channel: ChannelId;
  severity: SignalSeverity;
  title: string;
  detail: string;
  source: string;
  action?: string;
};

export type BrandMetricsSnapshot = {
  card: { hits: number; misses: number; errors: number; totalMs: number };
  swatch: { served: number };
  svg: { served: number };
  badge: { served: number };
  quote: { served: number };
  chart: { served: number };
  purges: number;
};

export async function runBunGate(args: string[], root: string): Promise<{ ok: boolean; detail: string }> {
  const p = Bun.spawn([Bun.which('bun') ?? 'bun', ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  const out = await new Response(p.stdout).text();
  await p.exited;
  const lines = out.trim().split('\n');
  return { ok: (p.exitCode ?? 1) === 0, detail: lines.at(-1) ?? '' };
}

/** Gather every signal from every source. */
export async function collectSignals(root: string, brand: BrandMetricsSnapshot): Promise<Signal[]> {
  const signals: Signal[] = [];
  const push = (s: Signal): void => { signals.push(s); };
  const history = await readBundleHistory(bundleHistoryPath(root));

  // design channel: budgets from metafiles + trend history
  for (const module of DESIGN_MODULE_NAMES) {
    const spec = DESIGN_MODULES[module];
    const jsonText = await Bun.file(metaJsonPath(module, root)).text().catch(() => '');
    let bytes: number | null = null;
    let largest: number | null = null;
    if (jsonText) {
      try {
        const meta = JSON.parse(jsonText) as unknown;
        bytes = moduleBytesFromMetaJson(module, meta);
        largest = largestContributorBytes(module, meta);
      } catch { /* unparsable */ }
    }
    if (bytes === null) {
      push({ id: 'design-' + module, channel: 'design', severity: 'warn', title: module + ' metafile missing', detail: 'run bun run design:build', source: 'design:check' });
      continue;
    }
    const prev = history[module]?.at(-1)?.bytes ?? null;
    const growth = deltaPct(prev, bytes);
    const over = bytes > spec.maxBytes;
    const largestOver = (largest ?? 0) > spec.maxContributorBytes;
    const severity: SignalSeverity = over || largestOver ? 'bad' : (growth ?? 0) > 10 ? 'warn' : 'ok';
    push({
      id: 'design-' + module,
      channel: 'design',
      severity,
      title: module + ' ' + (bytes / 1024).toFixed(2) + ' KB / ' + (spec.maxBytes / 1024).toFixed(0) + ' KB',
      detail: 'largest ' + ((largest ?? 0) / 1024).toFixed(2) + ' KB' + (growth !== null ? ' · delta ' + (growth >= 0 ? '+' : '') + growth.toFixed(1) + '%' : '') + (over ? ' · OVER BUDGET' : '') + (largestOver ? ' · contributor OVER' : ''),
      source: 'design:check budgets',
    });
  }

  // registry channel: odds-registry bookmaker capacity health
  try {
    const cfg = await loadOddsRegistryConfig(root);
    const health = oddsRegistryHealth(cfg);
    const feeds = Object.entries(health.feeds).map(([k, n]) => k + ' ' + n).join(' · ');
    push({
      id: 'registry-capacity',
      channel: 'registry',
      severity: health.ok ? 'ok' : 'bad',
      title: health.bookmakerCount + ' bookmakers / floor ' + health.capacityFloor,
      detail: 'feeds: ' + feeds + ' · sports: ' + health.sports.length + (health.ok ? '' : ' · BELOW CAPACITY FLOOR'),
      source: 'config/odds-registry.xml',
    });
  } catch (error) {
    push({
      id: 'registry-capacity',
      channel: 'registry',
      severity: 'bad',
      title: 'odds-registry config unreadable',
      detail: String(error instanceof Error ? error.message : error),
      source: 'config/odds-registry.xml',
    });
  }

  // deps channel: the offline gates
  const [dedupe, prune, audit] = await Promise.all([
    runBunGate(['dedupe', '--check'], root),
    runBunGate(['prune', '--dry-run'], root),
    runBunGate(['audit'], root),
  ]);
  push({ id: 'deps-dedupe', channel: 'deps', severity: dedupe.ok ? 'ok' : 'bad', title: 'dedupe --check', detail: dedupe.detail, source: 'bun dedupe', action: 'deps-check' });
  push({ id: 'deps-prune', channel: 'deps', severity: prune.ok ? 'ok' : 'warn', title: 'prune --dry-run', detail: prune.detail, source: 'bun prune', action: 'deps-check' });
  push({ id: 'deps-audit', channel: 'deps', severity: audit.ok ? 'ok' : 'bad', title: 'bun audit', detail: audit.detail, source: 'bun audit', action: 'deps-check' });

  // brand channel: metrics
  const cardErrRate = brand.card.misses ? brand.card.errors / Math.max(1, brand.card.misses) : 0;
  push({
    id: 'brand-card',
    channel: 'brand',
    severity: cardErrRate > 0.5 ? 'bad' : brand.card.errors > 0 ? 'warn' : 'ok',
    title: 'brand card: ' + brand.card.hits + ' hit(s) / ' + brand.card.misses + ' miss(es)',
    detail: brand.card.errors + ' error(s) · avg ' + (brand.card.misses ? (brand.card.totalMs / brand.card.misses).toFixed(0) : 0) + ' ms · ' + brand.purges + ' purge(s)',
    source: 'brand metrics',
    action: 'brand-card',
  });
  push({ id: 'brand-served', channel: 'brand', severity: 'info', title: 'served assets', detail: 'svg ' + brand.svg.served + ' · swatch ' + brand.swatch.served + ' · badge ' + brand.badge.served + ' · quote ' + brand.quote.served + ' · chart ' + brand.chart.served, source: 'brand metrics' });

  // releases channel: RSS + Atom (network, try/catch)
  try {
    const [rss, atom] = await Promise.all([
      fetch('https://bun.sh/rss.xml').then((r) => r.text()),
      fetch('https://github.com/oven-sh/bun/releases.atom').then((r) => r.text()),
    ]);
    const rssRel = latestRelease(parseRssEntries(rss));
    const atomRel = latestRelease(parseAtomEntries(atom));
    const match = rssRel && atomRel && rssRel.version === atomRel.version;
    push({
      id: 'release-latest',
      channel: 'releases',
      severity: match ? 'ok' : 'warn',
      title: (rssRel?.title ?? atomRel?.title ?? 'unknown') + ' (' + (rssRel?.version ?? '?') + ')',
      detail: match ? 'RSS and GitHub match' : 'RSS/GitHub MISMATCH — GitHub authoritative',
      source: 'bun.sh RSS + GitHub atom',
      action: 'release-check',
    });
    // Dynamic docs tracking: a NEWER Bun release than the indexed runtime is
    // docs-channel drift (maps.toml owns the indexed version — never assume).
    // Numeric compare, not string: feeds say "1.4" where maps pins "1.4.0".
    try {
      const mapsText = await Bun.file(join(root, 'maps.toml')).text().catch(() => '');
      const maps = mapsText ? parseMapsPins(Bun.TOML.parse(mapsText)) : null;
      const latest = rssRel?.version ?? atomRel?.version ?? null;
      if (maps && latest && versionGt(latest, maps.bunVersion)) {
        push({
          id: 'docs-drift',
          channel: 'docs',
          severity: 'warn',
          title: 'Bun ' + latest + ' released — docs index at ' + maps.bunVersion,
          detail: 'maps.toml still pins ' + maps.bunVersion + ' — run docs:refresh to re-index + heal the triple-lock',
          source: 'release feeds vs maps.toml',
          action: 'docs:refresh',
        });
      }
    } catch { /* maps.toml absent/unparseable — docs gate will report it */ }
  } catch (e) {
    push({ id: 'release-unavailable', channel: 'releases', severity: 'warn', title: 'release feeds unavailable', detail: String(e).slice(0, 80), source: 'bun.sh RSS + GitHub atom', action: 'release-check' });
  }

  // ops channel
  const vids = [...new Bun.Glob('*').scanSync({ cwd: join(root, 'public/videos'), onlyFiles: true })].filter(isVideoFile).length;
  push({ id: 'ops-videos', channel: 'ops', severity: 'info', title: vids + ' video(s) in public/videos', detail: 'served with Range/206 by the videos dir route', source: 'serve routes' });
  push({ id: 'ops-uptime', channel: 'ops', severity: 'info', title: 'bun ' + Bun.version + ' · design v' + DESIGN_SYSTEM_VERSION, detail: 'uptime ' + Math.round(process.uptime()) + 's', source: 'runtime' });

  // inventory channel: real data-asset coverage (massey, events, registry,
  // providers, patterns) + the scale/diversity signal (computed last).
  await collectInventory(root, signals);

  // prune channel: content-plane state — manifest integrity + .trash/
  // footprint. The mirror of the deps channel (bun prune) for CONTENT:
  // what content:prune (AGENT-PITFALLS §25) would act on + what it
  // already archived. Never mutates — report-only like deps:check.
  await collectPrune(root, signals);

  // mapping channel: the blog → repo mapping tracker state (read from
  // .data/blog-map-state.json written by bun:blog-map — offline + fast).
  await collectMapping(root, signals);

  // docs channel: repo docs render health (from .data/docs-state.json
  // written by docs:check — offline + fast).
  await collectDocs(root, signals);
  await collectCompliance(root, signals);
  await collectGithubBudgetSignals(signals);

  // cron channel: the Bun.cron refresh job state.
  push({
    id: 'cron-refresh',
    channel: 'cron',
    severity: signalCron.registered ? (signalCron.lastOk || signalCron.runs === 0 ? 'ok' : 'bad') : 'warn',
    title: 'signal refresh: Bun.cron ' + SIGNAL_CRON_EXPR + (signalCron.registered ? '' : ' (not registered)'),
    detail: signalCron.registered
      ? signalCron.runs + ' run(s) · last ' + (signalCron.lastRun ?? 'never') + (signalCron.nextRun ? ' · next ' + signalCron.nextRun : '')
      : 'register on server start',
    source: 'Bun.cron',
  });

  return signals;
}

// Version comparisons: src/lib/semver.ts (Bun.semver SSOT + normalize-
// first rule, §147-§149). Never hand-roll version logic here.

const esc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>\"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );

// Channel labels/order/actions come from the registry SSOT
// (channel-registry.ts) — this module never declares a channel inline.

/**
 * Token-built dashboard HTML: channels -> signals with severity badges +
 * action buttons (POST /api/signals/actions/<name> with the CSRF header).
 */
export function renderDashboard(signals: Signal[], csrfToken: string): string {
  const channels = CHANNEL_ORDER.map((id) => ({
    id,
    label: CHANNEL_DEFS[id].label,
    signals: signals.filter((s) => s.channel === id),
  }));
  const rows = (s: Signal): string =>
    '<tr><td>' + esc(s.title) + '</td><td><span class="badge ' + s.severity + '">' + s.severity + '</span></td><td class="muted">' + esc(s.detail) + '</td><td class="muted">' + esc(s.source) + '</td>' +
    (s.action ? '<td><button class="act" data-action="' + esc(s.action) + '">' + esc(s.action.replace('-', ' ')) + '</button></td>' : '<td></td>') +
    '</tr>';
  const body = channels
    .map((ch) =>
      '<section data-channel="' + ch.id + '"><h2>' + esc(ch.label) + '</h2>' +
      (ch.signals.length
        ? '<table><tr><th>Signal</th><th>Status</th><th>Detail</th><th>Source</th><th>Action</th></tr>' + ch.signals.map(rows).join('') + '</table>'
        : '<p class="muted">no signals</p>') +
      '</section>',
    )
    .join('');
  return '<!DOCTYPE html>' +
    '<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />' +
    '<title>' + esc(BRAND.name) + ' — signals</title>' +
    '<link rel="stylesheet" href="/design-system.css" />' +
    '<style>' +
    'body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 -apple-system, Segoe UI, sans-serif; padding: 2rem 2.5rem 4rem; }' +
    'header { border-bottom: 1px solid var(--line); padding-bottom: 1rem; margin-bottom: 1.5rem; }' +
    'header h1 { margin: 0; font-size: 1.25rem; letter-spacing: 0.04em; }' +
    'header h1 span { color: var(--acc); }' +
    'header p { color: var(--dim); font-size: 0.8rem; margin: 0.3rem 0 0; }' +
    'section { margin-bottom: 2rem; }' +
    'h2 { font-size: 1rem; margin: 0 0 0.6rem; }' +
    'table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }' +
    'th, td { text-align: left; padding: 0.45rem 0.65rem; border-bottom: 1px solid var(--line); vertical-align: top; }' +
    'th { color: var(--dim); font-weight: 600; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; }' +
    'code { font-family: var(--mono); font-size: 0.8rem; color: var(--acc); }' +
    'button.act { background: var(--panel2); color: var(--acc); border: 1px solid var(--line); border-radius: 6px; padding: 0.25rem 0.6rem; font: inherit; font-size: 0.75rem; cursor: pointer; }' +
    'a { color: var(--acc); }' +
    'footer { color: var(--dim); font-size: 0.75rem; margin-top: 2rem; border-top: 1px solid var(--line); padding-top: 0.75rem; }' +
    '</style></head><body>' +
    '<header><h1>' + esc(BRAND.name) + ' <span>· signal pipeline</span></h1><p>' + esc(String(signals.length)) + ' signals · <a href="/api/signals">/api/signals</a> · <a href="/bun/tooling">tooling</a> · <a href="/bun/overview">overview</a> · <a href="/bun/map">map</a> · <a href="/bun/api">api</a> · <a href="/bun/brand">brand</a> · <a href="/bun/xml">xml</a> · <a href="/design/trend">trend</a></p></header>' +
    body +
    '<script>' +
    'const csrf = "' + csrfToken + '";' +
    'const bind = () => document.querySelectorAll("button.act").forEach((b) => b.addEventListener("click", async () => {' +
    'const name = b.dataset.action; b.disabled = true;' +
    'try { const r = await fetch("/api/signals/actions/" + name, { method: "POST", headers: { "x-csrf-token": csrf } });' +
    'b.textContent = r.ok ? "done ok" : "failed (" + r.status + ")"; } catch { b.textContent = "failed"; }' +
    'setTimeout(() => refresh(), 800);' +
    '}));' +
    'const escH = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", \'"\': "&quot;" }[c]));' +
    'const channels = ' + '["design","deps","brand","releases","ops","inventory","cron","prune","mapping","docs","compliance"]' + ';' + // registry-driven: ALL 11 channels live-refresh
    'const refresh = async () => {' +
    'try {' +
    'const r = await fetch("/api/signals"); if (!r.ok) return;' +
    'const data = await r.json();' +
    'document.querySelector("header p").textContent = data.length + " signals · live";' +
    'channels.forEach((id) => {' +
    'const sec = document.querySelector(\'section[data-channel="\' + id + \'"]\'); if (!sec) return;' +
    'const h = sec.querySelector("h2").outerHTML;' +
    'const sigs = data.filter((s) => s.channel === id);' +
    'const rows = sigs.map((s) => \'<tr><td>\' + escH(s.title) + \'</td><td><span class="badge \' + s.severity + \'">\' + s.severity + \'</span></td><td class="muted">\' + escH(s.detail) + \'</td><td class="muted">\' + escH(s.source) + \'</td>\' + (s.action ? \'<td><button class="act" data-action="\' + escH(s.action) + \'">\' + escH(s.action.replace("-", " ")) + \'</button></td>\' : \'<td></td>\') + \'</tr>\').join("");' +
    'sec.innerHTML = h + (sigs.length ? \'<table><tr><th>Signal</th><th>Status</th><th>Detail</th><th>Source</th><th>Action</th></tr>\' + rows + \'</table>\' : \'<p class="muted">no signals</p>\');' +
    '});' +
    'bind();' +
    '} catch {}' +
    '};' +
    'bind();' +
    'setInterval(refresh, 15000);' +
    '</script>' +
    themeToggleButton() + '\n' + themeChrome() + '</body></html>';
}

import { Database } from 'bun:sqlite';

/** Read-only SQLite count (massey.db / event-store.db); null when absent. */
function sqlCount(dbPath: string, sql: string): number | null {
  try {
    const db = new Database(dbPath, { readonly: true });
    const row = db.query(sql).get() as { n?: number } | null;
    db.close();
    return typeof row?.n === 'number' ? row.n : null;
  } catch {
    return null;
  }
}

/**
 * Data-inventory signals: massey rankings, event-store scale, cross-market
 * registry, odds providers, research patterns, and the overall signal
 * scale/diversity. Honest coverage: reports what EXISTS and flags the gaps.
 */
export async function collectInventory(root: string, signals: Signal[]): Promise<void> {
  const push = (s: Signal): void => { signals.push(s); };
  const masseyDb = join(root, 'research/cache/massey.db');
  const evDb = join(root, 'research/cache/event-store.db');
  const masseySports = sqlCount(masseyDb, 'SELECT COUNT(DISTINCT sport) as n FROM massey_ratings');
  const masseyRatings = sqlCount(masseyDb, 'SELECT COUNT(*) as n FROM massey_ratings');
  const events = sqlCount(evDb, 'SELECT COUNT(*) as n FROM events');
  const markets = sqlCount(evDb, 'SELECT COUNT(*) as n FROM markets');
  const skins = sqlCount(evDb, 'SELECT COUNT(*) as n FROM skin_events');
  const ticks = sqlCount(evDb, 'SELECT COUNT(*) as n FROM book_ticks');

  const masseyOk = masseySports !== null && masseySports > 0;
  const masseySportsList = sqlCount(masseyDb, 'SELECT GROUP_CONCAT(DISTINCT sport, " · ") as n FROM massey_ratings');
  push({
    id: 'inv-massey',
    channel: 'inventory',
    severity: masseyOk ? 'ok' : 'warn',
    title: 'massey rankings: ' + (masseySports ?? 0) + ' sport(s), ' + (masseyRatings ?? 0) + ' ratings',
    detail: masseyOk ? (masseySportsList ?? '') + ' — synced via massey:sync' : 'massey.db missing — run bun run massey:sync',
    source: 'research/cache/massey.db',
  });
  push({
    id: 'inv-events',
    channel: 'inventory',
    severity: (events ?? 0) > 0 ? 'ok' : 'warn',
    title: 'event store: ' + (events ?? 0) + ' events / ' + (markets ?? 0) + ' markets',
    detail: (skins ?? 0) + ' skin events · ' + (ticks ?? 0) + ' book ticks — tennis-heavy domain',
    source: 'research/cache/event-store.db',
  });
  const registry = await Bun.file(join(root, 'public/registry/sports-sources.json')).json().catch(() => null) as { sports?: unknown[]; sources?: unknown[] } | null;
  const regSports = Array.isArray(registry?.sports) ? registry.sports.length : 0;
  const regSources = Array.isArray(registry?.sources) ? registry.sources.length : 0;
  push({
    id: 'inv-sports',
    channel: 'inventory',
    severity: regSports >= 2 ? 'ok' : 'warn',
    title: 'cross-market registry: ' + regSports + ' sport(s), ' + regSources + ' source(s)',
    detail: regSports < 5 ? 'only tennis/table-tennis — kalshi+polymarket sources (expansion gap)' : 'registry healthy',
    source: 'public/registry/sports-sources.json',
  });
  push({
    id: 'inv-providers',
    channel: 'inventory',
    severity: 'info',
    title: 'odds providers: fonbet + fantasy402; venues kalshi/polymarket/pinnacle/betfair',
    detail: 'fonbet is the only live odds feed — no pinnacle/betfair data, no NFL/NBA odds (gap)',
    source: 'src/institutions/{fonbet,venue-badge,partner}',
  });
  const tags = await Bun.file(join(root, 'research/keywords.json')).json().catch(() => null) as { strategyTags?: Record<string, unknown>; majorStrategyTags?: unknown[] } | null;
  const tagCount = tags && typeof tags.strategyTags === 'object' ? Object.keys(tags.strategyTags).length : 0;
  const majorCount = Array.isArray(tags?.majorStrategyTags) ? tags.majorStrategyTags.length : 0;
  push({
    id: 'inv-patterns',
    channel: 'inventory',
    severity: tagCount >= 5 ? 'ok' : 'warn',
    title: 'research patterns: ' + tagCount + ' strategy tag(s), ' + majorCount + ' major',
    detail: 'market_making · arb · sports · news_event · momentum · mean_reversion · llm_ensemble · sdk_only',
    source: 'research/keywords.json',
  });

  // Alpha program baselines (sports models): shadow-log signal counts +
  // program status from alpha/<name>/program.json. Offline, local files.
  const alphaDir = join(root, 'alpha');
  const alphaRows: Array<{ name: string; status: string; dimension: string; signals: number }> = [];
  try {
    for (const entry of readdirSync(alphaDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const prog = await Bun.file(join(alphaDir, entry.name, 'program.json')).json().catch(() => null) as { status?: string; dimension?: string } | null;
      if (!prog) continue;
      let signals = 0;
      try {
        const text = await Bun.file(join(alphaDir, entry.name, 'shadow-log.jsonl')).text();
        signals = text.trim() ? text.trim().split('\n').filter(Boolean).length : 0;
      } catch { /* no shadow log yet */ }
      alphaRows.push({ name: entry.name, status: prog.status ?? '?', dimension: prog.dimension ?? '?', signals });
    }
  } catch { /* no alpha dir */ }
  if (alphaRows.length) {
    const totalSignals = alphaRows.reduce((acc, a) => acc + a.signals, 0);
    const empty = alphaRows.filter((a) => a.signals === 0);
    push({
      id: 'inv-alpha',
      channel: 'inventory',
      severity: empty.length === 0 ? 'ok' : 'warn',
      title: 'alpha programs: ' + alphaRows.length + ' · ' + totalSignals + ' shadow signals',
      detail: alphaRows.map((a) => a.name + ':' + a.signals).join(' · ') + (empty.length ? ' — 0-signal program(s): start toxicity loop + ticks' : ''),
      source: 'alpha/*/shadow-log.jsonl',
    });
  }

  // Scale/diversity — computed last, after every other signal.
  const channels = new Set(signals.map((s) => s.channel)).size;
  const sources = new Set(signals.map((s) => s.source)).size;
  push({
    id: 'inv-scale',
    channel: 'inventory',
    severity: 'info',
    title: signals.length + ' signals across ' + channels + ' channels from ' + sources + ' sources',
    detail: 'diversity: ' + new Set(signals.map((s) => s.id)).size + ' unique ids — more sources wanted',
    source: 'signal pipeline',
  });
}

// ── Bun.cron channel: the pipeline refreshes ITSELF on a schedule ──────

/**
 * docs channel: FULL docs-quality surface (§67). Reads the state files the
 * docs gates write: docs-state.json (docs:check render §38), api-state.json
 * (docs:api existence §62), integrity-state.json (docs:integrity links/
 * imports/src §63/§65/§66), output-state.json (output:probe canary §64),
 * licenses-state.json (licenses:gate §92-§97 — compliance surface).
 * Any gate failing is bad; missing state is a warn; stale is a warn.
 */
/** Shared state-file gate: read .data/<file>, push ok/bad/warn (+stale) signals on a channel. */
async function pushGate(
  root: string,
  signals: Signal[],
  channel: Signal['channel'],
  file: string,
  id: string,
  label: string,
  source: string,
  detailOf: (s: Record<string, unknown>) => string,
): Promise<void> {
  const state = JSON.parse(await Bun.file(join(root, '.data', file)).text().catch(() => 'null'));
  const s = state && typeof state === 'object' && state.lastChecked ? state as Record<string, unknown> : null;
  if (!s) {
    signals.push({ id, channel, severity: 'warn', title: label + ' not run', detail: 'run bun run ' + source + ' to seed .data/' + file, source });
    return;
  }
  const ok = s.ok !== false;
  const ageDays = (Date.now() - new Date(String(s.lastChecked)).getTime()) / 86400000;
  signals.push({
    id,
    channel,
    severity: ok ? 'ok' : 'bad',
    title: label + ': ' + detailOf(s),
    detail: ok ? 'checked ' + String(s.lastChecked).slice(0, 10) : 'FAILING — run ' + source,
    source,
    action: source,
  });
  if (ageDays > 30) {
    signals.push({ id: id + '-stale', channel, severity: 'warn', title: label + ' state stale (' + Math.round(ageDays) + 'd)', detail: 'run ' + source, source, action: source });
  }
}

export async function collectDocs(root: string, signals: Signal[]): Promise<void> {
  await pushGate(root, signals, 'docs', 'docs-state.json', 'docs-health', 'docs:render', 'docs:check', (s) => String(s.total ?? 0) + ' markdown file(s) render');
  await pushGate(root, signals, 'docs', 'api-state.json', 'docs-api', 'docs:api', 'docs:api', (s) => String(s.tokens ?? 0) + ' tokens · ' + String(s.fails ?? 0) + ' drift' + (s.strict ? ' (STRICT)' : ''));
  await pushGate(root, signals, 'docs', 'integrity-state.json', 'docs-integrity', 'docs:integrity', 'docs:integrity', (s) => String(s.links ?? 0) + ' links · ' + String(s.staleSrc ?? 0) + ' stale src');
  await pushGate(root, signals, 'docs', 'output-state.json', 'docs-output', 'output:probe', 'output:probe', (s) => String(s.assertions ?? 0) + ' output assertions (canary)');
}

/**
 * compliance channel (§104): the license gate's state file, surfaced on its
 * OWN channel (was riding the docs channel §97). Same semantics: failing is
 * bad; missing state is a warn; stale is a warn.
 */
export async function collectCompliance(root: string, signals: Signal[]): Promise<void> {
  await pushGate(root, signals, 'compliance', 'licenses-state.json', 'licenses-health', 'licenses:gate', 'licenses:gate', (s) => String(s.packages ?? 0) + ' prod packages \u00b7 ' + String(s.fails ?? 0) + ' violations' + (Number(s.expiringSoon ?? 0) > 0 ? ' \u00b7 ' + String(s.expiringSoon) + ' expiring soon' : ''));
}

/**
 * github channel: LIVE research budget — token source + per-bucket remaining
 * (core/search/code_search). TTL-cached 5min inside github-budget.ts so the
 * 30s signal cache never hammers /rate_limit (it counts against core). No
 * token → warn with the fix hint; low budget → warn per bucket.
 */
export async function collectGithubBudgetSignals(signals: Signal[]): Promise<void> {
  const push = (s: Signal): void => { signals.push(s); };
  const snap = await collectGithubBudget();
  if (!snap) {
    // Distinguish "no token" from "token present but /rate_limit failed"
    // (401/network) — a bad GH_TOKEN is a different fix than gh auth login.
    const source = githubTokenSource();
    push({
      id: 'github-token',
      channel: 'github',
      severity: 'warn',
      title: source === 'none'
        ? 'no GitHub token — research + docs discovery run UNAUTHENTICATED'
        : 'GitHub token present but /rate_limit failed (401? network?)',
      detail: source === 'none'
        ? 'set GH_TOKEN / GITHUB_TOKEN in .env (Bun loads it natively) or run gh auth login'
        : 'check GH_TOKEN / GITHUB_TOKEN validity — gh auth token fallback may be stale',
      source: 'github-budget',
    });
    return;
  }
  push({
    id: 'github-source',
    channel: 'github',
    severity: snap.tokenSource === 'none' ? 'warn' : 'ok',
    title: 'token source: ' + snap.tokenSource + ' · checked ' + snap.checkedAt.slice(5, 16).replace('T', ' '),
    detail: 'env-gh-token / env-github-token / gh-cli — never the secret itself',
    source: 'github-budget',
  });
  const buckets: Array<[string, GitHubRateLimitSnapshot | null, number]> = [
    ['core', snap.core, 200],
    ['search', snap.search, 10],
    ['code_search', snap.codeSearch, 5],
  ];
  for (const [name, b, min] of buckets) {
    if (!b) continue;
    const reset = new Date(b.reset * 1000).toISOString().slice(11, 16) + 'Z';
    push({
      id: 'github-' + name,
      channel: 'github',
      severity: b.remaining < min ? 'warn' : b.remaining < min * 2 ? 'info' : 'ok',
      title: name + ' budget: ' + b.remaining + '/' + b.limit,
      detail: 'resets ' + reset + ' · research pipeline consumes this bucket' + (b.remaining < min ? ' — LOW: rate-limit aborts incoming' : ''),
      source: 'api.github.com/rate_limit',
    });
  }
}

/**
 * mapping channel: the blog → repo tracker state (AGENT-PITFALLS §31).
 * Reads .data/blog-map-state.json (written by bun:blog-map — never fetched
 * here, so the dashboard stays offline/fast). Coverage < 100% or missing
 * sub-headers is a warn; a stale state (> 30 days) is a warn too.
 */
export async function collectMapping(root: string, signals: Signal[]): Promise<void> {
  const push = (s: Signal): void => { signals.push(s); };
  const statePath = join(root, '.data/blog-map-state.json');
  const state = JSON.parse(await Bun.file(statePath).text().catch(() => 'null'));
  if (!state || typeof state !== 'object' || !state.lastChecked) {
    push({ id: 'mapping-state', channel: 'mapping', severity: 'warn', title: 'blog mapping tracker: not checked', detail: 'run bun run bun:blog-map to seed .data/blog-map-state.json', source: 'bun:blog-map' });
    return;
  }
  const ageDays = (Date.now() - new Date(state.lastChecked).getTime()) / 86400000;
  const ok = state.newUnmapped === 0 && state.missing.length === 0;
  push({
    id: 'mapping-coverage',
    channel: 'mapping',
    severity: ok ? 'ok' : 'warn',
    title: 'blog mapping: ' + Math.round(state.coverage * 100) + '% (' + state.matched + ' mapped)',
    detail: state.newUnmapped + ' unmapped' + (state.missing.length ? ' · ' + state.missing.length + ' missing' : '') + ' · checked ' + state.lastChecked.slice(0, 10),
    source: 'bun:blog-map',
    action: 'blog-map',
  });
  if (ageDays > 30) {
    push({ id: 'mapping-stale', channel: 'mapping', severity: 'warn', title: 'blog mapping state stale (' + Math.round(ageDays) + 'd)', detail: 'run bun run bun:blog-map to refresh', source: 'bun:blog-map', action: 'blog-map' });
  }
}

/**
 * prune channel: content-plane prune state (AGENT-PITFALLS §25/§26).
 *   - manifest: referenced content files count + integrity (missing refs
 *     are a FAIL — a broken manifest silently defeats the decision matrix)
 *   - .trash/: archived entries + bytes + any Bun.Archive tarballs
 *   - content:check gate mode is the executable version (--check).
 */
export async function collectPrune(root: string, signals: Signal[]): Promise<void> {
  const push = (s: Signal): void => { signals.push(s); };
  const manifestPath = join(root, '.data/manifest.json');
  const manifest: string[] = JSON.parse(await Bun.file(manifestPath).text().catch(() => '{"files":[]}')).files ?? [];
  const missing = manifest.filter((p) => !Bun.file(join(root, p)).exists());

  push({
    id: 'prune-manifest',
    channel: 'prune',
    severity: missing.length ? 'bad' : 'ok',
    title: 'manifest: ' + manifest.length + ' referenced file(s)',
    detail: missing.length
      ? missing.length + ' MISSING: ' + missing.slice(0, 3).join(', ') + (missing.length > 3 ? '…' : '') + ' — run content:check / content:prune --check'
      : 'all references exist — decision matrix sees real files',
    source: '.data/manifest.json',
    action: 'content-check',
  });

  // .trash/ footprint (recoverable removals)
  const trashDir = join(root, '.trash');
  let trashFiles = 0;
  let trashBytes = 0;
  let archives = 0;
  let trashEntries: string[] = [];
  try {
    trashEntries = readdirSync(trashDir, { recursive: true }) as unknown as string[];
  } catch { /* no .trash yet */ }
  for (const f of trashEntries) {
    if (f.endsWith('.meta.json')) continue;
    const st = await Bun.file(join(trashDir, f)).stat().catch(() => null);
    if (!st) continue;
    trashFiles += 1;
    trashBytes += st.size;
    if (/\.(tar|tar\.gz)$/.test(f)) archives += 1;
  }
  push({
    id: 'prune-trash',
    channel: 'prune',
    severity: trashFiles ? 'info' : 'ok',
    title: '.trash/: ' + trashFiles + ' archived file(s)',
    detail: (trashBytes / 1024).toFixed(1) + ' KB recoverable' + (archives ? ' · ' + archives + ' Bun.Archive tarball(s)' : '') + ' — gitignored, sidecar metadata per file',
    source: '.trash/',
  });
}

// Cron expressions live in the channel registry (cron + mapping channels).
export const SIGNAL_CRON_EXPR = CHANNEL_DEFS.cron.cron!.expr;

/**
 * Daily blog-map refresh cron ("0 3 * * *" — local time, once per process,
 * unref'd). Re-runs the tracker (network fetch) so the mapping channel's
 * state stays fresh without manual runs. Guarded like the feed cron so
 * tests creating many servers don't stack jobs.
 */
const blogMapState = { registered: false };
export function registerBlogMapCron(run: () => Promise<void>): void {
  if (blogMapState.registered || typeof Bun.cron !== 'function') return;
  blogMapState.registered = true;
  const job = Bun.cron(CHANNEL_DEFS.mapping.cron!.expr, async () => {
    try { await run(); } catch { /* next day retries */ }
  });
  job.unref();
}

export const signalCron = {
  registered: false,
  lastRun: null as string | null,
  lastOk: false,
  runs: 0,
  nextRun: null as string | null,
};

/**
 * Register a Bun.cron job (function form — event loop, no system cron) that
 * re-collects signals into the cache. Guarded: registers once per process
 * (serve.ts creates many servers in tests). The job is unref'd so it never
 * blocks process exit. Bun.cron verified in 1.4.0 (probe: parse + function
 * form + unref/stop).
 */
export function registerSignalCron(onRefresh: () => Promise<void>): void {
  if (signalCron.registered || typeof Bun.cron !== 'function') return;
  signalCron.registered = true;
  const job = Bun.cron(SIGNAL_CRON_EXPR, async () => {
    signalCron.runs += 1;
    try {
      await onRefresh();
      signalCron.lastOk = true;
    } catch {
      signalCron.lastOk = false;
    }
    signalCron.lastRun = new Date().toISOString();
    signalCron.nextRun = String(Bun.cron.parse(SIGNAL_CRON_EXPR));
  });
  job.unref();
}
