#!/usr/bin/env bun
/**
 * Discover likely SkinId / adapter for any host (suggest only).
 *
 *   bun run domain:host-discover -- --url=https://BOOK.example
 *   bun run domain:host-discover -- --url=https://BOOK.example --weigh --json
 *   bun run domain:host-discover -- --url=https://BOOK.example --har=./session.har
 *   bun run domain:host-discover -- --all
 *   bun run domain:host-discover -- --url=https://BOOK.example --compare
 *
 *
 * `--all` / `--compare` walk every apex host in SKINS[].hosts (plus optional --url target).
 * `--weigh` prints capped-category evidence breakdown (report.weigh / report.decision).
 * Stores URL inventory under docs/artifacts/host-discover/<host>-urls.json
 * Never writes HOST_TO_SKIN — human confirms before mapping.
 */
import {
  discoverHost,
  formatHostDiscoverText,
  listMappedDiscoverHosts,
  type HostDiscoverReport,
} from '../src/domain/host-discover.ts';

function argValue(name: string): string | undefined {
  const pref = `${name}=`;
  const hit = process.argv.find(a => a.startsWith(pref));
  if (hit) return hit.slice(pref.length).trim();
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1] && !process.argv[idx + 1]!.startsWith('-')) {
    return process.argv[idx + 1]!.trim();
  }
  return undefined;
}

const json = process.argv.includes('--json');
const compare = process.argv.includes('--compare');
const all = process.argv.includes('--all');
const weigh = process.argv.includes('--weigh');
const skipExtras = process.argv.includes('--skip-extras');
const noPersist = process.argv.includes('--no-persist');
const harPath = argValue('--har');
const url =
  argValue('--url') ||
  argValue('--host') ||
  process.argv.find(
    a =>
      !a.startsWith('-') &&
      a !== process.argv[0] &&
      a !== process.argv[1] &&
      a.includes('.') &&
      !a.endsWith('.har')
  );

const multi = all || compare;

if (!url && !multi) {
  console.error(`Usage:
  bun run domain:host-discover -- --url=https://BOOK.example
  bun run domain:host-discover -- --url=https://BOOK.example --json
  bun run domain:host-discover -- --url=https://BOOK.example --weigh --json
  bun run domain:host-discover -- --url=https://BOOK.example --har=./session.har
  bun run domain:host-discover -- --all
  bun run domain:host-discover -- --all --json
  bun run domain:host-discover -- --url=https://BOOK.example --compare
  bun run domain:host-discover -- --url=https://BOOK.example --skip-extras --no-persist
`);
  process.exit(2);
}

const opts = {
  skipNetworkExtras: skipExtras,
  persistUrls: !noPersist,
  // HAR applies only to a single explicit target (not bulk mapped hosts).
  harPath: !multi && harPath ? harPath : undefined,
};

async function runOne(target: string): Promise<HostDiscoverReport> {
  return discoverHost(target, opts);
}

/** When --weigh is off, drop weigh from JSON to keep payloads smaller. */
function jsonPayload(report: HostDiscoverReport): unknown {
  if (weigh) return report;
  const { weigh: _w, ...rest } = report;
  return rest;
}

if (multi) {
  if (harPath) {
    console.error('--har is only supported with a single --url (not --all/--compare)');
    process.exit(2);
  }
  const mapped = listMappedDiscoverHosts();
  const targets = [
    ...(url ? [{ url, label: 'target' as const }] : []),
    ...mapped.map(b => ({ url: b.url, label: b.label })),
  ];
  if (targets.length === 0) {
    console.error('No mapped hosts in SKINS[].hosts — pass --url=https://BOOK.example');
    process.exit(2);
  }
  const reports: Array<{ label: string; report: unknown }> = [];
  for (const t of targets) {
    const report = await runOne(t.url);
    reports.push({ label: t.label, report: jsonPayload(report) });
  }
  if (json) {
    console.log(
      JSON.stringify(
        {
          mode: all ? 'all' : 'compare',
          mappedHostCount: mapped.length,
          weigh,
          compare: reports,
        },
        null,
        2
      )
    );
  } else {
    console.log(
      `host-discover  ${all ? '--all' : '--compare'}  (${mapped.length} mapped apex hosts` +
        (url ? ' + target' : '') +
        ')'
    );
    for (const row of reports) {
      const report = row.report as HostDiscoverReport;
      console.log(`\n=== ${row.label} ===`);
      console.log(formatHostDiscoverText(report, { weigh }));
      console.log(
        `# Output: skin ${report.suggestedSkinId}, stored ${report.storedUrls.length} URLs` +
          (report.confidence >= 0.5
            ? `, confidence ${report.confidence}`
            : ', no high‑confidence matches.')
      );
    }
  }
  process.exit(0);
}

const report = await runOne(url!);
if (json) {
  console.log(JSON.stringify(jsonPayload(report), null, 2));
} else {
  console.log(formatHostDiscoverText(report, { weigh }));
  console.log(
    `\n# Output: skin ${report.suggestedSkinId}, stored ${report.storedUrls.length} URLs` +
      (report.confidence >= 0.5
        ? `, confidence ${report.confidence}`
        : ', no high‑confidence matches.')
  );
}
