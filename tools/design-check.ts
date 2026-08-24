#!/usr/bin/env bun
/**
 * `bun run design:check` — design-system compliance gate for EVERY frontend
 * module plus per-module bundle budgets from the build metafiles.
 *
 * Surfaces:
 *   - enforced (fail on issues): renderHq() template, the /design page, hq-app
 *     static files, the generated design-system.css (baseCssVars +
 *     componentCss), the partner-dashboard board (data-driven partner identity
 *     hexes come from state.json and are allowlisted — UI chrome must still be
 *     TOKENS), and public/colors.css (generated).
 *   - reported (print issues, never fail): playground/ (dev sandbox).
 *
 * Budgets (from dist/<module>.meta.json byte-exact entry sizes; markdown
 * total kept as back-compat fallback):
 *   - design-system <= 12 KB, largest contributor <= 4 KB
 *   - hq-app        <= 64 KB, largest contributor <= 60 KB
 *   - renderHq() SSR output <= 128 KB (catches template ballooning)
 *   - growth vs previous build (dist/bundle-history.json) > 25% FAILS
 *     (> 10% warns)
 *   - dependency graph: no import cycles; no unexpected externals
 *     (design-system allows the documented `bun` external)
 * Missing metafiles trigger an on-demand design:build (dist/ is gitignored).
 *
 * Wired into `bun run check` and the pre-commit hook (conditional on
 * hq-app / design-system / partner-dashboard / playground changes).
 */
import { join } from 'node:path';
import { designAgent } from '../src/agent/design-agent.ts';
import { renderHq } from '../src/research/hq-view.ts';
import { renderDesignPage } from '../src/research/design-page.ts';
import { renderTrendPage } from '../src/research/trend-page.ts';
import { renderVideoPage } from '../src/research/video-page.ts';
import { renderNetworkingPage } from '../src/research/networking-page.ts';
import { renderStreamsPage } from '../src/research/streams-page.ts';
import { renderObservabilityPage } from '../src/research/observability-page.ts';
import { renderPerformancePage } from '../src/research/performance-page.ts';
import { renderUtilitiesPage } from '../src/research/utilities-page.ts';
import { renderOverviewPage } from '../src/research/overview-page.ts';
import { renderToolingPage } from '../src/research/tooling-page.ts';
import { renderColorPage } from '../src/research/color-page.ts';
import { renderLivePage } from '../src/research/live-page.ts';
import { renderHashingPage } from '../src/research/hashing-page.ts';
import { renderPruningPage } from '../src/research/pruning-page.ts';
import { renderSecurityPage } from '../src/research/security-page.ts';
import { renderSpeedPage } from '../src/research/speed-page.ts';
import { renderMapPage } from '../src/research/map-page.ts';
import { renderMarkdownPage } from '../src/research/markdown-page.ts';
import { renderTranspilerPage } from '../src/research/transpiler-page.ts';
import { renderDashboard } from '../src/institutions/signal-pipeline.ts';
import { brandCardSvg } from '../src/lib/brand-image.ts';
import { baseCssVars } from '../src/institutions/design-tokens.ts';
import { componentCss } from '../src/institutions/hq-ui.ts';
import { scanDeadImports } from '../src/lib/design-deadcode.ts';
import { checkBrowserSafety } from '../src/lib/design-browser-safety.ts';
import {
  DESIGN_MODULES,
  DESIGN_MODULE_NAMES,
  MAX_GROWTH_PCT,
  WARN_GROWTH_PCT,
  budgetStatus,
  bundleHistoryPath,
  circularImports,
  contributorStatus,
  deltaPct,
  deltaStatus,
  externalImports,
  checkBundleOutputs,
  gitSnapshot,
  largestContributorBytes,
  metaJsonPath,
  metaMdPath,
  moduleBytesFromMetaJson,
  npmModulesInBundle,
  readBundleHistory,
  recordBundleHistory,
  totalBytesFromMetaMd,
} from '../src/lib/design-budget.ts';

const ROOT = join(import.meta.dir, '..');
const hqAppDir = join(ROOT, 'src/research/hq-app');

/** SSR template ceiling: renderHq() output must stay under this. */
const MAX_RENDERHQ_BYTES = 128 * 1024; // 128 KB — current output is ~57 KB

