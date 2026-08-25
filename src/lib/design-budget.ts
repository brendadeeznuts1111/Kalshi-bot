/**
 * design-budget.ts — per-module bundle budgets + metafile analysis for the
 * design/frontend build pipeline. Single source of truth consumed by
 * tools/design-check.ts (the design:check gate), served live by the
 * /api/design/budgets endpoint, and tested in tests/lib/design-budget.test.ts.
 *
 * Each frontend module is bundled by scripts/build-design-system.ts into
 * dist/<module>.js with a Bun metafile (dist/<module>.meta.json) plus an
 * LLM-friendly markdown report (dist/<module>.meta.md). The gate reads the
 * byte-exact per-entry sizes from the JSON metafile, tracks deltas against a
 * small build history (dist/bundle-history.json), and runs dependency-graph
 * checks (cycles, unexpected externals) over the same metafile.
 */
import { join } from 'node:path';

export type DesignModule = 'design-system' | 'hq-app';

export type DesignModuleSpec = {
  /** Source entry that the bundle is built from. */
  entry: string;
  /** Bundle output name in dist/. */
  out: string;
  /** Budget in bytes; design:check fails when exceeded. */
  maxBytes: number;
  /** Largest single-module contribution to the bundle; fails when exceeded. */
  maxContributorBytes: number;
};

export const DESIGN_MODULES: Record<DesignModule, DesignModuleSpec> = {
  'design-system': {
    entry: 'src/institutions/design-system.ts',
    out: 'design-system.js',
    // 12 KB — headroom over the 4.65 KB bundle (kept from the original gate).
    maxBytes: 12 * 1024,
    // Largest contributor is the color kernel (1.9 KB) / design-tokens (1.7 KB).
    maxContributorBytes: 4 * 1024,
  },
  'hq-app': {
    entry: 'src/research/hq-app/app.js',
    out: 'hq-app.js',
    // 64 KB — hq-app minifies 73.8 KB source to ~48.5 KB (measured); the
    // runtime bundles hq-app itself via Bun HTML imports, so this budget
    // guards the analysis artifact + documents the frontend's size ceiling.
    maxBytes: 64 * 1024,
    // app.js alone is 47.6 KB of the 49.7 KB bundle (95.7%). This budget
    // keeps the monolith from growing unboundedly and nudges chunking.
    maxContributorBytes: 60 * 1024,
  },
} as const;

export const DESIGN_MODULE_NAMES = Object.keys(DESIGN_MODULES) as DesignModule[];

/** Growth vs previous build: > this % fails the gate (regression guard). */
export const MAX_GROWTH_PCT = 25;
/** Growth vs previous build: > this % prints a warning. */
export const WARN_GROWTH_PCT = 10;
/** Keep this many history entries per module. */
export const HISTORY_DEPTH = 10;

/** dist/<module>.meta.json path for a module. */
export function metaJsonPath(module: DesignModule, root: string): string {
  return join(root, 'dist', module + '.meta.json');
}

/** dist/<module>.meta.md path for a module. */
export function metaMdPath(module: DesignModule, root: string): string {
  return join(root, 'dist', module + '.meta.md');
}

/** dist/bundle-history.json — per-module size history (trend gate). */
export function bundleHistoryPath(root: string): string {
  return join(root, 'dist', 'bundle-history.json');
}

// ── Metafile size extraction ─────────────────────────────────────────────

/**
 * Extract byte-exact sizes per entry point from a Bun metafile JSON payload.
 * The metafile's "outputs" map has an "entryPoint" (source path) and "bytes"
 * per emitted bundle. Returns entry source path -> output bytes. Never
 * throws: malformed payloads yield an empty map.
 */
export function entryBytesFromMetaJson(metaJson: unknown): Map<string, number> {
  const out = new Map<string, number>();
  if (!metaJson || typeof metaJson !== 'object') return out;
  const outputs = (metaJson as { outputs?: Record<string, unknown> }).outputs;
  if (!outputs || typeof outputs !== 'object') return out;
  for (const value of Object.values(outputs)) {
    if (!value || typeof value !== 'object') continue;
    const entry = (value as { entryPoint?: unknown }).entryPoint;
    const bytes = (value as { bytes?: unknown }).bytes;
    if (typeof entry === 'string' && typeof bytes === 'number') {
      out.set(entry, bytes);
    }
  }
  return out;
}

/** Output bytes for a module, from a parsed metafile JSON payload (null when absent). */
export function moduleBytesFromMetaJson(module: DesignModule, metaJson: unknown): number | null {
  const entry = DESIGN_MODULES[module].entry;
  return entryBytesFromMetaJson(metaJson).get(entry) ?? null;
}

