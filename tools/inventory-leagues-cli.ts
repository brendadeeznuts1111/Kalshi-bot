#!/usr/bin/env bun
/**
 * Durable inventory league registry (book + bucket + league label).
 *
 *   bun run inventory:leagues
 *   bun run inventory:leagues -- --json
 *   bun run inventory:leagues -- --unmapped
 *   bun run inventory:leagues -- --sport=table_tennis --limit=50
 *   bun run inventory:leagues -- --order=peak
 *   bun run inventory:leagues -- --no-meta          # omit cc=/kind= columns
 *   bun run inventory:leagues -- --harvest --sport=all [--dry-run]
 *   bun run inventory:leagues -- --promote [--apply] [--min-peak=1] [--json]
 *   bun run inventory:leagues -- --report [--min-peak=1] [--json] [--notify]
 *   bun run inventory:leagues -- --backfill
 *
 * --promote: plan COMPETITIONS seeds from unmapped inventory_leagues (junk filtered).
 * --report:  same plan as promote dry-run (cron-shared buildPromoteReport).
 * --notify:  with --report, force Telegram once (TELEGRAM_* required; dedup state updated).
 * --apply:   write candidates into src/domain/competitions.ts + stamp registry rows.
 * --backfill: re-resolve competition_id on inventory_leagues from current seeds.
 * Lines/JSON include countryCode + kind (from competition meta / label inference).
 */
import { argValue, hasFlag } from '../src/cli/argv.ts';
// @see https://bun.com/docs/runtime/sqlite
import { join } from 'node:path';
import { openEventStore } from '../src/institutions/event-store/open-db.ts';
import { DEFAULT_EVENT_STORE_DB } from '../src/institutions/event-store/paths.ts';
import {
  applyCompetitionRecordsToSource,
  formatCompetitionRecordSource,
  planCompetitionPromote,
  requireDefaultUrlForUltraMapper,
  resolveCompetitionMeta,
} from '../src/domain/index.ts';
import {
  countInventoryLeagues,
  formatLeagueLine,
  listInventoryLeagues,
  resolveInventoryLeagueMeta,
  stampInventoryLeaguesCompetitionIds,
  stampInventoryLeaguesFromRecords,
  withInventoryLeagueMeta,
  type InventoryLeagueRow,
} from '../src/inventory/leagues.ts';
import { maybeNotifyPromoteReport } from '../src/inventory/promote-notify.ts';
import { buildPromoteReport } from '../src/inventory/promote-report.ts';
import { stampSkinEventsCompetitionIds } from '../src/inventory/skin-events-store.ts';
import { runInventorySync } from '../src/inventory/sync.ts';
import type { PartnerAccountProfile } from '../src/partner/account-profile.ts';
import {
  getFantasySessionAdapter,
  loadFantasy402ProfileFromEnv,
  requireFantasy402ProfileFromEnv,
} from '../src/partner/index.ts';



/** Public stream-list works without real Fantasy login (same as inventory:sync / cron). */
function resolveProfile(_dryRun: boolean): PartnerAccountProfile {
  const fromEnv = loadFantasy402ProfileFromEnv();
  if (fromEnv) return fromEnv;
  if (Bun.env.INVENTORY_SYNC_PUBLIC === '1' || Bun.env.PARTNER_SYNC_PUBLIC === '1') {
    return {
      id: 'fantasy402-public',
      partner: 'fantasy402',
      url: requireDefaultUrlForUltraMapper(),
      status: 'active',
      defaultLiveProduct: 2,
      meta: {
        customerID: 'public',
        agentID: 'public',
        password: 'public',
        token: 'public',
        currency: 'USD',
      },
    };
  }
  return requireFantasy402ProfileFromEnv();
}

function rowJson(r: InventoryLeagueRow, options: { meta?: boolean } = {}) {
  const base = {
    bookId: r.bookId,
    inventoryBucket: r.inventoryBucket,
    sportId: r.sportId,
    leagueKey: r.leagueKey,
    competitionId: r.competitionId,
    eventCountLive: r.eventCountLive,
    peakEventCount: r.peakEventCount,
    firstSeen: new Date(r.firstSeen).toISOString(),
    lastSeen: new Date(r.lastSeen).toISOString(),
    sampleHome: r.sampleHome,
    sampleAway: r.sampleAway,
  };
  if (options.meta === false) return base;
  const meta = resolveInventoryLeagueMeta(r);
  return {
    ...base,
    countryCode: meta.countryCode,
    kind: meta.kind,
    metaInferred: meta.inferred,
  };
}

const COMPETITIONS_TS = join(import.meta.dir, '../src/domain/competitions.ts');

