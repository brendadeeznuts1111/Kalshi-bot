#!/usr/bin/env bun
/**
 * `bun run bun:release-watch` — Bun release-blog integration.
 *
 * RSS -> latest release -> blog HTML -> code-block API identifiers,
 * probed against the INSTALLED runtime (typeof), producing a
 * verified/absent table so new releases get their API surface extracted
 * and vetted automatically (the manual discipline automated). Writes
 * research/outputs/bun-release-<version>.md and advances
 * research/cache/bun-release-state.json.
 *
 * Flags:
 *   --check   report the latest release without writing state/report.
 *   --force   re-analyze the current release even if already seen.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { assertBunAtLeast } from '../src/research/bun-native.ts';
import { argValue, hasFlag } from '../src/cli/argv.ts';
import {
  extractCodeBlocks,
  identifiersFromCodeBlocks,
  latestRelease,
  parseAtomEntries,
  parseRssEntries,
} from '../src/lib/release-blog.ts';

assertBunAtLeast('1.4.0', 'bun:release-watch');

const ROOT = join(import.meta.dir, '..');
const STATE_PATH = join(ROOT, 'research/cache/bun-release-state.json');
const OUT_DIR = join(ROOT, 'research/outputs');
// Shared with bun:claims-audit: every release-watch run refreshes the
// blog cache the claims audit greps, so pasted-claim verification can
// run offline against the newest release.
const BLOG_CACHE = join(ROOT, 'research/cache/bun-blog.html');

type ReleaseState = { version: string; title: string; checkedAt: string };

function readState(): ReleaseState | null {
  if (!existsSync(STATE_PATH)) return null;
  try { return JSON.parse(readFileSync(STATE_PATH, 'utf8')) as ReleaseState; }
  catch { return null; }
}

async function main(): Promise<void> {
  const check = hasFlag('check');
  const force = hasFlag('force');
  const rss = await (await fetch('https://bun.sh/rss.xml')).text();
  const release = latestRelease(parseRssEntries(rss));
  if (!release) {
    console.error('no versioned release found in RSS');
    process.exit(1);
  }
  console.log('latest:', release.title, '(' + release.pubDate + ')');

  // Cross-check against the authoritative GitHub releases Atom feed (the
  // second verified Bun.XML shape — feed.entry with '@'-attrs). A mismatch
  // here means the blog RSS lags GitHub.
  let githubCross: string | null = null;
  try {
    const atom = await (await fetch('https://github.com/oven-sh/bun/releases.atom')).text();
    const gh = latestRelease(parseAtomEntries(atom));
    if (gh) {
      const match = gh.version === release.version;
      githubCross = (match ? 'match' : 'MISMATCH') + ': github ' + gh.title + ' (' + gh.link + ')';
      console.log('github atom cross-check:', githubCross);
      if (!match) console.error('note: RSS and GitHub releases disagree — GitHub is authoritative');
    }
  } catch (e) {
    githubCross = 'unavailable: ' + String(e).slice(0, 60);
    console.error('github atom cross-check unavailable:', String(e).slice(0, 80));
  }

  const state = readState();
  if (!force && state?.version === release.version) {
    console.log('already analyzed — use --force to re-run');
    process.exit(0);
  }
  if (check) {
    console.log('check: new release ' + release.version + ' (state was ' + (state?.version ?? 'none') + ')');
    process.exit(0);
  }

  const html = await (await fetch(release.link)).text();
  mkdirSync(join(ROOT, 'research/cache'), { recursive: true });
  writeFileSync(BLOG_CACHE, html); // keeps bun:claims-audit fresh offline
  const blocks = extractCodeBlocks(html);
  const ids = [...identifiersFromCodeBlocks(blocks)].sort();

  // Probe in-process (this CLI runs under bun): typeof for each top-level Bun.* id.
  const bun = Bun as unknown as Record<string, unknown>;
  const rows = ids.map((id) => ({
    id,
    typeof: typeof bun[id],
    present: typeof bun[id] !== 'undefined',
  }));
  const present = rows.filter((r) => r.present).length;
  const absent = rows.length - present;

  mkdirSync(OUT_DIR, { recursive: true });
  const md = [
    '# Bun release: ' + release.title,
    '',
    'Published ' + release.pubDate + ' · probed on Bun ' + Bun.version + '.',
    '',
    'Code blocks: ' + blocks.length + ' · top-level Bun.* identifiers: ' + ids.length + ' (' + present + ' present / ' + absent + ' absent)',
    '',
    '| API | typeof | Present |',
    '|---|---|---|',
    ...rows.map((r) => '| ' + r.id + ' | ' + r.typeof + ' | ' + (r.present ? 'yes' : 'no') + ' |'),
    '',
  ].join('\n');
  const outPath = join(OUT_DIR, 'bun-release-' + release.version + '.md');
  writeFileSync(outPath, md + '\n');
  writeFileSync(
    STATE_PATH,
    JSON.stringify({ version: release.version, title: release.title, checkedAt: new Date().toISOString() }, null, 2) + '\n',
  );
  console.log('wrote ' + outPath + ' · ' + present + ' present / ' + absent + ' absent');
  // NOTE: BroadcastChannel is same-process only (workers yes, separate
  // processes NO) - the worker-based cron job (release-watch-worker.ts)
  // handles in-process fan-out. This standalone CLI just writes the report.
  process.exit(absent > 0 ? 1 : 0);
}

await main();