/**
 * Largest single-module contribution (bytesInOutput) to a module's bundle.
 * This is the "what dominates the bundle" number — the metafile report's
 * Largest Modules table, machine-read. Null when the metafile is absent or
 * the entry's inputs are missing.
 */
export function largestContributorBytes(module: DesignModule, metaJson: unknown): number | null {
  if (!metaJson || typeof metaJson !== 'object') return null;
  const outputs = (metaJson as { outputs?: Record<string, unknown> }).outputs;
  if (!outputs || typeof outputs !== 'object') return null;
  const entry = DESIGN_MODULES[module].entry;
  for (const value of Object.values(outputs)) {
    if (!value || typeof value !== 'object') continue;
    if ((value as { entryPoint?: unknown }).entryPoint !== entry) continue;
    const inputs = (value as { inputs?: Record<string, unknown> }).inputs;
    if (!inputs || typeof inputs !== 'object') return null;
    let max = 0;
    for (const iv of Object.values(inputs)) {
      const b = (iv as { bytesInOutput?: unknown }).bytesInOutput;
      if (typeof b === 'number' && b > max) max = b;
    }
    return max;
  }
  return null;
}

/**
 * Fallback: parse "Total output size" from the markdown report
 * (--metafile-md). Returns bytes or null when unparsable.
 */
export function totalBytesFromMetaMd(metaMd: string): number | null {
  const m = metaMd.match(/Total output size\s*\|\s*([\d.]+)\s*([KM]?B)/);
  if (!m) return null;
  const num = Number(m[1]!);
  const unit = m[2]!;
  return unit === 'KB' ? num * 1024 : unit === 'MB' ? num * 1024 * 1024 : num;
}

// ── Dependency-graph checks ──────────────────────────────────────────────

/**
 * Detect import cycles within a metafile's module graph (only edges between
 * graph members; externals are ignored). Returns one list per cycle, each
 * the cycle path starting at the lowest-index member, e.g.
 * [["a.ts","b.ts","a.ts"]]. Deterministic (DFS with gray/black marking).
 */
export function circularImports(metaJson: unknown): string[][] {
  if (!metaJson || typeof metaJson !== 'object') return [];
  const inputs = (metaJson as { inputs?: Record<string, unknown> }).inputs;
  if (!inputs || typeof inputs !== 'object') return [];
  const members = new Set(Object.keys(inputs));
  const adj = new Map<string, string[]>();
  for (const [path, v] of Object.entries(inputs)) {
    const imports = (v as { imports?: Array<{ path?: unknown }> }).imports ?? [];
    adj.set(
      path,
      imports.map((i) => i.path).filter((p): p is string => typeof p === 'string' && members.has(p)),
    );
  }
  const sorted = [...members].sort();
  const state = new Map<string, 'gray' | 'black'>();
  const stack: string[] = [];
  const cycles: string[][] = [];

  const visit = (node: string): void => {
    state.set(node, 'gray');
    stack.push(node);
    for (const next of adj.get(node) ?? []) {
      const s = state.get(next);
      if (s === 'gray') {
        const start = stack.indexOf(next);
        cycles.push([...stack.slice(start), next]);
      } else if (s === undefined) {
        visit(next);
      }
    }
    stack.pop();
    state.set(node, 'black');
  };

  for (const node of sorted) {
    if (state.get(node) === undefined) visit(node);
  }
  return cycles;
}

/**
 * External imports in a metafile graph: specifiers whose path is not a graph
 * member (node builtins, "bun", node_modules). Browser bundles should have
 * none; the design-system bundle allows the documented "bun" external
 * (browser-constants.ts).
 */
export function externalImports(metaJson: unknown): Array<{ from: string; specifier: string }> {
  if (!metaJson || typeof metaJson !== 'object') return [];
  const inputs = (metaJson as { inputs?: Record<string, unknown> }).inputs;
  if (!inputs || typeof inputs !== 'object') return [];
  // Split chunks + assets are generated OUTPUTS, not inputs — an entry's
  // import of ./chunk-*.js / ./x.css is internal, not external (§163).
  const outputs = (metaJson as { outputs?: Record<string, unknown> }).outputs;
  const members = new Set([
    ...Object.keys(inputs),
    ...(outputs && typeof outputs === 'object' ? Object.keys(outputs) : []),
  ]);
  const out: Array<{ from: string; specifier: string }> = [];
  for (const [path, v] of Object.entries(inputs)) {
    const imports = (v as { imports?: Array<{ path?: unknown }> }).imports ?? [];
    for (const i of imports) {
      if (typeof i?.path === 'string' && !members.has(i.path)) {
        out.push({ from: path, specifier: i.path });
      }
    }
  }
  return out;
}