async function main(): Promise<void> {
  const json = hasFlag('json');
  const unmapped = hasFlag('unmapped');
  const harvest = hasFlag('harvest');
  const promote = hasFlag('promote');
  const reportOnly = hasFlag('report');
  const notify = hasFlag('notify');
  const apply = hasFlag('apply');
  const backfill = hasFlag('backfill');
  const dryRun = hasFlag('dry-run') || hasFlag('dryRun');
  const showMeta = !hasFlag('no-meta');
  const sportFilter = argValue('sport');
  const limit = Number(argValue('limit') ?? '100') || 100;
  const orderBy = argValue('order') === 'peak' ? 'peak' : 'last_seen';
  const minPeak = Number(argValue('min-peak') ?? '1') || 1;

  const db = openEventStore({ dbPath: DEFAULT_EVENT_STORE_DB });

  if (reportOnly) {
    const promo = buildPromoteReport(db, {
      minPeak,
      sportId: sportFilter && sportFilter !== 'all' ? sportFilter : undefined,
    });
    let notifyResult: Awaited<ReturnType<typeof maybeNotifyPromoteReport>> | null =
      null;
    if (notify) {
      notifyResult = await maybeNotifyPromoteReport(promo, {
        force: true,
        enabled: true,
      });
    }
    if (json) {
      console.log(
        JSON.stringify(
          {
            report: true,
            minPeak: promo.minPeak,
            unmappedInput: promo.unmappedInput,
            candidates: promo.plan.candidates.map(c => {
              const m = resolveCompetitionMeta(c.record);
              return {
                id: c.record.id,
                leagueKey: c.source.leagueKey,
                peak: c.source.peakEventCount,
                bucket: c.record.providerMappings.plive?.inventoryBucket,
                countryCode: m.countryCode ?? c.record.countryCode ?? null,
                kind: m.kind,
              };
            }),
            rejected: promo.plan.rejected.map(r => ({
              leagueKey: r.source.leagueKey,
              reason: r.reason,
            })),
            summaryLine: promo.summaryLine,
            notify: notifyResult
              ? {
                  telegram: notifyResult.telegram,
                  reason: notifyResult.plan.reason,
                  newIds: notifyResult.plan.newIds,
                }
              : null,
          },
          null,
          2
        )
      );
      return;
    }
    console.log(`inventory:leagues --report ${promo.summaryLine}`);
    for (const line of promo.detailLines) {
      console.log(line);
    }
    if (notifyResult) {
      console.log(
        `  notify: ${notifyResult.telegram} (${notifyResult.plan.reason})`
      );
    }
    return;
  }

  if (backfill) {
    const leaguesN = stampInventoryLeaguesCompetitionIds(db);
    const eventsN = stampSkinEventsCompetitionIds(db);
    if (json) {
      console.log(JSON.stringify({ backfill: true, leaguesUpdated: leaguesN, skinEventsUpdated: eventsN }, null, 2));
    } else {
      console.log(
        `inventory:leagues --backfill leagues=${leaguesN} skin_events=${eventsN}`
      );
    }
    return;
  }

  if (promote) {
    // Prefer durable registry; if empty, harvest first (public dry path when possible)
    let rows = listInventoryLeagues(db, {
      unmappedOnly: true,
      sportId: sportFilter && sportFilter !== 'all' ? sportFilter : undefined,
      limit: 5000,
      orderBy: 'peak',
    });
    if (rows.length === 0) {
      const profile = resolveProfile(true);
      const adapter = getFantasySessionAdapter(profile, { warmSession: false });
      try {
        await adapter.login();
      } catch {
        /* public */
      }
      await runInventorySync(db, adapter, {
        sport: sportFilter ?? 'all',
        dryRun: false, // need league rows for promote plan
      });
      rows = listInventoryLeagues(db, {
        unmappedOnly: true,
        sportId: sportFilter && sportFilter !== 'all' ? sportFilter : undefined,
        limit: 5000,
        orderBy: 'peak',
      });
    }

    const plan = planCompetitionPromote(
      rows.map(r => ({
        sportId: r.sportId,
        leagueKey: r.leagueKey,
        inventoryBucket: r.inventoryBucket,
        peakEventCount: r.peakEventCount,
        eventCountLive: r.eventCountLive,
      })),
      { minPeak }
    );

    if (apply) {
      const prev = await Bun.file(COMPETITIONS_TS).text();
      const { next, added, skipped } = applyCompetitionRecordsToSource(prev, plan.toInsert);
      if (added.length > 0) {
        await Bun.write(COMPETITIONS_TS, next);
      }
      const stamped = stampInventoryLeaguesFromRecords(db, plan.toInsert);
      // skin_events stamp needs reloaded COMPETITIONS — best-effort via resolve after write
      // only works for already-loaded seeds; same-process resolve won't see new file.
      // Document --backfill after restart. Still try for any that already existed.
      const eventsN = stampSkinEventsCompetitionIds(db);

      if (json) {
        console.log(
          JSON.stringify(
            {
              promote: true,
              apply: true,
              minPeak,
              added,
              skipped,
              stampedLeagues: stamped,
              skinEventsUpdated: eventsN,
              rejected: plan.rejected.length,
              toInsert: plan.toInsert.map(r => r.id),
            },
            null,
            2
          )
        );
      } else {
        console.log(
          `inventory:leagues --promote --apply minPeak=${minPeak} ` +
            `added=${added.length} skipped=${skipped.length} ` +
            `stampedLeagues=${stamped} · rejected=${plan.rejected.length}`
        );
        for (const id of added.slice(0, 30)) {
          console.log(`  +C ${id}`);
        }
        if (added.length > 0) {
          console.log(
            '  note: re-run `bun run inventory:leagues -- --backfill` in a new process to stamp skin_events'
          );
        }
      }
      return;
    }

    // dry-run plan (default)
    if (json) {
      console.log(
        JSON.stringify(
          {
            promote: true,
            dryRun: true,
            minPeak,
            toInsert: plan.toInsert,
            candidates: plan.candidates.map(c => {
              const m = resolveCompetitionMeta(c.record);
              return {
                id: c.record.id,
                sportId: c.record.sportId,
                leagueKey: c.source.leagueKey,
                bucket: c.record.providerMappings.plive?.inventoryBucket,
                peak: c.source.peakEventCount,
                gender: c.record.gender,
                countryCode: m.countryCode ?? c.record.countryCode ?? null,
                kind: m.kind,
              };
            }),
            rejected: plan.rejected.map(r => ({
              sportId: r.source.sportId,
              leagueKey: r.source.leagueKey,
              reason: r.reason,
              peak: r.source.peakEventCount,
            })),
            counts: {
              candidates: plan.candidates.length,
              rejected: plan.rejected.length,
            },
          },
          null,
          2
        )
      );
      return;
    }

    console.log(
      `inventory:leagues --promote (dry-run) minPeak=${minPeak} ` +
        `candidates=${plan.candidates.length} rejected=${plan.rejected.length}`
    );
    for (const c of plan.candidates.slice(0, 40)) {
      const peak = c.source.peakEventCount ?? '?';
      const m = resolveCompetitionMeta(c.record);
      const cc = m.countryCode ?? '?';
      console.log(
        `  +C ${c.record.id} · peak=${peak} · ${c.record.providerMappings.plive?.inventoryBucket}` +
          ` · cc=${cc} kind=${m.kind}`,
      );
    }
    if (plan.candidates.length > 40) {
      console.log(`  … ${plan.candidates.length - 40} more`);
    }
    const byReason = new Map<string, number>();
    for (const r of plan.rejected) {
      byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + 1);
    }
    if (byReason.size > 0) {
      console.log(
        `  rejected: ${[...byReason.entries()].map(([k, v]) => `${k}=${v}`).join(' ')}`
      );
    }
    if (plan.candidates.length > 0) {
      console.log('  preview source (first):');
      console.log(formatCompetitionRecordSource(plan.candidates[0]!.record));
      console.log('  apply with: bun run inventory:leagues -- --promote --apply');
    }
    return;
  }

  if (harvest) {
    const sport = sportFilter ?? 'all';
    const profile = resolveProfile(dryRun);
    const adapter = getFantasySessionAdapter(profile, { warmSession: false });
    try {
      await adapter.login();
    } catch {
      /* public feed */
    }
    const report = await runInventorySync(db, adapter, {
      sport,
      dryRun,
    });
    if (json) {
      console.log(
        JSON.stringify(
          {
            harvest: true,
            dryRun,
            events: {
              seen: report.seen,
              inserted: report.inserted,
              updated: report.updated,
            },
            leagues: report.leagues,
            coversLiveProducts: report.coversLiveProducts,
          },
          null,
          2
        )
      );
    } else {
      console.log(
        `inventory:leagues --harvest sport=${sport}${dryRun ? ' --dry-run' : ''} ` +
          `events seen=${report.seen} new=${report.inserted} · ` +
          `leagues seen=${report.leagues.seen} new=${report.leagues.inserted}`
      );
      for (const L of report.leagues.newLeagues.slice(0, 20)) {
        console.log(`  +L ${formatLeagueLine(L)}`);
      }
    }
    return;
  }

  const counts = countInventoryLeagues(db);
  const rows = listInventoryLeagues(db, {
    unmappedOnly: unmapped,
    sportId: sportFilter && sportFilter !== 'all' ? sportFilter : undefined,
    limit,
    orderBy,
  });

  if (json) {
    console.log(
      JSON.stringify(
        {
          counts,
          unmappedOnly: unmapped,
          sportId: sportFilter ?? null,
          orderBy,
          meta: showMeta,
          leagues: rows.map(r => rowJson(r, { meta: showMeta })),
        },
        null,
        2
      )
    );
    return;
  }

  console.log(
    `inventory:leagues total=${counts.total} liveNow=${counts.liveNow} unmapped=${counts.unmapped}` +
      (unmapped ? ' (unmapped only)' : '') +
      (sportFilter ? ` sport=${sportFilter}` : '') +
      (showMeta ? '' : ' (no-meta)'),
  );
  for (const r of rows) {
    const live = r.eventCountLive > 0 ? '*' : ' ';
    console.log(`  ${live} ${formatLeagueLine(r, { meta: showMeta })}`);
  }
  if (rows.length === 0) {
    console.log('  (empty — run inventory:leagues -- --harvest --sport=all)');
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