// ── Surfaces ─────────────────────────────────────────────────────────────
type Surface = {
  label: string;
  load: () => Promise<string>;
  /** Extra legal hex values for DATA-DRIVEN colors on this surface. */
  legal?: () => Promise<string[]>;
};

const enforcedSurfaces: Surface[] = [
  { label: 'renderHq()', load: async () => renderHq() },
  { label: '/design page', load: async () => renderDesignPage() },
  { label: 'brand-card.svg', load: async () => brandCardSvg() },
  { label: '/videos page', load: async () => renderVideoPage(['demo.mp4']) },
  { label: '/bun/networking', load: async () => renderNetworkingPage() },
  { label: '/bun/streams', load: async () => renderStreamsPage() },
  { label: '/bun/observability', load: async () => renderObservabilityPage() },
  { label: '/bun/performance', load: async () => renderPerformancePage() },
  { label: '/bun/utilities', load: async () => renderUtilitiesPage() },
  { label: '/bun/overview', load: async () => renderOverviewPage() },
  { label: '/bun/tooling', load: async () => renderToolingPage() },
  {
    label: '/bun/color',
    load: async () => renderColorPage(),
    // Probe-table example hexes (color-mix #800080, hwb #ff0000, alpha
    // #ff0000aa) are DATA — probe outputs, not UI chrome. Allowlisted like
    // partner-dashboard state.json hexes; the theme itself is TOKENS-backed.
    legal: async () => ['#800080', '#ff0000', '#ff0000aa'],
  },
  { label: '/bun/live', load: async () => renderLivePage() },
  { label: '/bun/hashing', load: async () => renderHashingPage() },
  { label: '/bun/pruning', load: async () => renderPruningPage() },
  { label: '/bun/security', load: async () => renderSecurityPage() },
  { label: '/bun/speed', load: async () => renderSpeedPage() },
  { label: '/bun/map', load: async () => renderMapPage() },
  { label: '/bun/markdown', load: async () => renderMarkdownPage() },
  { label: '/bun/transpiler', load: async () => renderTranspilerPage() },
  {
    label: '/dashboard (signal pipeline)',
    load: async () =>
      renderDashboard(
        [
          { id: 'd', channel: 'design', severity: 'ok', title: 'x', detail: 'y', source: 'z' },
          { id: 'b', channel: 'brand', severity: 'bad', title: 'x', detail: 'y', source: 'z', action: 'brand-card' },
        ],
        'tok',
      ),
  },
  {
    label: '/design/trend',
    load: async () => renderTrendPage(await readBundleHistory(bundleHistoryPath(ROOT)), new Date().toISOString()),
  },
  { label: 'design-system.css (generated)', load: async () => baseCssVars() + componentCss() },
  { label: 'hq-app/index.html', load: () => Bun.file(join(hqAppDir, 'index.html')).text().catch(() => '') },
  { label: 'hq-app/styles.css', load: () => Bun.file(join(hqAppDir, 'styles.css')).text().catch(() => '') },
  { label: 'hq-app/app.js', load: () => Bun.file(join(hqAppDir, 'app.js')).text().catch(() => '') },
  { label: 'hq-app/color-vars.css', load: () => Bun.file(join(hqAppDir, 'color-vars.css')).text().catch(() => '') },
  { label: 'hq-app/token-vars.css', load: () => Bun.file(join(hqAppDir, 'token-vars.css')).text().catch(() => '') },
  {
    label: 'public/partner-dashboard/index.html',
    load: () => Bun.file(join(ROOT, 'public/partner-dashboard/index.html')).text().catch(() => '')
    ,
    // Per-partner identity hexes (getPartnerVisual) are data-driven, not UI
    // chrome: allowlist exactly the hexes present in the baked snapshot.
    legal: async () => {
      const state = await Bun.file(join(ROOT, 'public/partner-dashboard/state.json')).json().catch(() => null);
      if (!state || typeof state !== 'object') return [];
      const hexes = new Set<string>();
      for (const p of (state as { partners?: Array<{ hex?: unknown }> }).partners ?? []) {
        if (typeof p?.hex === 'string') hexes.add(p.hex);
      }
      for (const o of (state as { outs?: Array<{ hex?: unknown }> }).outs ?? []) {
        if (typeof o?.hex === 'string') hexes.add(o.hex);
      }
      return [...hexes];
    },
  },
  { label: 'public/colors.css', load: () => Bun.file(join(ROOT, 'public/colors.css')).text().catch(() => '') },
];

