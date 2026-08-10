/**
 * Integrate widget-domain-snapshot (Pandora + shell) into domain registries.
 *
 * - Leagues → planCompetitionPromote → COMPETITIONS (plive + optional pandora ids)
 * - Coverage / market gap reports (no silent mass-seed of 3k+ junk)
 *
 * Snapshot SSOT path: research/cache/widget-domain-snapshot.json
 *   bun run domain:widget-extract -- --write
 */
import {
  applyCompetitionRecordsToSource,
  planCompetitionPromote,
  type CompetitionPromotePlan,
  type PromoteLeagueInput,
} from './competition-promote.ts';
import {
  listCompetitions,
  matchLeagueKey,
  type CompetitionRecord,
} from './competitions.ts';
import { listLiveProductSportBindings } from './live-product-sport-bindings.ts';
import {
  defaultWidgetDomainCachePath,
  mapLiveSportNameToSportId,
  type WidgetDomainSnapshot,
  type WidgetLiveLeague,
  type WidgetLiveSport,
  type WidgetMarketLabel,
  type WidgetWagerType,
} from './widget-domain-extract.ts';
import { KNOWN_MARKET_LABELS } from './odds-selection.ts';
import { listSports, type SportId } from './sports.ts';
import { isSportId } from './sports.ts';

export type PandoraSportMapEntry = {
  feedSportId: string;
  name: string;
  sportId: SportId | null;
};

export type PandoraCoverageReport = {
  at: string;
  snapshotAt: string | null;
  partner: { partnerId: string | null; partnerName: string | null };
  sports: {
    live: number;
    mapped: number;
    unmapped: Array<{ feedSportId: string; name: string }>;
    domainMissingFromLive: string[];
  };
  leagues: {
    total: number;
    mappableSport: number;
    unmappedSport: number;
    alreadyInCompetitions: number;
    promotable: number;
    bySport: Record<string, number>;
  };
  markets: {
    htmlMarketLabels: number;
    wagerTypes: number;
    knownMarketTypeIds: string[];
    interestingHtmlKeys: string[];
    wagerSampleUnmapped: Array<{ id: string; name: string; shortName?: string | null }>;
  };
  competitionsSeeded: number;
};

export type PandoraPromoteOptions = {
  /** Max new COMPETITIONS to plan (default 50; hard cap 500). */
  limit?: number;
  minPeak?: number;
  /** Only this domain SportId. */
  sportId?: string;
  /** Prefer leagues whose names match inventory structure markers (default true via promote). */
  snapshot?: WidgetDomainSnapshot;
  snapshotPath?: string;
};

export type PandoraPromoteResult = {
  plan: CompetitionPromotePlan;
  /** toInsert enriched with providerMappings.pandora when feed id known. */
  records: CompetitionRecord[];
  sportMap: PandoraSportMapEntry[];
  limited: number;
  considered: number;
};

export async function loadWidgetDomainSnapshot(
  path = defaultWidgetDomainCachePath()
): Promise<WidgetDomainSnapshot> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(
      `widget-domain snapshot missing: ${path}\n` +
        `Run: bun run domain:widget-extract -- --write`
    );
  }
  return (await file.json()) as WidgetDomainSnapshot;
}

export function buildPandoraSportMap(
  liveSports: WidgetLiveSport[]
): PandoraSportMapEntry[] {
  return liveSports.map(s => ({
    feedSportId: s.id,
    name: s.name,
    sportId: mapLiveSportNameToSportId(s.name),
  }));
}

function inventoryBucketForSport(sportId: SportId): string {
  const rows = listLiveProductSportBindings('plive');
  return rows.find(r => r.sportId === sportId)?.inventoryBucket ?? sportId;
}

/** Existing competition name/alias keys → id. */
function existingCompetitionNameIndex(): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of listCompetitions()) {
    map.set(matchLeagueKey(c.displayName), c.id);
    for (const a of c.aliases) map.set(matchLeagueKey(a), c.id);
    const plive = c.providerMappings.plive;
    if (plive) map.set(matchLeagueKey(plive.leagueKey), c.id);
  }
  return map;
}

