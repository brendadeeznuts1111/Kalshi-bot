/**
 * tooling-page.ts — /bun/tooling: Install & Test tooling widget, token-built.
 * Every claim probed against this repo's actual toolchain (isolated linker,
 * pm diff, prune, audit fix dry-run, dedupe, shard, retry, fake timers).
 */
import { renderWidgetPage, widgetTable, W_VERIFIED, W_NOTE } from '../lib/widget-page.ts';

export function renderToolingPage(): string {
  const install = widgetTable(['Feature', 'Probe'], [
    { cells: ['<code>linker = "isolated"</code> (global virtual store)', W_VERIFIED + ' adopted in bunfig; install passes, .bun/ store created'] },
    { cells: ['<code>--frozen-lockfile</code>', W_VERIFIED + ' enforced in bunfig + CI workflow'] },
    { cells: ['lockfile SHA-512 for git/tarball deps', W_NOTE + ' picked up on next install (no git deps here)'] },
  ]);
  const deps = widgetTable(['Tool', 'Probe'], [
    { cells: ['<code>bun pm diff</code>', W_VERIFIED + ' deps:diff — zod/drizzle-orm no differences; file: specs skipped'] },
    { cells: ['<code>bun audit fix --dry-run</code>', W_VERIFIED + ' deps:audit-fix:dry — no vulnerabilities (real fix needs frozenLockfile off)'] },
    { cells: ['<code>bun dedupe --check</code>', W_VERIFIED + ' green under the isolated linker — no duplicates'] },
    { cells: ['<code>bun prune --production</code>', W_VERIFIED + ' deps:prune:prod — dry-run: nothing to prune'] },
    { cells: ['<code>bun update</code> transitive', W_NOTE + ' updates transitive deps too (not run here)'] },
  ]);
  const test = widgetTable(['Flag', 'Probe'], [
    { cells: ['<code>--parallel --timings</code>', W_VERIFIED + ' the repo test script (timings file drives balance)'] },
    { cells: ['<code>--changed=HEAD</code>', W_VERIFIED + ' pre-commit runs changed tests with full fallback'] },
    { cells: ['<code>--retry 1</code>', W_VERIFIED + ' pre-commit defuses the known rotate-key flake'] },
    { cells: ['<code>--shard=M/N</code>', W_VERIFIED + ' test:shard (TEST_SHARD env) for CI matrices'] },
    { cells: ['<code>--isolate</code>', W_NOTE + ' --parallel implies it; fresh globals per file'] },
    { cells: ['<code>jest.useFakeTimers()</code>', W_NOTE + ' available (not yet used in-repo)'] },
  ]);
  return renderWidgetPage({
    title: 'Install & Test Tooling',
    subtitle: 'Global virtual store, package diffing, dedupe, prune, audit-fix, and the test-parallelism flags — probed against this repo toolchain',
    badges: ['v1.4.0', 'Global store', '7x CI installs', 'Test parallelism'],
    links: ['/bun/overview', '/bun/utilities', '/bun/observability'],
    sections: [
      { heading: 'Install (global virtual store)', html: install },
      { heading: 'Dependency tooling', html: deps },
      { heading: 'Test tooling', html: test },
      { heading: 'Folded into this repo', html: '<ul><li>bunfig [install] linker=isolated</li><li>deps:diff / deps:prune(:prod) / deps:audit-fix:dry / deps:check scripts</li><li>test:shard for CI matrices</li><li>/api/deps/health exposes the offline gates</li></ul>' },
    ],
    footer: 'Probes: docs/AGENT-PITFALLS.md §20.',
  });
}
