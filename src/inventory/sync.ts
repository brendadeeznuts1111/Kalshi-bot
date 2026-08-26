// @see https://bun.com/docs/runtime/sqlite
/**
 * Inventory sync — coverage ground-truth pipeline (not seat partner).
 *
 * REAL today:
 *  - stream-list-v2 → skin_events (detect new inventory_ids)
 *  - optional soft enrich: Statscore booked-events list by name match → odds_event_id
 *
 * NOT real yet (do not invent):
 *  - markets / lines from stream-list or livescorepro booked-events
 *  - placeOrder POST
 *  - merge into Kalshi match_liquidity
 *
 * Pandora priced book (optional): when `coefficientStore` (or adapter store)
 * has moneyline lines, report `pricedOdds: true` — still no liquidity merge.
 */
import type { Database } from 'bun:sqlite';
import type { CoefficientStore } from '../partner/fantasy-ultra/coefficient-store.ts';
import type { FantasySessionAdapter, InventoryEvent } from '../partner/types.ts';
import {
  formatEnrichValidation,
  type EnrichValidation,
} from './enrich-validate.ts';
import {
  formatEnrichQuality,
  type EnrichQualityReport,
} from './enrich-quality.ts';
import {
  formatLeagueLine,
  upsertInventoryLeagues,
  type InventoryLeagueUpsertResult,
} from './leagues.ts';
import {
  matchBookedOddsEventId,
  type BookedMatchEntry,
} from './booked-match.ts';
import {
  buckeyeInventoryIdentity,
  filterLiveEventsBySports,
  formatInventorySportSelection,
  formatSkinEventLine,
  inventorySportForCatalogFetch,
  listSkinInventoryIds,
  liveProductsCoveredByInventory,
  normalizeInventorySport,
  normalizeSkinEventsSports,
  parseInventorySportsCsv,
  resolveInventoryFetchSport,
  upsertSkinLiveEvents,
  type InventoryIdentity,
  type InventorySportSelection,
  type SkinEventRow,
} from './skin-events-store.ts';

/** Upsert plan shape (mirrors upsertSkinLiveEvents return). */
type SkinEventUpsertResult = {
  inserted: SkinEventRow[];
  updated: SkinEventRow[];
  seen: number;
};

/** Which skin_events rows to soft-match against Statscore booked list. */
export type EnrichBookedScope = 'new' | 'board' | 'unlinked';

export type InventorySyncOptions = {
  /**
   * Sport filter: single token, CSV multi (`table_tennis, tennis`), or `all`.
   * Spaces around commas are trimmed. Multi-sport fetches full board then filters.
   */
  sport?: string;
  /**
   * Soft-match Statscore booked names → odds_event_id (metadata only, not prices).
   * Scope defaults to `board` (new + on-board unlinked).
   */
  enrichBooked?: boolean;
  /**
   * - `new` — inserts only (legacy)
   * - `board` — inserts + this-poll updates still missing odds_event_id (default)
   * - `unlinked` — all null odds_event_id for the book (capped)
   */
  enrichBookedScope?: EnrichBookedScope;
  /**
   * Skip stream poll — only run booked enrich (default scope unlinked).
   * Uses public Statscore catalog when adapter list fails / public mode.
   */
  enrichOnly?: boolean;
  /** Max Statscore catalog rows for public enrich (default 1200). */
  enrichCatalogMax?: number;
  /**
   * Inject catalog (tests / offline). Skips public+adapter fetch when non-empty.
   */
  bookedCatalog?: BookedMatchEntry[];
  nowMs?: number;
  /** Explicit Pandora book; else adapter.getCoefficientStore() when present. */
  coefficientStore?: CoefficientStore;
  /** Defaults to Buckeye / Fantasy402 / plive shell. */
  identity?: InventoryIdentity;
  /**
   * Fetch + plan insert/update only — no SQLite writes, no booked enrich UPDATE,
   * no sport-label normalize. Report counts are would-be.
   */
  dryRun?: boolean;
  /**
   * Enrich quality gates (match-rate / linked%). Applied when enrich runs.
   * CLI: --min-match-rate=0.1 --min-linked-pct=20
   */
  minMatchRate?: number | null;
  minLinkedPct?: number | null;
  /**
   * Max skin_events candidates to attempt this enrich tick (Map-lane batch).
   * CLI: --limit=100. Default: no extra cap beyond listUnlinked max.
   */
  enrichLimit?: number | null;
};