/** Pandora league id already stored on a seed. */
function existingPandoraLeagueIds(): Set<string> {
  const ids = new Set<string>();
  for (const c of listCompetitions()) {
    const p = (c as CompetitionRecord).providerMappings.pandora;
    if (p?.leagueId) ids.add(p.leagueId);
  }
  return ids;
}

/** Extra filters for feed noise (not stream-list inventory). */
export function isPandoraLeagueNoise(name: string): boolean {
  const n = name.trim();
  if (!n) return true;
  if (/do\s*not\s*map|!!!!!!/i.test(n)) return true;
  if (/presidential\s+election|next\s+president/i.test(n)) return true;
  // Prop/futures shells often pollute league lists
  if (/\bprops?\b/i.test(n) && n.length < 40) return true;
  return false;
}

export function liveLeaguesToPromoteInputs(
  leagues: WidgetLiveLeague[],
  sportMap: PandoraSportMapEntry[],
  options: { sportId?: string } = {}
): Array<PromoteLeagueInput & { pandoraLeagueId: string; feedSportId: string }> {
  const byFeed = new Map(sportMap.map(s => [s.feedSportId, s]));
  const want = options.sportId?.trim().toLowerCase();
  const out: Array<
    PromoteLeagueInput & { pandoraLeagueId: string; feedSportId: string }
  > = [];

  for (const league of leagues) {
    const feedSportId = league.sportId ?? '';
    const sm = byFeed.get(feedSportId);
    const sportId = sm?.sportId ?? null;
    if (!sportId) continue;
    if (want && sportId !== want) continue;
    const leagueKey = league.name.trim();
    if (!leagueKey || isPandoraLeagueNoise(leagueKey)) continue;
    // Skip soft "other" bucket for auto-promote (manual review)
    if (sportId === 'sports_channels') continue;
    out.push({
      sportId,
      leagueKey,
      inventoryBucket: inventoryBucketForSport(sportId),
      peakEventCount: 1,
      pandoraLeagueId: league.id,
      feedSportId,
    });
  }
  return out;
}

/**
 * Plan COMPETITIONS inserts from Pandora snapshot leagues.
 * Enriches records with providerMappings.pandora when promotable.
 */
export function planPandoraCompetitionPromote(
  snapshot: WidgetDomainSnapshot,
  options: PandoraPromoteOptions = {}
): PandoraPromoteResult {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
  const sportMap = buildPandoraSportMap(snapshot.liveSports);
  const inputs = liveLeaguesToPromoteInputs(snapshot.liveLeagues, sportMap, {
    sportId: options.sportId,
  });

  // Drop leagues already linked by pandora id or exact name
  const pandoraIds = existingPandoraLeagueIds();
  const nameIndex = existingCompetitionNameIndex();
  const filtered = inputs.filter(i => {
    if (pandoraIds.has(i.pandoraLeagueId)) return false;
    if (nameIndex.has(matchLeagueKey(i.leagueKey))) return false;
    return true;
  });

  const plan = planCompetitionPromote(
    filtered.map(i => ({
      sportId: i.sportId,
      leagueKey: i.leagueKey,
      inventoryBucket: i.inventoryBucket,
      peakEventCount: i.peakEventCount,
    })),
    { minPeak: options.minPeak ?? 1 }
  );

  // Map name → pandora id for enrichment
  const pandoraByName = new Map<string, { leagueId: string; feedSportId: string }>();
  for (const i of filtered) {
    pandoraByName.set(matchLeagueKey(i.leagueKey), {
      leagueId: i.pandoraLeagueId,
      feedSportId: i.feedSportId,
    });
  }

  const seenIds = new Set<string>();
  const limited: CompetitionRecord[] = [];
  for (const rec of plan.toInsert) {
    if (seenIds.has(rec.id)) continue;
    const hit = pandoraByName.get(matchLeagueKey(rec.displayName));
    const enriched: CompetitionRecord = hit
      ? {
          ...rec,
          providerMappings: {
            ...rec.providerMappings,
            pandora: {
              leagueId: hit.leagueId,
              feedSportId: hit.feedSportId,
            },
          },
        }
      : rec;
    seenIds.add(rec.id);
    limited.push(enriched);
    if (limited.length >= limit) break;
  }

  return {
    plan: {
      ...plan,
      toInsert: limited,
      candidates: plan.candidates.filter(c =>
        limited.some(r => r.id === c.record.id)
      ),
    },
    records: limited,
    sportMap,
    limited: limited.length,
    considered: filtered.length,
  };
}

