#!/usr/bin/env bun
/**
 * Integrate Pandora widget-domain snapshot into domain registries.
 *
 *   bun run domain:widget-extract -- --write   # refresh snapshot first
 *   bun run domain:pandora -- --report
 *   bun run domain:pandora -- --promote --limit=50
 *   bun run domain:pandora -- --promote --apply --limit=20
 *   bun run domain:pandora -- --promote --sport=soccer --limit=30
 *   bun run domain:pandora -- --attach-pandora          # dry-run missing pandora ids
 *   bun run domain:pandora -- --attach-pandora --apply
 *   bun run domain:pandora -- --markets
 *   bun run domain:pandora -- --json --report
 *
 * Does **not** mass-insert 3898 leagues — junk filter + limit. Prefer dry-run.
 */
import { join } from 'node:path';
import {
  applyAttachPandoraMappings,
  applyPandoraPromoteToCompetitionsFile,
  buildPandoraCoverageReport,
  formatPandoraCoverageReport,
  formatPandoraPromotePlan,
  loadWidgetDomainSnapshot,
  planAttachPandoraMappings,
  planPandoraCompetitionPromote,
} from '../src/domain/pandora-domain-integrate.ts';
import { defaultWidgetDomainCachePath } from '../src/domain/widget-domain-extract.ts';

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function argValue(name: string): string | undefined {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

const json = hasFlag('json');
const attachPandora = hasFlag('attach-pandora');
const promote = hasFlag('promote');
const markets = hasFlag('markets');
const report =
  hasFlag('report') || (!promote && !markets && !attachPandora);
const apply = hasFlag('apply');
const limit = Math.min(Math.max(Number(argValue('limit') ?? '50') || 50, 1), 500);
const sport = argValue('sport');
const snapshotPath = argValue('snapshot') ?? defaultWidgetDomainCachePath();
const competitionsPath =
  argValue('competitions') ??
  join(import.meta.dir, '../src/domain/competitions.ts');

const snapshot = await loadWidgetDomainSnapshot(snapshotPath);

if (attachPandora) {
  const rows = planAttachPandoraMappings(snapshot);
  if (apply && rows.length > 0) {
    const { patched, missed } = await applyAttachPandoraMappings(
      rows,
      competitionsPath
    );
    if (json) {
      console.log(JSON.stringify({ attach: true, apply: true, patched, missed, planned: rows }, null, 2));
    } else {
      console.log(
        `attach-pandora --apply patched=${patched.length} missed=${missed.length}`
      );
      for (const id of patched) console.log(`  ~ ${id}`);
      for (const id of missed) console.log(`  ? ${id}`);
    }
  } else if (json) {
    console.log(JSON.stringify({ attach: true, apply: false, count: rows.length, rows }, null, 2));
  } else {
    console.log(`attach-pandora dry-run: ${rows.length} competitions missing pandora id`);
    for (const r of rows) {
      console.log(
        `  ${r.competitionId}  pandora=${r.pandoraLeagueId} feed=${r.feedSportId}  ${r.displayName}`
      );
    }
    if (rows.length) {
      console.log('  re-run with --apply to patch competitions.ts');
    }
  }
}

if (report || (!promote && !markets && !attachPandora)) {
  const r = buildPandoraCoverageReport(snapshot);
  if (json) console.log(JSON.stringify(r, null, 2));
  else console.log(formatPandoraCoverageReport(r));
}

if (markets) {
  const r = buildPandoraCoverageReport(snapshot);
  const payload = {
    htmlMarketLabels: r.markets.htmlMarketLabels,
    wagerTypes: r.markets.wagerTypes,
    knownMarketTypeIds: r.markets.knownMarketTypeIds,
    interestingHtmlKeys: r.markets.interestingHtmlKeys,
    wagerSampleUnmapped: r.markets.wagerSampleUnmapped,
  };
  if (json) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log(
      `markets: MARKET_*=${payload.htmlMarketLabels} wagerTypes=${payload.wagerTypes}`
    );
    console.log(`known ids: ${payload.knownMarketTypeIds.join(', ')}`);
    console.log('interesting HTML keys:');
    for (const k of payload.interestingHtmlKeys.slice(0, 30)) console.log(`  ${k}`);
    console.log('sample unmapped-ish wager types:');
    for (const w of payload.wagerSampleUnmapped.slice(0, 25)) {
      console.log(`  ${w.id}\t${w.shortName ?? ''}\t${w.name}`);
    }
  }
}

if (promote) {
  const result = planPandoraCompetitionPromote(snapshot, {
    limit,
    sportId: sport,
  });
  if (apply) {
    const { added, skipped } = await applyPandoraPromoteToCompetitionsFile(
      result.records,
      competitionsPath
    );
    if (json) {
      console.log(
        JSON.stringify(
          {
            promote: true,
            apply: true,
            limit,
            sport: sport ?? null,
            added,
            skipped,
            rejected: result.plan.rejected.length,
            considered: result.considered,
          },
          null,
          2
        )
      );
    } else {
      console.log(
        `pandora-promote --apply limit=${limit} added=${added.length} skipped=${skipped.length} ` +
          `considered=${result.considered} rejected=${result.plan.rejected.length}`
      );
      for (const id of added.slice(0, 40)) console.log(`  +C ${id}`);
      if (added.length > 0) {
        console.log(
          '  note: inventory stamping still uses stream-list league keys; re-run inventory:leagues --backfill if needed'
        );
      }
    }
  } else if (json) {
    console.log(
      JSON.stringify(
        {
          promote: true,
          apply: false,
          limit,
          sport: sport ?? null,
          considered: result.considered,
          toInsert: result.records,
          rejectedSample: result.plan.rejected.slice(0, 30),
          rejectedCount: result.plan.rejected.length,
        },
        null,
        2
      )
    );
  } else {
    console.log(formatPandoraPromotePlan(result));
    console.log('  (dry-run — pass --apply to write competitions.ts)');
  }
}