export type InventorySyncReport = {
  sport: string;
  seen: number;
  inserted: number;
  updated: number;
  newEvents: SkinEventRow[];
  /** Existing inventory_ids that would be refreshed (dry-run or real). */
  updatedEvents?: SkinEventRow[];
  enriched: number;
  /** Rows considered for booked name match this tick. */
  enrichCandidates: number;
  enrichBookedScope: EnrichBookedScope | null;
  /** Pandora store sizes when available (0 if empty / absent). */
  pricedEventCount: number;
  pricedLineCount: number;
  /** Post-tick odds_event_id fill-rate for the book (null when dry-run skipped query). */
  oddsLink: OddsLinkCoverage | null;
  /** Post-enrich validation (null when enrich did not run). */
  enrichValidation: EnrichValidation | null;
  /** Match-rate + miss reasons (null when enrich did not run). */
  enrichQuality: EnrichQualityReport | null;
  /** True when no DB mutations were applied. */
  dryRun: boolean;
  /** Live-product shells this inventory feed covers (e.g. plive + ezlive). */
  coversLiveProducts: string[];
  /** Count of events on this poll by normalized sport id. */
  sportHistogram: Record<string, number>;
  /** Count of *new* inserts by sport (empty when none). */
  newBySport: Record<string, number>;
  /** League dimension upsert (durable registry). */
  leagues: InventoryLeagueUpsertResult;
  capabilities: {
    inventory: true;
    eventDetection: true;
    bookedMetadata: boolean;
    pricedOdds: boolean;
    placeBetRequest: false;
    liquidityMerge: false;
  };
  notes: string[];
};

/** Histogram of normalized sport keys from inventory rows or wire events. */
function sportHistogramFromEvents(
  events: Array<{ sport?: string | null }>
): Record<string, number> {
  const by: Record<string, number> = {};
  for (const e of events) {
    const key = normalizeInventorySport(String(e.sport ?? '').trim()) || '(unknown)';
    by[key] = (by[key] ?? 0) + 1;
  }
  return by;
}

function formatSportHistogram(hist: Record<string, number>): string {
  const parts = Object.entries(hist)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([s, n]) => `${s}=${n}`);
  return parts.length ? parts.join(' ') : '(none)';
}

function resolveCoefficientStore(
  adapter: FantasySessionAdapter,
  options: InventorySyncOptions
): CoefficientStore | null {
  if (options.coefficientStore) return options.coefficientStore;
  const maybe = adapter as FantasySessionAdapter & {
    getCoefficientStore?: () => CoefficientStore;
  };
  if (typeof maybe.getCoefficientStore === 'function') {
    return maybe.getCoefficientStore();
  }
  return null;
}

export function parseEnrichBookedScope(raw: string | undefined): EnrichBookedScope {
  const v = (raw ?? 'board').trim().toLowerCase();
  if (v === 'new' || v === 'inserts') return 'new';
  if (v === 'unlinked' || v === 'all-null' || v === 'nulls') return 'unlinked';
  return 'board';
}

/** Rows on this poll still missing odds_event_id (board/new scopes). */
export function collectBoardEnrichCandidates(
  upsert: SkinEventRow[] | SkinEventUpsertResult,
  db: Database,
  bookId: string,
  scope: EnrichBookedScope,
  options: { limit?: number | null | undefined } = {}
): Array<{
  inventoryId: string;
  home: string | null;
  away: string | null;
  sport: string | null;
  league: string | null;
}> {
  const cap =
    options.limit != null && Number.isFinite(options.limit)
      ? Math.min(Math.max(Math.floor(options.limit), 1), 2000)
      : undefined;
  if (scope === 'unlinked') {
    return listUnlinkedSkinEvents(db, bookId, cap ?? 500);
  }
  const inserted = Array.isArray(upsert) ? upsert : upsert.inserted;
  const updated = Array.isArray(upsert) ? [] : upsert.updated;
  const candidates: Array<{
    inventoryId: string;
    home: string | null;
    away: string | null;
    sport: string | null;
    league: string | null;
  }> = [];
  for (const row of inserted) {
    candidates.push({
      inventoryId: row.inventoryId,
      home: row.home,
      away: row.away,
      sport: row.sport ?? null,
      league: row.league ?? null,
    });
  }
  if (scope === 'board' && updated.length > 0) {
    const unlinked = new Set(
      listUnlinkedSkinEvents(
        db,
        bookId,
        cap ?? 500,
        updated.map(r => r.inventoryId)
      ).map(r => r.inventoryId)
    );
    for (const row of updated) {
      if (!unlinked.has(row.inventoryId)) continue;
      candidates.push({
        inventoryId: row.inventoryId,
        home: row.home,
        away: row.away,
        sport: row.sport ?? null,
        league: row.league ?? null,
      });
    }
  }
  return cap != null ? candidates.slice(0, cap) : candidates;
}

