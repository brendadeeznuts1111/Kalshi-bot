/**
 * `bun run bun:claims-audit -- <claim> [claim...]` — check claims against
 * the Bun release blog (docs/AGENT-PITFALLS.md sections 13/15: pasted
 * summaries mix verified facts with invented numbers; grep the blog).
 *
 * Each argument is searched (case-insensitive, word-bounded) in the blog
 * HTML (fetched fresh or from the last run's cache). Reports FOUND / NOT
 * FOUND per claim; exits 1 if any claim is absent (likely fabricated).
 *
 * Example:
 *   bun run bun:claims-audit -- '535,496 lines' '64 Claude agents'
 *     -> NOT FOUND: 535,496 lines | NOT FOUND: 64 Claude agents
 *
 * Flags:
 *   --blog=<url>   blog URL to audit (default https://bun.com/blog/bun-v1.4)
 *   --all          also match substrings (default: word-boundary match)
 *
 * @see docs/AGENT-PITFALLS.md (verify, then act)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { assertBunAtLeast } from '../src/research/bun-native.ts';
import { auditClaims, htmlToText } from '../src/lib/claims-audit.ts';

assertBunAtLeast('1.4.0', 'bun:claims-audit');

const ROOT = join(import.meta.dir, '..');
const BLOG_CACHE = join(ROOT, 'research/cache/bun-blog.html');

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      blog: { type: 'string' },
      all: { type: 'boolean' },
    },
    strict: false,
    allowPositionals: true,
  });
  const url = typeof values.blog === 'string' ? values.blog : 'https://bun.com/blog/bun-v1.4';
  const all = values.all === true;
  // positionals = claims after `--` (parseArgs treats `--` as the separator;
  // Bun.argv.slice(2) drops the script path so claims never leak into the list).
  const claims = positionals;
  if (!claims.length) {
    console.error('usage: bun run bun:claims-audit -- <claim> [claim...]');
    console.error('  --blog=<url>  blog URL (default bun-v1.4 post)');
    console.error('  --all         substring match (default word-boundary)');
    return 2;
  }
  mkdirSync(join(ROOT, 'research/cache'), { recursive: true });
  let html = existsSync(BLOG_CACHE) ? readFileSync(BLOG_CACHE, 'utf8') : '';
  if (!html) {
    const res = await fetch(url);
    if (!res.ok) {
      console.error('blog fetch failed: ' + res.status + ' ' + url);
      return 2;
    }
    html = await res.text();
    writeFileSync(BLOG_CACHE, html);
    console.log('  fetched ' + url + ' -> ' + BLOG_CACHE);
  } else {
    console.log('  using cached blog: ' + BLOG_CACHE);
  }
  // Match against the STRIPPED text (visible words), not raw HTML -
  // otherwise claims spanning <code> tags (e.g. 'files stream with
  // sendfile') never match even though the sentence is present.
  const { verdicts, absent } = auditClaims(claims, htmlToText(html), { all });
  for (const v of verdicts) {
    console.log('  ' + (v.found ? 'FOUND   ' : 'NOT FOUND') + ': ' + v.claim);
  }
  console.log('claims-audit: ' + (claims.length - absent) + '/' + claims.length + ' present in ' + url + (absent ? ' - ' + absent + ' ABSENT (likely fabricated)' : ''));
  return absent ? 1 : 0;
}

process.exit(await main());