const reportedSurfaces: Surface[] = [
  { label: 'playground/funding-playground.html', load: () => Bun.file(join(ROOT, 'playground/funding-playground.html')).text().catch(() => '') },
  { label: 'playground/funding-playground-demo.html', load: () => Bun.file(join(ROOT, 'playground/funding-playground-demo.html')).text().catch(() => '') },
];

// ── Enforced surfaces ────────────────────────────────────────────────────
let auditFail = false;
const issues: string[] = [];
for (const surface of enforcedSurfaces) {
  const text = await surface.load();
  const extraLegal = surface.legal ? await surface.legal() : undefined;
  const audit = extraLegal ? designAgent.audit(text, { legal: extraLegal }) : designAgent.audit(text);
  for (const issue of audit.issues) {
    auditFail = true;
    issues.push(issue.kind + ' ' + issue.value + ' — ' + surface.label + ' · ' + issue.detail);
  }
  if (surface.label === 'renderHq()' && text.length > MAX_RENDERHQ_BYTES) {
    auditFail = true;
    issues.push(
      'renderhq-overflow renderHq()=' + text.length + 'B — SSR output over ' + MAX_RENDERHQ_BYTES + 'B ceiling',
    );
  }
}
for (const issue of issues) console.error('design:check ' + issue);

// ── Reported surfaces (migration backlog — never fail) ───────────────────
let backlog = 0;
for (const surface of reportedSurfaces) {
  const text = await surface.load();
  const before = backlog;
  const audit = designAgent.audit(text);
  for (const issue of audit.issues) {
    backlog += 1;
    console.error('design:check (backlog) ' + issue.kind + ' ' + issue.value + ' — ' + surface.label + ' · ' + issue.detail);
  }
  if (backlog === before) {
    console.log('design:check surface ' + surface.label + ': token-compliant');
  }
}

// ── Per-module bundle budgets + metafile analysis ────────────────────────
let budgetFail = false;
let builtOnDemand = false;
const historyPath = bundleHistoryPath(ROOT);
const history = await readBundleHistory(historyPath);
const sizes: Record<string, number> = {};

