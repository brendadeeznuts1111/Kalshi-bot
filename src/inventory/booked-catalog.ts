/**
 * Public Statscore booked-events catalog (livescorepro) — no Fantasy login.
 * Used to soft-link skin_events.odds_event_id by competitor name.
 * Does **not** carry prices (metadata only).
 */
// @see https://bun.com/docs/api/fetch
import { parseStatscoreBookedEvents } from '../partner/fantasy-ultra/parse.ts';
import { FANTASY_ULTRA_DEFAULTS } from '../partner/fantasy-ultra/types.ts';
import type { PartnerBookedEvent } from '../partner/types.ts';

export type BookedCatalogEntry = {
  oddsEventId: string;
  name: string;
  sportName: string;
};

export type FetchBookedCatalogOptions = {
  /** Max events to collect (default 800, max 2500). */
  maxEvents?: number;
  /** Max HTTP pages (default 20). */
  maxPages?: number;
  /** Optional sport name filter (case-insensitive includes). */
  sport?: string;
  fetchImpl?: typeof fetch;
};

function catalogHeaders(): Record<string, string> {
  return {
    accept: 'application/json, text/plain, */*',
    origin: FANTASY_ULTRA_DEFAULTS.streamOrigin,
    referer: FANTASY_ULTRA_DEFAULTS.streamReferer,
  };
}

function firstPageUrl(): string {
  const q = new URLSearchParams({
    client_id: FANTASY_ULTRA_DEFAULTS.statscoreClientId,
    product: FANTASY_ULTRA_DEFAULTS.statscoreProduct,
    events_details: 'yes',
    lang: 'en',
  });
  return `${FANTASY_ULTRA_DEFAULTS.statscoreBookedEventsUrl}?${q.toString()}`;
}

function nextPageUrl(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const np = (raw as { api?: { method?: { next_page?: unknown } } }).api?.method
    ?.next_page;
  if (typeof np !== 'string' || !np.trim()) return null;
  const s = np.trim();
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  return null;
}

/**
 * Paginate public booked-events into a name→oddsEventId catalog.
 */
export async function fetchPublicBookedCatalog(
  options: FetchBookedCatalogOptions = {}
): Promise<{
  entries: BookedCatalogEntry[];
  pages: number;
  totalItemsHint: number | null;
}> {
  const maxEvents = Math.min(Math.max(options.maxEvents ?? 800, 1), 2500);
  const maxPages = Math.min(Math.max(options.maxPages ?? 20, 1), 50);
  const fetchImpl = options.fetchImpl ?? fetch;
  const want = options.sport?.trim().toLowerCase();
  const byId = new Map<string, BookedCatalogEntry>();
  let url: string | null = firstPageUrl();
  let pages = 0;
  let totalItemsHint: number | null = null;

  while (url && pages < maxPages && byId.size < maxEvents) {
    const res = await fetchImpl(url, { headers: catalogHeaders() });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `booked-catalog: HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ''}`
      );
    }
    const raw: unknown = await res.json();
    if (totalItemsHint == null && raw && typeof raw === 'object') {
      const t = (raw as { api?: { method?: { total_items?: unknown } } }).api
        ?.method?.total_items;
      if (typeof t === 'number' && Number.isFinite(t)) totalItemsHint = t;
      else if (typeof t === 'string' && t.trim()) totalItemsHint = Number(t) || null;
    }
    const rows = parseStatscoreBookedEvents(raw);
    for (const r of rows) {
      if (want && want !== 'all') {
        const sn = r.sportName.toLowerCase();
        if (sn !== want && !sn.includes(want)) continue;
      }
      byId.set(r.oddsEventId, {
        oddsEventId: r.oddsEventId,
        name: r.name,
        sportName: r.sportName,
      });
      if (byId.size >= maxEvents) break;
    }
    pages++;
    url = nextPageUrl(raw);
  }

  return {
    entries: [...byId.values()],
    pages,
    totalItemsHint,
  };
}

export function bookedCatalogToMatchList(
  entries: BookedCatalogEntry[]
): Array<{ oddsEventId: string; name: string }> {
  return entries.map(e => ({ oddsEventId: e.oddsEventId, name: e.name }));
}

/** Adapter-shaped rows → catalog entries. */
export function partnerBookedToCatalog(
  rows: PartnerBookedEvent[]
): BookedCatalogEntry[] {
  return rows.map(r => ({
    oddsEventId: r.oddsEventId,
    name: r.name,
    sportName: r.sportName,
  }));
}
