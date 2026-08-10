/**
 * Coverage ops snapshot: DB + widget snapshot → JSON report + gates.
 * Used by bake board (HTML/JSON) and optional Telegram notify.
 */
// @see https://bun.com/docs/runtime/sqlite
import type { Database } from 'bun:sqlite';
import { listCompetitions } from '../domain/competitions.ts';
import type { WidgetDomainSnapshot } from '../domain/widget-domain-extract.ts';
import {
  buildMarketMatrix,
  buildSportColumns,
  buildWagerFamilyRows,
  pandoraLeaguesBySport,
} from './coverage-board.ts';

export type CoverageOpsIdentity = {
  skinId: string;
  bookId: string;
  inventoryLiveProduct: string;
};

export type CoverageOpsReport = {
  generatedAt: string;
  identity: CoverageOpsIdentity;
  coversLiveProducts: string[];
  odds: {
    bookId: string;
    total: number;
    linked: number;
    unlinked: number;
    linkedPct: number;
  };
  leagues: {
    total: number;
    unmapped: number;
    liveNow: number;
    pandoraTotal: number;
  };
  competitions: number;
  wagerTypeTotal: number;
  sports: string[];
  bySportCols: Record<string, ReturnType<typeof buildSportColumns>[number]>;
  marketMatrix: ReturnType<typeof buildMarketMatrix>;
  wagerFamilies: ReturnType<typeof buildWagerFamilyRows>;
  topUnmapped: Array<{
    sport: string;
    league: string;
    peak: number;
    live: number;
  }>;
  sampleLinked: Array<{
    sport: string;
    league: string;
    home: string;
    away: string;
    odds: string;
    inv: string;
  }>;
  /** Ops gates */
  quality: {
    passed: boolean;
    errors: string[];
    warnings: string[];
  };
};

export type CoverageOpsGates = {
  /** Fail when linkedPct < this (0–100). Default null = no fail. */
  minLinkedPct?: number | null;
  /** Fail when unmapped leagues ≥ this. */
  maxUnmappedLeagues?: number | null;
  /** Warn when sport fillPct below this (0–100). */
  warnSportFillPct?: number | null;
};

export function loadCoverageOpsInputs(
  db: Database,
  bookId: string
): {
  eventRows: Array<{ sport: string; n: number; linked: number }>;
  leagueRows: Array<{ sport: string; n: number; mapped: number }>;
  topUnmapped: CoverageOpsReport['topUnmapped'];
  sampleLinked: CoverageOpsReport['sampleLinked'];
  leaguesLiveNow: number;
} {
  const eventRows = db
    .query(
      `SELECT sport AS sport,
              COUNT(*) AS n,
              SUM(CASE WHEN odds_event_id IS NOT NULL AND TRIM(odds_event_id) != '' THEN 1 ELSE 0 END) AS linked
       FROM skin_events WHERE book_id = $book
       GROUP BY sport ORDER BY n DESC`
    )
    .all({ $book: bookId }) as Array<{ sport: string; n: number; linked: number }>;

  const leagueRows = db
    .query(
      `SELECT inventory_bucket AS sport,
              COUNT(*) AS n,
              SUM(CASE WHEN competition_id IS NOT NULL THEN 1 ELSE 0 END) AS mapped
       FROM inventory_leagues WHERE book_id = $book
       GROUP BY inventory_bucket ORDER BY n DESC`
    )
    .all({ $book: bookId }) as Array<{ sport: string; n: number; mapped: number }>;

  const topUnmapped = db
    .query(
      `SELECT inventory_bucket AS sport, league_key AS league,
              peak_event_count AS peak, event_count_live AS live
       FROM inventory_leagues
       WHERE book_id = $book AND competition_id IS NULL
       ORDER BY peak_event_count DESC, event_count_live DESC
       LIMIT 20`
    )
    .all({ $book: bookId }) as CoverageOpsReport['topUnmapped'];

  const sampleLinked = (
    db
      .query(
        `SELECT sport, league, home, away, odds_event_id AS odds, inventory_id AS inv
         FROM skin_events
         WHERE book_id = $book
           AND odds_event_id IS NOT NULL AND TRIM(odds_event_id) != ''
         ORDER BY last_updated DESC
         LIMIT 12`
      )
      .all({ $book: bookId }) as Array<{
      sport: string;
      league: string | null;
      home: string | null;
      away: string | null;
      odds: string;
      inv: string;
    }>
  ).map(r => ({
    sport: r.sport,
    league: r.league ?? '—',
    home: r.home ?? '?',
    away: r.away ?? '?',
    odds: r.odds,
    inv: r.inv,
  }));

  const liveRow = db
    .query(
      `SELECT COALESCE(SUM(CASE WHEN event_count_live > 0 THEN 1 ELSE 0 END), 0) AS liveNow
       FROM inventory_leagues WHERE book_id = $book`
    )
    .get({ $book: bookId }) as { liveNow: number } | null;

  return {
    eventRows,
    leagueRows,
    topUnmapped,
    sampleLinked,
    leaguesLiveNow: Number(liveRow?.liveNow) || 0,
  };
}