/** Keep enrich candidates whose normalized sport is in the CLI sport selection. */
export function filterEnrichCandidatesBySport<
  T extends { sport?: string | null },
>(candidates: T[], sportSel: InventorySportSelection): T[] {
  if (sportSel.kind === 'all') return candidates;
  if (sportSel.sports.length === 0) return candidates;
  const want = new Set(sportSel.sports);
  return candidates.filter(c => {
    const id = normalizeInventorySport(String(c.sport ?? '')) || String(c.sport ?? '')
      .toLowerCase()
      .replace(/\s+/g, '_');
    return want.has(id);
  });
}

export type OddsLinkCoverage = {
  bookId: string;
  total: number;
  linked: number;
  unlinked: number;
  /** 0–100, integer percent of rows with non-empty odds_event_id. */
  linkedPct: number;
};

/** Fill-rate of skin_events.odds_event_id for a book (metadata link, not prices). */
export function oddsLinkCoverage(db: Database, bookId: string): OddsLinkCoverage {
  const row = db
    .query(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN odds_event_id IS NOT NULL AND TRIM(odds_event_id) != '' THEN 1 ELSE 0 END) AS linked
       FROM skin_events WHERE book_id = $book`
    )
    .get({ $book: bookId }) as { total: number; linked: number | null };
  const total = Number(row?.total) || 0;
  const linked = Number(row?.linked) || 0;
  const unlinked = Math.max(0, total - linked);
  const linkedPct = total === 0 ? 0 : Math.round((linked / total) * 100);
  return { bookId, total, linked, unlinked, linkedPct };
}

export function formatOddsLinkCoverage(c: OddsLinkCoverage): string {
  return `odds-link book=${c.bookId} linked=${c.linked}/${c.total} (${c.linkedPct}%) unlinked=${c.unlinked}`;
}

type EnrichCandidate = {
  inventoryId: string;
  home: string | null;
  away: string | null;
  sport: string | null;
  league: string | null;
};

export function listUnlinkedSkinEvents(
  db: Database,
  bookId: string,
  limit = 500,
  inventoryIds?: string[]
): EnrichCandidate[] {
  const lim = Math.min(Math.max(limit, 1), 2000);
  if (inventoryIds && inventoryIds.length > 0) {
    const out: EnrichCandidate[] = [];
    const q = db.query(
      `SELECT inventory_id AS inventoryId, home, away, sport, league
       FROM skin_events
       WHERE book_id = $book
         AND inventory_id = $iid
         AND (odds_event_id IS NULL OR odds_event_id = '')`
    );
    for (const id of inventoryIds) {
      const row = q.get({ $book: bookId, $iid: id }) as EnrichCandidate | null;
      if (row) out.push(row);
    }
    return out;
  }
  return db
    .query(
      `SELECT inventory_id AS inventoryId, home, away, sport, league
       FROM skin_events
       WHERE book_id = $book
         AND (odds_event_id IS NULL OR odds_event_id = '')
       ORDER BY last_updated DESC
       LIMIT $lim`
    )
    .all({ $book: bookId, $lim: lim }) as EnrichCandidate[];
}

/**
 * Apply soft name matches → odds_event_id. Returns match count.
 * dryRun: only mutates in-memory `touch` map when provided.
 */
export function applyBookedOddsEnrich(
  db: Database,
  bookId: string,
  candidates: Array<{
    inventoryId: string;
    home: string | null;
    away: string | null;
    sport?: string | null;
    league?: string | null;
  }>,
  catalog: BookedMatchEntry[],
  options: {
    dryRun?: boolean;
    nowMs?: number | undefined;
    /** Optional map inventoryId → SkinEventRow to stamp oddsEventId in memory */
    touch?: Map<string, SkinEventRow>;
  } = {}
): number {
  const dryRun = options.dryRun === true;
  const ts = options.nowMs ?? Date.now();
  const update = dryRun
    ? null
    : db.query(`
    UPDATE skin_events
    SET odds_event_id = $cid, last_updated = $ts
    WHERE book_id = $book AND inventory_id = $iid
      AND (odds_event_id IS NULL OR odds_event_id = '')
  `);
  let enriched = 0;
  for (const row of candidates) {
    const cid = matchBookedOddsEventId(row.home, row.away, catalog, {
      ...(row.sport !== undefined ? { sport: row.sport } : {}),
      ...(row.league !== undefined ? { league: row.league } : {}),
    });
    if (!cid) continue;
    if (update) {
      update.run({
        $cid: cid,
        $ts: ts,
        $book: bookId,
        $iid: row.inventoryId,
      });
    }
    const touchRow = options.touch?.get(row.inventoryId);
    if (touchRow) touchRow.oddsEventId = cid;
    enriched++;
  }
  return enriched;
}

/** Plan insert vs update without writing (same stamps as upsertSkinLiveEvents). */
export function planInventoryUpsert(
  db: Database,
  events: InventoryEvent[],
  options: {
    nowMs?: number | undefined;
    identity?: InventoryIdentity | undefined;
  } = {}
): SkinEventUpsertResult {
  return upsertSkinLiveEvents(db, events, {
    dryRun: true,
    ...(options.nowMs !== undefined ? { nowMs: options.nowMs } : {}),
    ...(options.identity !== undefined ? { identity: options.identity } : {}),
  });
}

export async function runInventorySync(
  db: Database,
  adapter: FantasySessionAdapter,
  options: InventorySyncOptions = {}
): Promise<InventorySyncReport> {
  // --sport accepts single, CSV multi (spaces OK), or all
  const sportSel = parseInventorySportsCsv(options.sport ?? 'table_tennis');
  const sport = formatInventorySportSelection(sportSel);
  const dryRun = options.dryRun === true;
  const enrichOnly = options.enrichOnly === true;
  const notes: string[] = [];
  if (dryRun) {
    notes.push('dry-run: no SQLite writes (plan only)');
  }
  if (enrichOnly) {
    notes.push('enrich-only: skip stream poll');
  }
  const fetchSport = resolveInventoryFetchSport(sportSel);
  if (sportSel.kind === 'sports' && sportSel.sports.length > 1) {
    notes.push(`multi-sport: fetch=all filter=${sport}`);
  }

  const identity = options.identity ?? buckeyeInventoryIdentity();

  let events: InventoryEvent[] = [];
  let upsert: SkinEventUpsertResult = { inserted: [], updated: [], seen: 0 };

  if (!enrichOnly) {
    // Inventory does not require login
    events = await adapter.fetchInventory({
      sport: fetchSport,
    });
    events = filterLiveEventsBySports(events, sportSel);

    if (!dryRun) {
      normalizeSkinEventsSports(db);
    }

    upsert = dryRun
      ? planInventoryUpsert(db, events, { nowMs: options.nowMs, identity })
      : upsertSkinLiveEvents(db, events, {
          ...(options.nowMs !== undefined ? { nowMs: options.nowMs } : {}),
          identity,
        });
  }

  let enriched = 0;
  let enrichCandidates = 0;
  let enrichValidation: EnrichValidation | null = null;
  let enrichQuality: EnrichQualityReport | null = null;
  const wantEnrich = options.enrichBooked === true || enrichOnly;
  const enrichScope: EnrichBookedScope | null = wantEnrich
    ? (options.enrichBookedScope ?? (enrichOnly ? 'unlinked' : 'board'))
    : null;

  if (wantEnrich && enrichScope) {
    const t0 = Date.now();
    try {
      const { enrichLog } = await import('./enrich-log.ts');
      const { catalogFetchSportFilter } = await import('./booked-match.ts');
      // Candidate sport scoping is separate (filterEnrichCandidatesBySport).
      // Prefer a **wide** public catalog — narrowing Statscore by sport starved tennis
      // match rates (hundreds of rows vs full board). Adapter list still sport-hinted.
      const candidateSport = inventorySportForCatalogFetch(sportSel);
      const catalogSportFilter = catalogFetchSportFilter(candidateSport);
      let catalog: BookedMatchEntry[] = [];
      let catalogSource = 'injected';
      // Defined array (even empty) skips public Statscore fetch — tests / offline.
      if (options.bookedCatalog != null) {
        catalog = options.bookedCatalog;
      } else {
        const { fetchPublicBookedCatalog, bookedCatalogToMatchList } =
          await import('./booked-catalog.ts');
        const pub = await fetchPublicBookedCatalog({
          maxEvents: options.enrichCatalogMax ?? 2000,
          maxPages: 40,
          // Full catalog when enrich-only or multi-sport; single-sport poll keeps hint
          ...(enrichOnly || (sportSel.kind === 'sports' && sportSel.sports.length > 1) || catalogSportFilter === undefined
            ? {}
            : { sport: catalogSportFilter }),
        });
        const byId = new Map(
          bookedCatalogToMatchList(pub.entries).map(e => [e.oddsEventId, e] as const)
        );
        try {
          const booked = await adapter.listBookedEvents({
            limit: 200,
            ...(catalogSportFilter !== undefined ? { sport: catalogSportFilter } : {}),
          });
          for (const b of booked) {
            byId.set(b.oddsEventId, {
              oddsEventId: b.oddsEventId,
              name: b.name,
              sportName: b.sportName,
              competition: b.competition,
            });
          }
        } catch {
          /* public/cache catalog is enough */
        }
        catalog = [...byId.values()];
        catalogSource = `${pub.source} pages=${pub.pages} totalHint=${pub.totalItemsHint ?? '?'}${
          pub.errors.length ? ` errs=${pub.errors.length}` : ''
        }${
          enrichOnly || (sportSel.kind === 'sports' && sportSel.sports.length > 1)
            ? ' catalogSport=all'
            : catalogSportFilter
              ? ` catalogSport=${catalogSportFilter}`
              : ''
        }`;
      }
      let candidates = collectBoardEnrichCandidates(
        upsert,
        db,
        identity.bookId,
        enrichScope,
        { limit: options.enrichLimit }
      );
      // Map-lane sport CSV: only attempt rows in selected sports
      candidates = filterEnrichCandidatesBySport(candidates, sportSel);
      if (
        options.enrichLimit != null &&
        Number.isFinite(options.enrichLimit) &&
        candidates.length > options.enrichLimit
      ) {
        candidates = candidates.slice(0, Math.floor(options.enrichLimit));
      }
      enrichCandidates = candidates.length;
      if (options.enrichLimit != null) {
        notes.push(
          `enrich batch limit=${options.enrichLimit} candidates=${enrichCandidates}`
        );
      }
      const touch = new Map<string, SkinEventRow>();
      for (const r of [...upsert.inserted, ...upsert.updated]) {
        touch.set(r.inventoryId, r);
      }
      enriched = applyBookedOddsEnrich(db, identity.bookId, candidates, catalog, {
        dryRun,
        nowMs: options.nowMs,
        touch,
      });
      const { validateEnrichmentResult, formatEnrichValidation } = await import(
        './enrich-validate.ts'
      );
      const {
        buildEnrichQualityReport,
        formatEnrichQuality,
      } = await import('./enrich-quality.ts');
      // Book fill-rate always measured (even dry-run) — quality of current book state.
      enrichValidation = validateEnrichmentResult(db, identity.bookId, {
        candidates: enrichCandidates,
        matched: enriched,
        // Fail hard only when catalog empty (match path dead), not on name-miss alone.
        requireAnyMatchWhenCandidates: catalog.length === 0,
        ...(options.minLinkedPct != null
          ? { maxUnlinkedRatio: 1 - options.minLinkedPct / 100 }
          : {}),
      });
      if (catalog.length === 0 && enrichCandidates > 0) {
        enrichValidation.errors.push(
          'catalog empty — live fetch failed and no usable cache'
        );
        enrichValidation.passed = false;
      }
      enrichQuality = buildEnrichQualityReport(candidates, catalog, {
        linkedPct: enrichValidation.oddsLink?.linkedPct ?? null,
        gates: {
          ...(options.minMatchRate !== undefined ? { minMatchRate: options.minMatchRate } : {}),
          ...(options.minLinkedPct !== undefined ? { minLinkedPct: options.minLinkedPct } : {}),
          // Name-miss alone is expected; only gate when minMatchRate set or catalog empty.
          requireAnyMatchWhenCandidates: false,
        },
      });
      // Prefer quality report match count when it diverges (should not).
      if (enrichQuality.matched !== enriched && !dryRun) {
        notes.push(
          `enrich quality matched=${enrichQuality.matched} vs apply=${enriched} (diagnose vs write path)`
        );
      }
      notes.push(
        dryRun
          ? `booked enrich (dry-run, scope=${enrichScope}): would match ${enriched}/${enrichCandidates} by name (catalog=${catalog.length} via ${catalogSource})`
          : `booked enrich (scope=${enrichScope}): matched ${enriched}/${enrichCandidates} by name (catalog=${catalog.length} via ${catalogSource}; metadata only — no prices)`
      );
      notes.push(formatEnrichValidation(enrichValidation));
      notes.push(formatEnrichQuality(enrichQuality));
      enrichLog(enrichQuality.passed ? 'info' : 'warn', 'enrich_tick', {
        scope: enrichScope,
        dryRun,
        matched: enriched,
        candidates: enrichCandidates,
        matchRate: enrichQuality.matchRate,
        catalogSize: catalog.length,
        catalogSource,
        latencyMs: Date.now() - t0,
        validationPassed: enrichValidation.passed,
        qualityPassed: enrichQuality.passed,
        unlinkedRemaining: enrichValidation.unlinkedRemaining,
        byReason: enrichQuality.byReason,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      notes.push(`booked enrich skipped: ${msg}`);
      const { enrichLog } = await import('./enrich-log.ts');
      enrichLog('error', 'enrich_tick_failed', {
        scope: enrichScope,
        error: msg,
        latencyMs: Date.now() - t0,
      });
      const { validateEnrichmentResult, formatEnrichValidation } = await import(
        './enrich-validate.ts'
      );
      const { emptyEnrichQuality } = await import('./enrich-quality.ts');
      enrichValidation = validateEnrichmentResult(db, identity.bookId, {
        candidates: enrichCandidates,
        matched: 0,
        requireAnyMatchWhenCandidates: true,
      });
      enrichValidation.errors.unshift(`catalog/enrich failed: ${msg}`);
      enrichValidation.passed = false;
      enrichQuality = emptyEnrichQuality(0);
      enrichQuality.passed = false;
      enrichQuality.errors = [`catalog/enrich failed: ${msg}`];
      notes.push(formatEnrichValidation(enrichValidation));
    }
  }

  const store = resolveCoefficientStore(adapter, options);
  const pricedEventCount = store?.pricedEventCount() ?? 0;
  const pricedLineCount = store?.lineCount() ?? 0;
  const pricedOdds = pricedEventCount > 0;
  if (pricedOdds) {
    notes.push(
      `priced odds: Pandora store has ${pricedEventCount} event(s), ${pricedLineCount} line(s) (ML via fetchMarkets; no liquidity merge)`
    );
  } else {
    notes.push(
      'priced odds: not available from stream-list or Statscore livescorepro; Pandora store empty'
    );
  }
  notes.push('placeBet POST: still unmapped (ticket response parser ready)');
  notes.push(
    pricedOdds
      ? 'liquidity:ground merge: deferred (priced book in store only)'
      : 'liquidity:ground merge: deferred until priced markets exist'
  );

  const sportHistogram = sportHistogramFromEvents(
    upsert.inserted.length + upsert.updated.length > 0
      ? [...upsert.inserted, ...upsert.updated]
      : events
  );
  const newBySport = sportHistogramFromEvents(upsert.inserted);
  const coversLiveProducts = liveProductsCoveredByInventory(identity.skinId).map(String);

  // Durable league registry (event ids churn; league labels recur)
  const leagueSource =
    upsert.inserted.length + upsert.updated.length > 0
      ? [...upsert.inserted, ...upsert.updated]
      : events;
  const leagues = upsertInventoryLeagues(db, leagueSource, {
    ...(options.nowMs !== undefined ? { nowMs: options.nowMs } : {}),
    identity,
    dryRun,
  });
  if (leagues.inserted > 0) {
    notes.push(
      dryRun
        ? `leagues dry-run: would add ${leagues.inserted} new league(s) (${leagues.seen} on board)`
        : `leagues: +${leagues.inserted} new, ${leagues.updated} refreshed (${leagues.seen} on board)`
    );
  } else {
    notes.push(
      dryRun
        ? `leagues dry-run: ${leagues.seen} on board, 0 new`
        : `leagues: ${leagues.seen} on board, 0 new (${leagues.updated} refreshed)`
    );
  }

  // Always surface book fill-rate (dry-run included) for enrich quality loop.
  const oddsLink = oddsLinkCoverage(db, identity.bookId);
  if (oddsLink) {
    notes.push(formatOddsLinkCoverage(oddsLink));
  }

  return {
    sport,
    seen: upsert.seen,
    inserted: upsert.inserted.length,
    updated: upsert.updated.length,
    newEvents: upsert.inserted,
    updatedEvents: upsert.updated,
    enriched,
    enrichCandidates,
    enrichBookedScope: enrichScope,
    pricedEventCount,
    pricedLineCount,
    oddsLink,
    enrichValidation,
    enrichQuality,
    dryRun,
    coversLiveProducts,
    sportHistogram,
    newBySport,
    leagues,
    capabilities: {
      inventory: true,
      eventDetection: true,
      bookedMetadata: options.enrichBooked === true,
      pricedOdds,
      placeBetRequest: false,
      liquidityMerge: false,
    },
    notes,
  };
}

export function formatSyncReport(report: InventorySyncReport): string {
  const mode = report.dryRun ? 'inventory:sync --dry-run' : 'inventory:sync';
  const covers =
    report.coversLiveProducts.length > 0
      ? ` covers=${report.coversLiveProducts.join('+')}`
      : '';
  const lines = [
    `${mode} sport=${report.sport} seen=${report.seen} new=${report.inserted} updated=${report.updated} enriched=${report.enriched}${covers}`,
    `  sports: ${formatSportHistogram(report.sportHistogram)}`,
  ];
  if (report.inserted > 0) {
    lines.push(`  newBySport: ${formatSportHistogram(report.newBySport)}`);
  }
  if (report.enrichBookedScope) {
    lines.push(
      `  enrich: scope=${report.enrichBookedScope} matched=${report.enriched}/${report.enrichCandidates}` +
        (report.capabilities.pricedOdds
          ? ` · pandora events=${report.pricedEventCount} lines=${report.pricedLineCount}`
          : ' · pandora empty')
    );
  } else if (report.pricedEventCount > 0) {
    lines.push(
      `  priced: pandora events=${report.pricedEventCount} lines=${report.pricedLineCount}`
    );
  }
  if (report.oddsLink) {
    lines.push(`  ${formatOddsLinkCoverage(report.oddsLink)}`);
  }
  if (report.enrichValidation) {
    lines.push(`  ${formatEnrichValidation(report.enrichValidation)}`);
  }
  if (report.enrichQuality) {
    for (const line of formatEnrichQuality(report.enrichQuality).split('\n')) {
      lines.push(`  ${line}`);
    }
  }
  lines.push(
    `  leagues: seen=${report.leagues.seen} new=${report.leagues.inserted} updated=${report.leagues.updated}`
  );
  if (report.leagues.newLeagues.length > 0) {
    lines.push(
      ...report.leagues.newLeagues
        .slice(0, 12)
        .map(l => `  +L ${formatLeagueLine(l)}`)
    );
    if (report.leagues.newLeagues.length > 12) {
      lines.push(`  +L … ${report.leagues.newLeagues.length - 12} more leagues`);
    }
  }
  lines.push(
    ...report.newEvents.map(e => `  + ${formatSkinEventLine(e)}`),
    ...(report.dryRun && report.updatedEvents && report.updatedEvents.length > 0
      ? report.updatedEvents
          .slice(0, 20)
          .map(e => `  ~ ${formatSkinEventLine(e)}`)
          .concat(
            report.updatedEvents.length > 20
              ? [`  ~ … ${report.updatedEvents.length - 20} more would update`]
              : []
          )
      : []),
    ...report.notes.map(n => `  · ${n}`)
  );
  return lines.join('\n');
}
