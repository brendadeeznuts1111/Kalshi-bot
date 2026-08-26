#!/usr/bin/env bun
/**
 * Extract sports / markets / leagues / wagerTypes from plive shell + Pandora.
 *
 *   bun run domain:widget-extract
 *   bun run domain:widget-extract -- --json
 *   bun run domain:widget-extract -- --html-only
 *   bun run domain:widget-extract -- --pandora-only --seconds=15
 *   bun run domain:widget-extract -- --from=path/to/shell.html
 *   bun run domain:widget-extract -- --write
 *   bun run domain:widget-extract -- --write --out=research/cache/widget-domain-snapshot.json
 *
 * Does not commit secrets. Pandora anonymous subscribe is enough for domain rooms.
 */
import { argValue, hasFlag } from '../src/cli/argv.ts';
import {
  defaultWidgetDomainCachePath,
  formatWidgetDomainSnapshot,
  writeWidgetDomainSnapshot,
} from '../src/domain/widget-domain-extract.ts';
import { extractWidgetDomainWithPandora } from '../src/partner/fantasy-ultra/widget-domain-capture.ts';



const json = hasFlag('json');
const htmlOnly = hasFlag('html-only');
const pandoraOnly = hasFlag('pandora-only');
const write = hasFlag('write');
const seconds = Math.min(
  Math.max(Number(argValue('seconds') ?? '12') || 12, 3),
  60
);
const lang = argValue('lang') ?? 'en';
const from = argValue('from');
const out = argValue('out') ?? defaultWidgetDomainCachePath();

let html: string | undefined;
if (from) {
  html = await Bun.file(from).text();
}

const snap = await extractWidgetDomainWithPandora({
  ...(html !== undefined ? { html } : {}),
  fetchShell: !pandoraOnly && !html,
  languageKey: lang,
  pandora: !htmlOnly,
  pandoraSeconds: seconds,
});

if (write) {
  const path = await writeWidgetDomainSnapshot(snap, out);
  console.error(`wrote ${path}`);
}

if (json) {
  console.log(JSON.stringify(snap, null, 2));
} else {
  console.log(formatWidgetDomainSnapshot(snap));
}

const ok =
  (snap.markets.length > 0 || snap.liveSports.length > 0) &&
  (htmlOnly ? snap.markets.length > 0 : true);
process.exit(ok ? 0 : 1);
