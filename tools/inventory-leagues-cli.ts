#!/usr/bin/env bun
/**
 * Durable inventory league registry (book + bucket + league label).
 *
 *   bun run inventory:leagues
 *   bun run inventory:leagues -- --json
 *   bun run inventory:leagues -- --unmapped
 *   bun run inventory:leagues -- --sport=table_tennis --limit=50
 *   bun run inventory:leagues -- --order=peak
 *   bun run inventory:leagues -- --harvest --sport=all [--dry-run]
 *
 * --harvest: poll stream-list (via inventory:sync path) and upsert leagues only
 *            (still runs full sync unless --leagues-only; here we use sync for events+leagues).
 */
// @see https://bun.com/docs/runtime/sqlite
import { openEventStore } from '../src/institutions/event-store/open-db.ts';
import { DEFAULT_EVENT_STORE_DB } from '../src/institutions/event-store/paths.ts';
import {
  countInventoryLeagues,
  formatLeagueLine,
  listInventoryLeagues,
  type InventoryLeagueRow,
} from '../src/inventory/leagues.ts';
import { runInventorySync } from '../src/inventory/sync.ts';
import {
  getFantasySessionAdapter,
  loadFantasy402ProfileFromEnv,
  requireFantasy402ProfileFromEnv,
} from '../src/partner/index.ts';
import { requireDefaultUrlForUltraMapper } from '../src/domain/index.ts';
import type { PartnerAccountProfile } from '../src/partner/account-profile.ts';

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function argValue(name: string): string | undefined {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function resolveProfile(dryRun: boolean): PartnerAccountProfile {
  const fromEnv = loadFantasy402ProfileFromEnv();
  if (fromEnv) return fromEnv;
  if (
    dryRun &&
    (Bun.env.INVENTORY_SYNC_PUBLIC === '1' || Bun.env.PARTNER_SYNC_PUBLIC === '1')
  ) {
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

function rowJson(r: InventoryLeagueRow) {
  return {
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
}

async function main(): Promise<void> {
  const json = hasFlag('json');
  const unmapped = hasFlag('unmapped');
  const harvest = hasFlag('harvest');
  const dryRun = hasFlag('dry-run') || hasFlag('dryRun');
  const sportFilter = argValue('sport');
  const limit = Number(argValue('limit') ?? '100') || 100;
  const orderBy = argValue('order') === 'peak' ? 'peak' : 'last_seen';

  const db = openEventStore({ dbPath: DEFAULT_EVENT_STORE_DB });

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
          leagues: rows.map(rowJson),
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
      (sportFilter ? ` sport=${sportFilter}` : '')
  );
  for (const r of rows) {
    const live = r.eventCountLive > 0 ? '*' : ' ';
    console.log(`  ${live} ${formatLeagueLine(r)}`);
  }
  if (rows.length === 0) {
    console.log('  (empty — run inventory:leagues -- --harvest --sport=all)');
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
