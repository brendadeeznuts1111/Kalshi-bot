/**
 * Map-lane: resolve unmapped inventory_leagues → existing COMPETITIONS seeds.
 *
 * Exact hits via {@link resolveCompetition} (confidence 1.0). Soft suggestions
 * via normalized / token overlap (never auto-applied below threshold).
 * Does not mint new seeds — use `inventory:leagues --promote` for that.
 */
// @see https://bun.com/docs/runtime/sqlite
import type { Database } from 'bun:sqlite';
import {
  COMPETITIONS,
  matchLeagueKey,
  normalizeLeagueKey,
  type CompetitionRecord,
} from '../domain/competitions.ts';
import { resolveCompetition } from '../domain/resolve-competition.ts';
import { isSportId } from '../domain/sports.ts';
import {
  ensureInventoryLeaguesSchema,
  listInventoryLeagues,
  type InventoryLeagueRow,
} from './leagues.ts';
import {
  buckeyeInventoryIdentity,
  parseInventorySportsCsv,
} from './skin-events-store.ts';

export type LeagueResolveMatchKind =
  | 'exact'
  | 'normalized'
  | 'fuzzy'
  | 'none';

export type LeagueResolveSuggestion = {
  bookId: string;
  inventoryBucket: string;
  sportId: string;
  leagueKey: string;
  leagueKeyNorm: string;
  peakEventCount: number;
  eventCountLive: number;
  suggestedCompetitionId: string | null;
  suggestedDisplayName: string | null;
  confidence: number;
  matchKind: LeagueResolveMatchKind;
};

export type LeagueResolvePlan = {
  threshold: number;
  unmappedInput: number;
  suggestions: LeagueResolveSuggestion[];
  /** confidence >= threshold and has competition id */
  autoApply: LeagueResolveSuggestion[];
  /** 0 < confidence < threshold */
  review: LeagueResolveSuggestion[];
  none: LeagueResolveSuggestion[];
};

type PlanLeagueResolveOptions = {
  bookId?: string;
  /** Single sport, CSV multi, or all (default unmapped all sports). */
  sport?: string;
  limit?: number;
  /** Auto-apply cutoff (0–1). Default 0.9. */
  threshold?: number;
  /** Prefer live / peak first. */
  orderBy?: 'last_seen' | 'peak';
};