export function buildPandoraCoverageReport(
  snapshot: WidgetDomainSnapshot
): PandoraCoverageReport {
  const sportMap = buildPandoraSportMap(snapshot.liveSports);
  const mappedSports = sportMap.filter(s => s.sportId != null);
  const unmappedSports = sportMap
    .filter(s => s.sportId == null)
    .map(s => ({ feedSportId: s.feedSportId, name: s.name }));

  const liveMappedIds = new Set(
    mappedSports.map(s => s.sportId).filter((x): x is SportId => x != null)
  );
  const domainMissingFromLive = listSports()
    .map(s => s.id)
    .filter(id => !liveMappedIds.has(id as SportId));

  const inputs = liveLeaguesToPromoteInputs(snapshot.liveLeagues, sportMap);
  const nameIndex = existingCompetitionNameIndex();
  const pandoraIds = existingPandoraLeagueIds();
  let already = 0;
  let unmappedSport = 0;
  const bySport: Record<string, number> = {};

  for (const league of snapshot.liveLeagues) {
    const sm = sportMap.find(s => s.feedSportId === (league.sportId ?? ''));
    if (!sm?.sportId) {
      unmappedSport++;
      continue;
    }
    bySport[sm.sportId] = (bySport[sm.sportId] ?? 0) + 1;
    if (
      pandoraIds.has(league.id) ||
      nameIndex.has(matchLeagueKey(league.name))
    ) {
      already++;
    }
  }

  const plan = planPandoraCompetitionPromote(snapshot, { limit: 500 });

  const interestingHtml = (snapshot.markets as WidgetMarketLabel[])
    .filter(m =>
      /^(SPREAD|TOTAL|MONEYLINE|MONEY_LINE|DRAW_NO_BET|DOUBLE_CHANCE|TEAM_TOTAL)/.test(
        m.id
      )
    )
    .map(m => m.key);

  const knownShort = new Set(
    Object.values(KNOWN_MARKET_LABELS).map(s => s.toLowerCase())
  );
  const wagerSampleUnmapped: PandoraCoverageReport['markets']['wagerSampleUnmapped'] =
    [];
  for (const w of snapshot.wagerTypes as WidgetWagerType[]) {
    const n = w.name.toLowerCase();
    const sn = (w.shortName ?? '').toLowerCase();
    if (knownShort.has(n) || knownShort.has(sn)) continue;
    if (/money\s*line|moneyline|spread|total|draw no bet/.test(n)) continue;
    wagerSampleUnmapped.push({
      id: w.id,
      name: w.name,
      shortName: w.shortName,
    });
    if (wagerSampleUnmapped.length >= 40) break;
  }

  return {
    at: new Date().toISOString(),
    snapshotAt: snapshot.at ?? null,
    partner: {
      partnerId: snapshot.partner?.partnerId ?? null,
      partnerName: snapshot.partner?.partnerName ?? null,
    },
    sports: {
      live: snapshot.liveSports.length,
      mapped: mappedSports.length,
      unmapped: unmappedSports,
      domainMissingFromLive,
    },
    leagues: {
      total: snapshot.liveLeagues.length,
      mappableSport: inputs.length,
      unmappedSport,
      alreadyInCompetitions: already,
      promotable: plan.plan.toInsert.length,
      bySport,
    },
    markets: {
      htmlMarketLabels: snapshot.markets.length,
      wagerTypes: snapshot.wagerTypes.length,
      knownMarketTypeIds: Object.keys(KNOWN_MARKET_LABELS),
      interestingHtmlKeys: interestingHtml,
      wagerSampleUnmapped,
    },
    competitionsSeeded: listCompetitions().length,
  };
}