// ── Build history (trend gate) ───────────────────────────────────────────
// Entries carry an optional git snapshot (commit/branch/message) so a size
// jump on the trend dashboard can be correlated to the change that caused it.

/** Read dist/bundle-history.json (missing/corrupt -> empty). */
export async function readBundleHistory(path: string): Promise<BundleHistory> {
  const text = await Bun.file(path).text().catch(() => '');
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as BundleHistory) : {};
  } catch {
    return {};
  }
}

/**
 * Append current sizes to the history (trimmed to HISTORY_DEPTH per module)
 * and persist. Returns the updated history. `now` is injectable for tests;
 * `git` is the correlation snapshot recorded with each new entry.
 */
export async function recordBundleHistory(
  path: string,
  sizes: Record<string, number>,
  now: () => string = () => new Date().toISOString(),
  git?: { commit?: string; branch?: string; message?: string },
): Promise<BundleHistory> {
  const history = await readBundleHistory(path);
  for (const [module, bytes] of Object.entries(sizes)) {
    const list = history[module] ?? [];
    const prev = list.at(-1);
    // Skip recording when the size is unchanged — keeps history to real deltas.
    if (prev && prev.bytes === bytes) continue;
    history[module] = [...list, { at: now(), bytes, ...git }].slice(-HISTORY_DEPTH);
  }
  await Bun.write(path, JSON.stringify(history, null, 2) + '\n');
  return history;
}

/** Percent growth of `cur` vs `prev` (null when prev is absent/zero). */
export function deltaPct(prev: number | null | undefined, cur: number): number | null {
  if (prev === null || prev === undefined || prev === 0) return null;
  return ((cur - prev) / prev) * 100;
}

/** Human-readable budget line, e.g. "49.66 KB / 64 KB (0.78x)". */
export function budgetStatus(bytes: number | null, maxBytes: number): string {
  if (bytes === null) return 'missing metafile';
  const kb = (bytes / 1024).toFixed(2);
  const maxKb = (maxBytes / 1024).toFixed(0) + ' KB';
  const ratio = (bytes / maxBytes).toFixed(2);
  return `${kb} KB / ${maxKb} (${ratio}x)`;
}

/** Contributor status, e.g. "largest app.js 47.55 KB (max 60 KB)". */
export function contributorStatus(bytes: number | null, maxBytes: number): string {
  if (bytes === null) return 'largest unknown';
  return `largest ${(bytes / 1024).toFixed(2)} KB (max ${(maxBytes / 1024).toFixed(0)} KB)`;
}