for (const module of DESIGN_MODULE_NAMES) {
  const spec = DESIGN_MODULES[module];
  const jsonPath = metaJsonPath(module, ROOT);
  const mdPath = metaMdPath(module, ROOT);
  let meta: unknown = null;
  let bytes: number | null = null;

  const jsonText = await Bun.file(jsonPath).text().catch(() => '');
  if (jsonText) {
    try {
      meta = JSON.parse(jsonText);
      bytes = moduleBytesFromMetaJson(module, meta);
    } catch {
      meta = null;
      bytes = null;
    }
  }
  // Back-compat fallback: design-system metafile may exist as the markdown
  // report only (the original pipeline) or freshly built on demand.
  if (bytes === null && !jsonText) {
    const mdText = await Bun.file(mdPath).text().catch(() => '');
    if (mdText) bytes = totalBytesFromMetaMd(mdText);
  }

  if (bytes === null && !builtOnDemand) {
    const build = Bun.spawn([Bun.which('bun') ?? 'bun', 'scripts/build-design-system.ts'], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' });
    await build.exited;
    builtOnDemand = true;
    const reJson = await Bun.file(jsonPath).text().catch(() => '');
    if (reJson) {
      try {
        meta = JSON.parse(reJson);
        bytes = moduleBytesFromMetaJson(module, meta);
      } catch {
        meta = null;
        bytes = null;
      }
    }
  }

  if (bytes === null) {
    console.log('design:check budget ' + module + ': missing metafile — run design:build');
    continue;
  }
  sizes[module] = bytes;

  // ── budget vs ceiling ──
  const over = bytes > spec.maxBytes;
  if (over) budgetFail = true;

  // ── largest contributor vs its own ceiling ──
  const largest = meta ? largestContributorBytes(module, meta) : null;
  const largestOver = largest !== null && largest > spec.maxContributorBytes;
  if (largestOver) {
    budgetFail = true;
    console.error('design:check ' + module + ' largest contributor over ' + (spec.maxContributorBytes / 1024) + ' KB');
  }

  // ── growth vs previous build (trend gate) ──
  const prev = history[module]?.at(-1)?.bytes ?? null;
  const growth = deltaPct(prev, bytes);
  if (growth !== null && growth > MAX_GROWTH_PCT) {
    budgetFail = true;
    console.error('design:check ' + module + ' grew ' + growth.toFixed(1) + '% vs previous build (max ' + MAX_GROWTH_PCT + '%)');
  } else if (growth !== null && growth > WARN_GROWTH_PCT) {
    console.error('design:check warn ' + module + ' grew ' + growth.toFixed(1) + '% vs previous build (warn > ' + WARN_GROWTH_PCT + '%)');
  }

  // ── dependency-graph checks (cycles + unexpected externals + npm) ──
  const graphOk = meta !== null;
  if (graphOk) {
    const cycles = circularImports(meta);
    if (cycles.length) {
      budgetFail = true;
      console.error('design:check ' + module + ' import cycle(s): ' + cycles.map((c) => c.join(' -> ')).join(' | '));
    }
    const externals = externalImports(meta).filter((e) => !(module === 'design-system' && e.specifier === 'bun'));
    if (externals.length) {
      budgetFail = true;
      console.error('design:check ' + module + ' unexpected external(s): ' + externals.map((e) => e.specifier + ' (' + e.from + ')').join(', '));
    }
    const npm = npmModulesInBundle(meta);
    if (npm.length) {
      budgetFail = true;
      console.error('design:check ' + module + ' bundles npm module(s) — zero-npm-dep contract violated: ' + npm.join(', '));
    }
  }

  const flag = over || largestOver ? 'FAIL' : 'ok';
  console.log(
    'design:check budget ' + module + ': ' + budgetStatus(bytes, spec.maxBytes) +
      ' · ' + contributorStatus(largest, spec.maxContributorBytes) +
      ' · ' + deltaStatus(growth) +
      ' [' + flag + ']',
  );
}

// Record the trend snapshot (only when we have real sizes), correlated to
// the current git commit so the trend dashboard can explain size jumps.
if (Object.keys(sizes).length) {
  await recordBundleHistory(historyPath, sizes, undefined, await gitSnapshot(ROOT));
}

// ── Dead-import scan (warning only — heuristic) ───────────────────────────
const deadFiles = new Set<string>();
for (const module of DESIGN_MODULE_NAMES) {
  const jsonText = await Bun.file(metaJsonPath(module, ROOT)).text().catch(() => '');
  if (!jsonText) continue;
  try {
    const inputs = (JSON.parse(jsonText) as { inputs?: Record<string, unknown> }).inputs ?? {};
    for (const path of Object.keys(inputs)) {
      if (path.startsWith('node_modules') || path.startsWith('bun')) continue;
      deadFiles.add(join(ROOT, path));
    }
  } catch {
    // skip unparsable metafile
  }
}
const deadImports = await scanDeadImports([...deadFiles]);
if (deadImports.length) {
  console.error('design:check warn dead-import potential: ' + deadImports.length + ' (tool: bun run design:dead-imports)');
  for (const d of deadImports.slice(0, 5)) {
    console.error('design:check (dead-import) ' + d.file.replace(ROOT + '/', '') + ' imports ' + d.name + ' from ' + d.specifier);
  }
}

// ── Browser-safety lint (unguarded Bun refs in browser bundles — FAILS) ──
const safetyViolations = await checkBrowserSafety([...deadFiles]);
for (const v of safetyViolations) {
  budgetFail = true;
  console.error('design:check browser-safety FAIL ' + v.file.replace(ROOT + '/', '') + ': ' + v.detail);
}

// ── Bundle output integrity (post-build macro/Bun leak — FAILS) ──────────
const outputIssues = await checkBundleOutputs(ROOT);
for (const v of outputIssues) {
  budgetFail = true;
  console.error('design:check output FAIL dist/' + v.file + ': ' + v.detail);
}

const surfacesTotal = enforcedSurfaces.length + reportedSurfaces.length;
console.log(
  'design:check: ' +
    (auditFail || budgetFail ? 'FAIL' : 'ok') +
    ' · ' +
    issues.length +
    ' enforced issue(s) · ' +
    backlog +
    ' backlog issue(s) · ' +
    surfacesTotal +
    ' surfaces (v' +
    designAgent.audit('').version +
    ')',
);
process.exit(auditFail || budgetFail ? 1 : 0);