export function formatPandoraCoverageReport(r: PandoraCoverageReport): string {
  const lines: string[] = [];
  lines.push(`pandora-domain-report @ ${r.at}`);
  lines.push(`snapshot: ${r.snapshotAt ?? '—'} · partner ${r.partner.partnerId ?? '—'} ${r.partner.partnerName ?? ''}`);
  lines.push(`competitions seeded: ${r.competitionsSeeded}`);
  lines.push('');
  lines.push('## Sports');
  lines.push(
    `  live=${r.sports.live} mapped=${r.sports.mapped} unmapped=${r.sports.unmapped.length}`
  );
  if (r.sports.unmapped.length) {
    lines.push(
      `  unmapped: ${r.sports.unmapped
        .slice(0, 15)
        .map(s => `${s.feedSportId}:${s.name}`)
        .join(', ')}${r.sports.unmapped.length > 15 ? '…' : ''}`
    );
  }
  lines.push(
    `  domain not in live map: ${r.sports.domainMissingFromLive.join(', ') || 'none'}`
  );
  lines.push('');
  lines.push('## Leagues');
  lines.push(
    `  total=${r.leagues.total} mappableSport=${r.leagues.mappableSport} ` +
      `unmappedSport=${r.leagues.unmappedSport} alreadyNamed=${r.leagues.alreadyInCompetitions} ` +
      `promotable(cap500)=${r.leagues.promotable}`
  );
  const topSports = Object.entries(r.leagues.bySport)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);
  for (const [sp, n] of topSports) {
    lines.push(`  ${sp.padEnd(20)} ${n}`);
  }
  lines.push('');
  lines.push('## Markets');
  lines.push(
    `  html MARKET_*=${r.markets.htmlMarketLabels} wagerTypes=${r.markets.wagerTypes}`
  );
  lines.push(
    `  known Pandora marketType ids: ${r.markets.knownMarketTypeIds.join(', ')}`
  );
  lines.push(
    `  interesting HTML: ${r.markets.interestingHtmlKeys.slice(0, 12).join(', ')}`
  );
  lines.push(
    `  sample wager types (not obvious ML/spread/total): ${r.markets.wagerSampleUnmapped.length}`
  );
  for (const w of r.markets.wagerSampleUnmapped.slice(0, 12)) {
    lines.push(`    ${w.id.padEnd(6)} ${w.shortName ?? '—'}  ${w.name}`);
  }
  lines.push('');
  lines.push(
    'Promote: bun run domain:pandora -- --promote --limit=50   # dry-run\n' +
      '         bun run domain:pandora -- --promote --apply --limit=20'
  );
  return lines.join('\n');
}

export function formatPandoraPromotePlan(result: PandoraPromoteResult): string {
  const lines: string[] = [];
  lines.push(
    `pandora-promote considered=${result.considered} toInsert=${result.records.length} ` +
      `rejected=${result.plan.rejected.length} (limit applied)`
  );
  const rejectCounts = new Map<string, number>();
  for (const r of result.plan.rejected) {
    rejectCounts.set(r.reason, (rejectCounts.get(r.reason) ?? 0) + 1);
  }
  lines.push(
    `  rejects: ${[...rejectCounts.entries()].map(([k, v]) => `${k}=${v}`).join(' ') || 'none'}`
  );
  for (const rec of result.records.slice(0, 40)) {
    const p = rec.providerMappings.pandora;
    lines.push(
      `  + ${rec.id}  pandora=${p?.leagueId ?? '—'}  ${rec.displayName}`
    );
  }
  if (result.records.length > 40) {
    lines.push(`  … +${result.records.length - 40} more`);
  }
  return lines.join('\n');
}

export async function applyPandoraPromoteToCompetitionsFile(
  records: CompetitionRecord[],
  competitionsPath: string
): Promise<{ added: string[]; skipped: string[] }> {
  const prev = await Bun.file(competitionsPath).text();
  const { next, added, skipped } = applyCompetitionRecordsToSource(prev, records);
  if (added.length > 0) {
    await Bun.write(competitionsPath, next);
  }
  return { added, skipped };
}

export function isValidSportFilter(raw: string | undefined): raw is SportId | undefined {
  if (raw == null || raw === '' || raw === 'all') return true;
  return isSportId(raw);
}