/** Delta status, e.g. "Δ +1.2% vs prev" / "Δ new". */
export function deltaStatus(pct: number | null): string {
  if (pct === null) return 'Δ new';
  return `Δ ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

// ── Bundle summary (one-liner for watch feedback / reports) ──────────────

/**
 * Compact per-module budget status line, e.g.:
 *   design-system 4.65 KB/12 KB (largest 1.86 KB) · hq-app 48.50 KB/64 KB (largest 46.44 KB)
 * Reads the current metafiles + history; "missing" for unbult modules.
 */
export async function summarizeBudgets(root: string): Promise<string> {
  const history = await readBundleHistory(bundleHistoryPath(root));
  const parts: string[] = [];
  for (const module of DESIGN_MODULE_NAMES) {
    const spec = DESIGN_MODULES[module];
    const jsonText = await Bun.file(metaJsonPath(module, root)).text().catch(() => "");
    let bytes: number | null = null;
    let largest: number | null = null;
    if (jsonText) {
      try {
        const meta = JSON.parse(jsonText) as unknown;
        bytes = moduleBytesFromMetaJson(module, meta);
        largest = largestContributorBytes(module, meta);
      } catch {
        bytes = null;
      }
    }
    if (bytes === null) {
      parts.push(module + " missing");
      continue;
    }
    const prev = history[module]?.at(-1)?.bytes ?? null;
    const growth = deltaPct(prev, bytes);
    const kb = (bytes / 1024).toFixed(2);
    const budgetKb = (spec.maxBytes / 1024).toFixed(0);
    const largestKb = largest !== null ? (largest / 1024).toFixed(2) : "?";
    parts.push(
      module +
        " " + kb + " KB/" + budgetKb + " KB (largest " + largestKb + " KB" +
        (growth !== null ? " · Δ " + (growth >= 0 ? "+" : "") + growth.toFixed(1) + "%" : "") +
        ")",
    );
  }
  return parts.join(" · ");
}

// ── Zero-npm-dependency contract ─────────────────────────────────────────

/**
 * node_modules modules bundled into a metafile graph (inputs whose path
 * starts with "node_modules"). The design system + hq-app are Bun-native by
 * contract: any npm module here is a violation worth failing on.
 */
export function npmModulesInBundle(metaJson: unknown): string[] {
  if (!metaJson || typeof metaJson !== "object") return [];
  const inputs = (metaJson as { inputs?: Record<string, unknown> }).inputs;
  if (!inputs || typeof inputs !== "object") return [];
  return Object.keys(inputs).filter((p) => p.startsWith("node_modules"));
}

// ── Bundle health payload (shared by /api/design and /api/design/budgets) ─

export type ModuleBudgetHealth = {
  bytes: number | null;
  budget: number;
  largest: number | null;
  largestBudget: number;
  deltaPct: number | null;
  ok: boolean;
};

export type BudgetHealth = Record<string, ModuleBudgetHealth>;

/**
 * Current per-module bundle health from the dist metafiles + history.
 * Returns {} when no metafiles exist yet (fresh checkout before design:build).
 */
export async function buildBudgetHealth(root: string): Promise<BudgetHealth> {
  const history = await readBundleHistory(bundleHistoryPath(root));
  const out = {} as BudgetHealth;
  for (const module of DESIGN_MODULE_NAMES) {
    const spec = DESIGN_MODULES[module];
    const jsonText = await Bun.file(metaJsonPath(module, root)).text().catch(() => "");
    let meta: unknown = null;
    if (jsonText) {
      try {
        meta = JSON.parse(jsonText) as unknown;
      } catch {
        meta = null;
      }
    }
    const bytes = meta ? moduleBytesFromMetaJson(module, meta) : null;
    const largest = meta ? largestContributorBytes(module, meta) : null;
    const prev = history[module]?.at(-1)?.bytes ?? null;
    out[module] = {
      bytes,
      budget: spec.maxBytes,
      largest,
      largestBudget: spec.maxContributorBytes,
      deltaPct: deltaPct(prev, bytes ?? 0),
      ok: bytes !== null && bytes <= spec.maxBytes && (largest ?? 0) <= spec.maxContributorBytes,
    };
  }
  return out;
}

// ── Git-correlated bundle history ─────────────────────────────────────────

export type BundleHistoryEntry = {
  at: string;
  bytes: number;
  /** Short commit hash at record time (correlates size jumps to changes). */
  commit?: string;
  branch?: string;
  /** First line of the commit message. */
  message?: string;
};

export type BundleHistory = Record<string, Array<BundleHistoryEntry>>;

/** Read-only git snapshot for history correlation (never throws). */
export async function gitSnapshot(root: string): Promise<{ commit?: string; branch?: string; message?: string }> {
  const out: { commit?: string; branch?: string; message?: string } = {};
  const run = (args: string[]): string => {
    const p = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
    if (p.exitCode !== 0) return "";
    return new TextDecoder().decode(p.stdout).trim();
  };
  out.commit = run(["rev-parse", "--short", "HEAD"]);
  out.branch = run(["branch", "--show-current"]);
  out.message = run(["log", "-1", "--pretty=%s"]);
  if (!out.commit) delete out.commit;
  if (!out.branch) delete out.branch;
  if (!out.message) delete out.message;
  return out;
}

// ── Bundle output integrity (post-build verification) ─────────────────────

export type OutputIntegrityIssue = {
  file: string;
  detail: string;
};

/**
 * Verify the BUILT bundles (dist/<module>.js), not just the source graph:
 *  - no runtime "bun" import may leak (browser-constants' macro must resolve
 *    at build time — a regressed `from "bun"` would crash browsers);
 *  - the hq-app bundle must contain ZERO Bun references (server-side token
 *    injection means the kernel never ships to the live page);
 *  - the design-system bundle may keep its guarded Bun.color (env adapter).
 */
export async function checkBundleOutputs(root: string): Promise<OutputIntegrityIssue[]> {
  const issues: OutputIntegrityIssue[] = [];
  for (const module of DESIGN_MODULE_NAMES) {
    const outName = DESIGN_MODULES[module].out;
    const outPath = join(root, 'dist', outName);
    const text = await Bun.file(outPath).text().catch(() => '');
    if (!text) {
      issues.push({ file: outName, detail: 'missing bundle output — run bun run design:build' });
      continue;
    }
    if (/from\s+["']bun["']/.test(text)) {
      issues.push({ file: outName, detail: 'runtime "bun" import leaked into the bundle — macro not resolved at build time' });
    }
    if (module === 'hq-app' && /\bBun\./.test(text)) {
      issues.push({ file: outName, detail: 'live bundle references Bun — kernel/fallback must not ship to the page' });
    }
  }
  return issues;
}
