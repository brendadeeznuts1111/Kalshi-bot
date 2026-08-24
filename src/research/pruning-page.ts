/**
 * pruning-page.ts — /bun/pruning: Content Pruning widget (archive vs delete).
 * The decision-matrix doc, probe-corrected (§25): Bun.rename does not exist
 * (renameSync), ensureDirectory is not an API (mkdirSync recursive).
 */
import { renderWidgetPage, widgetTable, W_VERIFIED, W_CORRECTED } from '../lib/widget-page.ts';

export function renderPruningPage(): string {
  const matrix = widgetTable(['Condition', 'Action', 'Codified'], [
    { cells: ['Unreferenced + duplicate or stale', 'delete', W_VERIFIED + ' planPrune: dup hash group or mtime older than staleDays'] },
    { cells: ['Unreferenced + historically significant', 'archive', W_VERIFIED + ' historicallySignificant opt or size > largeBytes'] },
    { cells: ['Referenced + large', 'review', W_VERIFIED + ' size > largeBytes while referenced — report only'] },
    { cells: ['Referenced', 'keep', W_VERIFIED + ' manifest membership'] },
    { cells: ['Generated / rebuildable', 'delete', W_VERIFIED + ' same duplicate/stale path (regenerable = safe)'] },
  ]);
  const impl = widgetTable(['Step', 'Probe'], [
    { cells: ['Move to .trash/<date>/<dir>/', W_CORRECTED + ' renameSync — Bun.rename does NOT exist (probe: undefined)'] },
    { cells: ['Create dest dirs', W_CORRECTED + ' mkdirSync(path, { recursive: true }) — ensureDirectory is not an API'] },
    { cells: ['Metadata sidecar', W_VERIFIED + ' <name>.meta.json {originalPath, archivedAt, reason, size, hash, action, performedBy} — roundtrip verified'] },
    { cells: ['Content hash in sidecar', W_VERIFIED + ' hashContent (CryptoHasher sha256, §24) of the raw bytes'] },
    { cells: ['Changelog append', W_VERIFIED + ' CONTENT_CHANGELOG.md entry with counts + paths + report ref'] },
  ]);
  return renderWidgetPage({
    title: 'Content Pruning',
    subtitle: 'Archive vs delete decision matrix + .trash/ sidecars + changelog — zero deps',
    badges: ['decision matrix', '.trash/', 'sidecars', 'changelog'],
    links: ['/content/posts', '/bun/hashing', '/bun/overview'],
    sections: [
      { heading: 'Decision matrix (codified)', html: matrix },
      { heading: 'Implementation (probe table)', html: impl },
      { heading: 'Workflow', html: '<ol><li><code>bun run content:prune</code> — dry-run report (delete/archive/review/keep)</li><li>Review the "review" rows by hand</li><li><code>bun run content:prune -- --apply</code> — moves to .trash/ with sidecars + changelog</li><li><code>bun run content:prune -- --archive</code> — ALSO bundle removals into one .tar.gz via Bun.Archive (probe-verified §26)</li><li>Commit manifest + CONTENT_CHANGELOG.md; .trash/ stays gitignored</li></ol>' },
      { heading: 'Channels + dynamic updates', html: '<ul><li><code>prune</code> channel on /dashboard: manifest integrity + .trash/ footprint (8th channel)</li><li><code>bun run content:verify</code> — hash-drift check vs .data/content-state.json (exit 1 on drift; --update re-baselines)</li><li><code>bun run content:watch</code> — <code>bun --watch</code> re-verify on content change (dynamic rebuild; CLI flag only — there is no watch API on the runtime)</li><li>Archive values probe catch: Bun.Archive.write needs string/Uint8Array/Blob values — Bun.file values write empty payloads (§26)</li><li><code>bun run content:prune -- --restore=&lt;path&gt;</code> — recover from .trash via sidecar (§27)</li></ul>' },
      { heading: 'Deepen pass (§27)', html: '<ul><li>Posts render via <code>Bun.markdown.html</code> (real HTML — <code>render</code> is plain text, probe-verified)</li><li><code>bun run ffi:probe</code> — native calls (getpid, zlibVersion) with zero spawn; <code>Bun.ffi</code> namespace missing, module is <code>bun:ffi</code></li></ul>' },
    ],
    footer: 'Probes: docs/AGENT-PITFALLS.md §25 · source: src/lib/prune-content.ts · CLI: tools/prune-content-cli.ts',
  });
}
