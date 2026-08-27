#!/usr/bin/env bun
/**
 * `bun run sitemap:gen` — generate public/sitemap.xml + public/robots.txt
 * from the SAME-SITE routes served by src/research/serve.ts (bookmaker
 * profiles' `url` are EXTERNAL sites — excluded; the Odds Heat report is
 * the one odds page). Serialized with Bun.XML.stringify (grounded §192:
 * @attr compact shape) — byte-stable output.
 */
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

const ROOT = join(import.meta.dir, '..');
const BASE = process.env.ODDS_HEAT_BASE_URL ?? 'https://oddsheat.local';

/** Same-site pages served by the report browser (widget pages, hq, odds). */
const SITEMAP_PATHS = [
  '/',
  '/ops',
  '/api/hq',
  '/api/glossary',
  '/api/design',
  '/reports/latest.md',
  '/api/odds-report',
  '/design',
  '/bun/overview',
  '/bun/networking',
  '/bun/streams',
  '/bun/performance',
  '/bun/observability',
  '/registry/odds-reference.xml',
];

const urls = SITEMAP_PATHS.map((p) => ({ loc: BASE + p }));
const xml =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  (Bun as any).XML.stringify({
    urlset: {
      '@xmlns': 'http://www.sitemaps.org/schemas/sitemap/0.9',
      url: urls,
    },
  }) +
  '\n';

const robots = 'User-agent: *\nAllow: /\nSitemap: ' + BASE + '/sitemap.xml\n';

mkdirSync(join(ROOT, 'public'), { recursive: true });
await Bun.write(join(ROOT, 'public', 'sitemap.xml'), xml);
await Bun.write(join(ROOT, 'public', 'robots.txt'), robots);
console.log('sitemap:gen — wrote public/sitemap.xml (' + urls.length + ' locs) + public/robots.txt');
