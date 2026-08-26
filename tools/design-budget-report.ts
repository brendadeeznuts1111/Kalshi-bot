#!/usr/bin/env bun
/**
 * `bun run design:report` — budget summary for humans: prints a markdown
 * block with per-module sizes/budgets/largest/delta + graph health, from the
 * same metafiles the design:check gate reads.
 *
 *   bun run design:report            # print the markdown block
 *   bun run design:report -- --pr=42 # also post it as a PR comment
 *
 * PR posting uses the GitHub REST API via Bun.fetch; requires GITHUB_TOKEN
 * (and the PR must be on this repo). CI wiring: GitHub Actions hosted
 * runners are billing-blocked in this repo (manual diagnostic only per
 * AGENTS.md) — the workflow in .github/workflows/design-budget-comment.yml
 * activates the day hosted runners return.
 */
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  DESIGN_MODULES,
  DESIGN_MODULE_NAMES,
  bundleHistoryPath,
  circularImports,
  deltaPct,
  externalImports,
  largestContributorBytes,
  metaJsonPath,
  moduleBytesFromMetaJson,
  npmModulesInBundle,
  readBundleHistory,
} from '../src/lib/design-budget.ts';

const ROOT = join(import.meta.dir, '..');

const md = (s: string): string => s + '\n';

export async function buildBudgetReport(root: string): Promise<string> {
  const history = await readBundleHistory(bundleHistoryPath(root));
  const lines: string[] = ['📦 **Design Budget Check**', ''];
  let allOk = true;
  for (const module of DESIGN_MODULE_NAMES) {
    const spec = DESIGN_MODULES[module];
    const jsonText = await Bun.file(metaJsonPath(module, root)).text().catch(() => '');
    let meta: unknown = null;
    if (jsonText) {
      try { meta = JSON.parse(jsonText); } catch { meta = null; }
    }
    if (!meta) {
      lines.push('- ' + module + ': metafile missing — run `bun run design:build`');
      allOk = false;
      continue;
    }
    const bytes = moduleBytesFromMetaJson(module, meta);
    const largest = largestContributorBytes(module, meta);
    const prev = history[module]?.at(-1)?.bytes ?? null;
    const growth = deltaPct(prev, bytes ?? 0);
    const over = (bytes ?? Infinity) > spec.maxBytes;
    const largestOver = (largest ?? Infinity) > spec.maxContributorBytes;
    if (over || largestOver) allOk = false;
    const deltaTxt = growth === null ? 'new' : (growth >= 0 ? '+' : '') + growth.toFixed(1) + '%';
    lines.push(
      '- ' + module + ': ' + ((bytes ?? 0) / 1024).toFixed(2) + ' KB (budget ' + (spec.maxBytes / 1024).toFixed(0) + ' KB) ' +
        (over ? '❌' : '✅') +
        ' · largest ' + ((largest ?? 0) / 1024).toFixed(2) + ' KB (max ' + (spec.maxContributorBytes / 1024).toFixed(0) + ' KB)' +
        (largestOver ? ' ❌' : '') +
        ' · Δ ' + deltaTxt,
    );
  }
  lines.push('');
  // Largest module contributions (from the metafile inputs) — the "where
  // does the size live" view, machine-read from the same data as the gate.
  for (const module of DESIGN_MODULE_NAMES) {
    const jsonText = await Bun.file(metaJsonPath(module, ROOT)).text().catch(() => "");
    if (!jsonText) continue;
    try {
      const meta = JSON.parse(jsonText) as {
        outputs?: Record<string, { entryPoint?: string; inputs?: Record<string, { bytesInOutput?: number }> }>;
      };
      const out = Object.values(meta.outputs ?? {}).find((o) => o.entryPoint === DESIGN_MODULES[module].entry);
      const contribs = Object.entries(out?.inputs ?? {})
        .map(([p, v]) => ({ path: p, bytes: v.bytesInOutput ?? 0 }))
        .filter((c) => c.bytes > 0)
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, 3);
      if (contribs.length) {
        lines.push(
          '- ' + module + ' largest: ' +
            contribs.map((c) => c.path.split('/').slice(-1)[0] + ' ' + (c.bytes / 1024).toFixed(1) + ' KB').join(' · '),
        );
      }
    } catch {
      // unparsable metafile — skip
    }
  }
  const cyclesAll: string[][] = [];
  const externalsAll: Array<{ from: string; specifier: string }> = [];
  const npmAll: string[] = [];
  for (const module of DESIGN_MODULE_NAMES) {
    const jsonText = await Bun.file(metaJsonPath(module, ROOT)).text().catch(() => '');
    if (!jsonText) continue;
    try {
      const meta = JSON.parse(jsonText) as unknown;
      cyclesAll.push(...circularImports(meta));
      externalsAll.push(...externalImports(meta).filter((e) => !(module === 'design-system' && e.specifier === 'bun')));
      npmAll.push(...npmModulesInBundle(meta));
    } catch {
      // ignore unparsable metafile
    }
  }
  lines.push('- Cycles: ' + cyclesAll.length + ' | Unexpected externals: ' + externalsAll.length + ' | npm modules: ' + npmAll.length);
  lines.push('');
  lines.push(allOk && cyclesAll.length === 0 && externalsAll.length === 0 && npmAll.length === 0
    ? '✅ **design:check green**'
    : '⚠️ **design:check has findings — run `bun run design:check`**');
  return lines.join('\n') + '\n';
}

async function postPrComment(pr: string, body: string): Promise<boolean> {
  const token = Bun.env.GITHUB_TOKEN;
  const repo = Bun.env.GITHUB_REPOSITORY;
  if (!token || !repo) {
    console.error('design:report --pr requires GITHUB_TOKEN + GITHUB_REPOSITORY');
    return false;
  }
  const res = await fetch('https://api.github.com/repos/' + repo + '/issues/' + pr + '/comments', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + token,
      'content-type': 'application/json',
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) {
    console.error('design:report PR comment failed: ' + res.status + ' ' + (await res.text()).slice(0, 200));
    return false;
  }
  console.log('design:report PR comment posted to #' + pr);
  return true;
}

if (import.meta.main) {
  const body = await buildBudgetReport(ROOT);
  process.stdout.write(body);
  const { values: dbrv } = parseArgs({ args: Bun.argv.slice(2), options: { pr: { type: 'string' } }, strict: false, allowPositionals: true });
  const prArg = typeof dbrv.pr === 'string' ? dbrv.pr : undefined;
  if (prArg !== undefined) {
    const pr = prArg;
    process.exit((await postPrComment(pr, body)) ? 0 : 1);
  }
}