/** Strip common circuit/competition noise for soft compare. */
export function stripLeagueNoise(raw: string): string {
  return matchLeagueKey(raw)
    .replace(
      /\b(atp|wta|itf|men|women|mens|womens|men's|women's|league|cup|series|championship|premier|division|pro|open|tour|challenger|masters)\b/g,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenJaccard(a: string, b: string): number {
  const ta = new Set(a.split(/\s+/).filter(t => t.length > 1));
  const tb = new Set(b.split(/\s+/).filter(t => t.length > 1));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) {
    if (tb.has(t)) inter += 1;
  }
  return inter / (ta.size + tb.size - inter);
}

function competitionKeys(comp: CompetitionRecord): string[] {
  const keys = [
    comp.displayName,
    comp.providerMappings.plive?.leagueKey,
    ...comp.aliases,
  ].filter((k): k is string => Boolean(k && k.trim()));
  return keys;
}

/** matchLeagueKey + collapse hyphens (ATP - Cincinnati ≡ ATP Cincinnati). */
export function softLeagueKey(raw: string): string {
  return matchLeagueKey(raw)
    .replace(/[-–—]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Score one unmapped league against one competition seed (same sport only).
 * - exact/alias (`matchLeagueKey` / soft hyphen fold) → 1.0 / 0.98 (auto at 0.9)
 * - containment / token jaccard → ≤0.89 (review only; never auto at default 0.9)
 *
 * Noise stripping is **only** for fuzzy jaccard — never for equality (avoids
 * "Setka" ≡ "Setka Cup" or "Argentina" ≡ "Masters. Argentina").
 */
export function scoreLeagueAgainstCompetition(
  leagueKey: string,
  comp: CompetitionRecord
): { confidence: number; matchKind: LeagueResolveMatchKind } {
  const ln = matchLeagueKey(leagueKey);
  if (!ln) return { confidence: 0, matchKind: 'none' };
  const softLn = softLeagueKey(leagueKey);

  for (const k of competitionKeys(comp)) {
    if (matchLeagueKey(k) === ln) {
      return { confidence: 1, matchKind: 'exact' };
    }
  }

  for (const k of competitionKeys(comp)) {
    if (softLeagueKey(k) === softLn && softLn.length >= 4) {
      return { confidence: 0.98, matchKind: 'normalized' };
    }
  }

  // Containment is review-only (e.g. "Chile LNB" vs "Chile LNB Cup")
  for (const k of competitionKeys(comp)) {
    const kn = softLeagueKey(k);
    if (!kn) continue;
    const shorter = kn.length <= softLn.length ? kn : softLn;
    const longer = kn.length <= softLn.length ? softLn : kn;
    if (shorter.length >= 6 && longer.includes(shorter)) {
      return { confidence: 0.85, matchKind: 'normalized' };
    }
  }

  const strippedLeague = stripLeagueNoise(leagueKey);
  let best = 0;
  for (const k of competitionKeys(comp)) {
    const j = tokenJaccard(strippedLeague, stripLeagueNoise(k));
    if (j > best) best = j;
  }
  if (best >= 0.55) {
    // Cap below default threshold so fuzzy never auto-applies at 0.9
    const confidence = Math.min(0.89, 0.45 + best * 0.45);
    return { confidence, matchKind: 'fuzzy' };
  }
  return { confidence: 0, matchKind: 'none' };
}

function bestSoftSuggestion(
  row: InventoryLeagueRow
): Pick<
  LeagueResolveSuggestion,
  | 'suggestedCompetitionId'
  | 'suggestedDisplayName'
  | 'confidence'
  | 'matchKind'
> {
  const sport = row.sportId.trim();
  if (!isSportId(sport)) {
    return {
      suggestedCompetitionId: null,
      suggestedDisplayName: null,
      confidence: 0,
      matchKind: 'none',
    };
  }

  let best: {
    conf: number;
    kind: LeagueResolveMatchKind;
    id: string;
    name: string;
  } | null = null;

  for (const comp of COMPETITIONS) {
    if (comp.sportId !== sport) continue;
    if (!comp.providerMappings.plive) continue;
    const { confidence, matchKind } = scoreLeagueAgainstCompetition(
      row.leagueKey,
      comp
    );
    if (confidence <= 0) continue;
    if (
      !best ||
      confidence > best.conf ||
      (confidence === best.conf && comp.id.localeCompare(best.id) < 0)
    ) {
      best = {
        conf: confidence,
        kind: matchKind,
        id: comp.id,
        name: comp.displayName,
      };
    }
  }

  if (!best) {
    return {
      suggestedCompetitionId: null,
      suggestedDisplayName: null,
      confidence: 0,
      matchKind: 'none',
    };
  }
  return {
    suggestedCompetitionId: best.id,
    suggestedDisplayName: best.name,
    confidence: best.conf,
    matchKind: best.kind,
  };
}

function rowToSuggestion(row: InventoryLeagueRow): LeagueResolveSuggestion {
  const sport = row.sportId.trim();
  const exact = resolveCompetition({
    liveProduct: 'plive',
    league: row.leagueKey,
    sportId: isSportId(sport) ? sport : undefined,
    inventoryBucket: row.inventoryBucket || undefined,
  });

  if (exact) {
    return {
      bookId: row.bookId,
      inventoryBucket: row.inventoryBucket,
      sportId: row.sportId,
      leagueKey: row.leagueKey,
      leagueKeyNorm: row.leagueKeyNorm,
      peakEventCount: row.peakEventCount,
      eventCountLive: row.eventCountLive,
      suggestedCompetitionId: exact.competitionId,
      suggestedDisplayName: exact.competition.displayName,
      confidence: 1,
      matchKind: 'exact',
    };
  }

  const soft = bestSoftSuggestion(row);
  return {
    bookId: row.bookId,
    inventoryBucket: row.inventoryBucket,
    sportId: row.sportId,
    leagueKey: row.leagueKey,
    leagueKeyNorm: row.leagueKeyNorm,
    peakEventCount: row.peakEventCount,
    eventCountLive: row.eventCountLive,
    ...soft,
  };
}

function sportFilterAllows(rowSport: string, sportArg?: string): boolean {
  if (!sportArg || sportArg.trim() === '' || sportArg === 'all') return true;
  const sel = parseInventorySportsCsv(sportArg);
  if (sel.kind === 'all') return true;
  const id = rowSport.trim().toLowerCase();
  return sel.sports.includes(id);
}

/**
 * Plan competition_id stamps for unmapped inventory_leagues against current seeds.
 */
export function planInventoryLeagueResolve(
  db: Database,
  options: PlanLeagueResolveOptions = {}
): LeagueResolvePlan {
  ensureInventoryLeaguesSchema(db);
  const threshold = clampThreshold(options.threshold ?? 0.9);
  const limit = Math.min(Math.max(options.limit ?? 500, 1), 5000);
  const bookId = options.bookId ?? buckeyeInventoryIdentity().bookId;

  // Load unmapped (single-sport SQL when one token; multi filtered in memory)
  const sportArg = options.sport?.trim();
  const sel = sportArg ? parseInventorySportsCsv(sportArg) : { kind: 'all' as const };
  const sqlSport =
    sel.kind === 'sports' && sel.sports.length === 1 ? sel.sports[0] : undefined;

  const rows = listInventoryLeagues(db, {
    bookId,
    unmappedOnly: true,
    sportId: sqlSport,
    limit: 5000,
    orderBy: options.orderBy ?? 'peak',
  }).filter(r => sportFilterAllows(r.sportId, sportArg));

  const capped = rows.slice(0, limit);
  const suggestions = capped.map(rowToSuggestion);

  const autoApply: LeagueResolveSuggestion[] = [];
  const review: LeagueResolveSuggestion[] = [];
  const none: LeagueResolveSuggestion[] = [];

  for (const s of suggestions) {
    if (s.suggestedCompetitionId && s.confidence >= threshold) {
      autoApply.push(s);
    } else if (s.suggestedCompetitionId && s.confidence > 0) {
      review.push(s);
    } else {
      none.push(s);
    }
  }

  return {
    threshold,
    unmappedInput: suggestions.length,
    suggestions,
    autoApply,
    review,
    none,
  };
}

function clampThreshold(t: number): number {
  if (!Number.isFinite(t)) return 0.9;
  return Math.min(1, Math.max(0, t));
}

/**
 * Apply competition_id for suggestions that carry an id (typically autoApply).
 * Returns number of rows updated.
 */
export function applyInventoryLeagueResolve(
  db: Database,
  suggestions: LeagueResolveSuggestion[],
  options: { bookId?: string } = {}
): number {
  ensureInventoryLeaguesSchema(db);
  const book = options.bookId ?? buckeyeInventoryIdentity().bookId;
  const upd = db.query(
    `UPDATE inventory_leagues SET competition_id = $c
     WHERE book_id = $book
       AND inventory_bucket = $bucket
       AND league_key_norm = $norm
       AND (competition_id IS NULL OR competition_id = '')`
  );
  let n = 0;
  for (const s of suggestions) {
    if (!s.suggestedCompetitionId) continue;
    const r = upd.run({
      $c: s.suggestedCompetitionId,
      $book: book,
      $bucket: s.inventoryBucket,
      $norm: s.leagueKeyNorm || normalizeLeagueKey(s.leagueKey),
    });
    n += Number(r.changes) || 0;
  }
  return n;
}

export function formatLeagueResolveLine(s: LeagueResolveSuggestion): string {
  const conf = `${(s.confidence * 100).toFixed(0)}%`;
  const id = s.suggestedCompetitionId ?? '—';
  const name = s.suggestedDisplayName ? ` (${s.suggestedDisplayName})` : '';
  return (
    `${s.sportId} · ${s.leagueKey} · peak=${s.peakEventCount} · ` +
    `→ ${id}${name} · conf=${conf} · ${s.matchKind}`
  );
}

export function formatLeagueResolvePlan(plan: LeagueResolvePlan): string {
  const lines = [
    `inventory:leagues --resolve threshold=${plan.threshold} ` +
      `unmapped=${plan.unmappedInput} auto=${plan.autoApply.length} ` +
      `review=${plan.review.length} none=${plan.none.length}`,
  ];
  for (const s of plan.autoApply.slice(0, 40)) {
    lines.push(`  +R ${formatLeagueResolveLine(s)}`);
  }
  if (plan.autoApply.length > 40) {
    lines.push(`  … ${plan.autoApply.length - 40} more auto`);
  }
  for (const s of plan.review.slice(0, 15)) {
    lines.push(`  ?  ${formatLeagueResolveLine(s)}`);
  }
  if (plan.review.length > 15) {
    lines.push(`  … ${plan.review.length - 15} more review`);
  }
  if (plan.none.length > 0) {
    lines.push(`  none: ${plan.none.length} (promote candidates or junk)`);
  }
  return lines.join('\n');
}