export function buildCoverageOpsReport(input: {
  bookId?: string;
  snap?: WidgetDomainSnapshot | null;
  eventRows: Array<{ sport: string; n: number; linked: number }>;
  leagueRows: Array<{ sport: string; n: number; mapped: number }>;
  topUnmapped: CoverageOpsReport['topUnmapped'];
  sampleLinked: CoverageOpsReport['sampleLinked'];
  leaguesLiveNow?: number;
  gates?: CoverageOpsGates;
  nowMs?: number;
}): CoverageOpsReport {
  const bookId = input.bookId ?? 'fantasy402';
  const snap = input.snap ?? null;
  const pandoraBySport = snap ? pandoraLeaguesBySport(snap) : {};
  const sports = buildSportColumns({
    eventRows: input.eventRows,
    leagueRows: input.leagueRows,
    pandoraLeagueBySport: pandoraBySport,
  });

  const marketMatrix = snap
    ? buildMarketMatrix({
        liveSports: snap.liveSports ?? [],
        sportOrder: sports.map(s => s.sport),
        wagerTypes: snap.wagerTypes ?? [],
      })
    : {
        marketIds: [],
        sports: [],
        cells: {},
        labels: {},
        wagerTypeCounts: {},
      };

  const wagerFamilies = snap
    ? buildWagerFamilyRows(snap.wagerTypes ?? [], 18)
    : [];

  const totalEvents = sports.reduce((s, r) => s + r.events, 0);
  const totalLinked = sports.reduce((s, r) => s + r.linked, 0);
  const totalLeagues = sports.reduce((s, r) => s + r.leagues, 0);
  const totalMapped = sports.reduce((s, r) => s + r.mapped, 0);
  const linkedPct = totalEvents
    ? Math.round((totalLinked / totalEvents) * 100)
    : 0;
  const unmapped = totalLeagues - totalMapped;

  const gates = input.gates ?? {};
  const errors: string[] = [];
  const warnings: string[] = [];

  if (
    gates.minLinkedPct != null &&
    totalEvents > 0 &&
    linkedPct < gates.minLinkedPct
  ) {
    errors.push(
      `linkedPct=${linkedPct}% < minLinkedPct=${gates.minLinkedPct}%`
    );
  }
  if (
    gates.maxUnmappedLeagues != null &&
    unmapped >= gates.maxUnmappedLeagues
  ) {
    errors.push(
      `unmappedLeagues=${unmapped} ≥ maxUnmappedLeagues=${gates.maxUnmappedLeagues}`
    );
  }
  const warnFill = gates.warnSportFillPct ?? 40;
  for (const s of sports) {
    if (s.events >= 5 && s.fillPct < warnFill) {
      warnings.push(
        `sport ${s.sport} fillPct=${s.fillPct}% (events=${s.events})`
      );
    }
  }

  return {
    generatedAt: new Date(input.nowMs ?? Date.now()).toISOString(),
    identity: {
      skinId: 'buckeye',
      bookId,
      inventoryLiveProduct: 'plive',
    },
    coversLiveProducts: ['plive', 'ezlive'],
    odds: {
      bookId,
      total: totalEvents,
      linked: totalLinked,
      unlinked: totalEvents - totalLinked,
      linkedPct,
    },
    leagues: {
      total: totalLeagues,
      unmapped,
      liveNow: input.leaguesLiveNow ?? 0,
      pandoraTotal: snap?.liveLeagues?.length ?? 0,
    },
    competitions: listCompetitions().length,
    wagerTypeTotal: snap?.wagerTypes?.length ?? 0,
    sports: sports.map(s => s.sport),
    bySportCols: Object.fromEntries(sports.map(s => [s.sport, s])),
    marketMatrix,
    wagerFamilies,
    topUnmapped: input.topUnmapped,
    sampleLinked: input.sampleLinked,
    quality: {
      passed: errors.length === 0,
      errors,
      warnings,
    },
  };
}

export function formatCoverageOpsSummary(r: CoverageOpsReport): string {
  const lines = [
    `coverage-ops ${r.quality.passed ? 'ok' : 'FAIL'} linked=${r.odds.linked}/${r.odds.total} (${r.odds.linkedPct}%)` +
      ` leagues=${r.leagues.total} unmapped=${r.leagues.unmapped} liveNow=${r.leagues.liveNow}`,
    `  sports=${r.sports.length} competitions=${r.competitions} wagerTypes=${r.wagerTypeTotal} pandoraLeagues=${r.leagues.pandoraTotal}`,
  ];
  for (const e of r.quality.errors) lines.push(`  ! ${e}`);
  for (const w of r.quality.warnings.slice(0, 6)) lines.push(`  ~ ${w}`);
  for (const u of r.topUnmapped.slice(0, 5)) {
    lines.push(
      `  unmapped ${u.sport}/${u.league} peak=${u.peak} live=${u.live}`
    );
  }
  return lines.join('\n');
}

/** Telegram lines for coverage alert (empty if nothing actionable). */
export function coverageOpsAlertLines(r: CoverageOpsReport): string[] {
  const lines: string[] = [];
  if (!r.quality.passed) {
    lines.push(...r.quality.errors.map(e => `FAIL ${e}`));
  }
  lines.push(
    `linked ${r.odds.linkedPct}% (${r.odds.linked}/${r.odds.total}) · unmapped leagues ${r.leagues.unmapped}`
  );
  for (const w of r.quality.warnings.slice(0, 4)) lines.push(w);
  for (const u of r.topUnmapped.slice(0, 4)) {
    lines.push(`unmapped ${u.sport}: ${u.league} (peak ${u.peak})`);
  }
  return lines;
}
