// @see https://bun.com/docs/runtime/sqlite
/**
 * Partner inventory sync — ground-truth pipeline.
 *
 * REAL today:
 *  - stream-list-v2 → partner_events (detect new stream_ids)
 *  - optional soft enrich: Statscore booked-events list by name match → client_event_id
 *
 * NOT real yet (do not invent):
 *  - markets / lines / American odds from stream-list or livescorepro booked-events
 *  - placeOrder POST
 *  - merge into Kalshi match_liquidity
 */
import type { Database } from "bun:sqlite";
import type { FantasySessionAdapter, PartnerLiveEvent } from "./types.ts";
import {
  filterLiveEventsBySport,
  formatPartnerEventLine,
  upsertPartnerLiveEvents,
  type PartnerEventRow,
  type PartnerEventUpsertResult,
} from "./partner-events-store.ts";

export type PartnerSyncOptions = {
  sport?: string;
  /** Soft-match Statscore booked names for NEW rows only (metadata, not odds). */
  enrichBooked?: boolean;
  nowMs?: number;
};

export type PartnerSyncReport = {
  sport: string;
  seen: number;
  inserted: number;
  updated: number;
  newEvents: PartnerEventRow[];
  enriched: number;
  capabilities: {
    inventory: true;
    eventDetection: true;
    bookedMetadata: boolean;
    pricedOdds: false;
    placeBetRequest: false;
    liquidityMerge: false;
  };
  notes: string[];
};

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Soft match "Home vs Away" inventory to Statscore "Home - Away" booked name.
 */
export function matchBookedClientEventId(
  home: string | null,
  away: string | null,
  booked: Array<{ clientEventId: string; name: string }>,
): string | null {
  if (!home || !away || booked.length === 0) return null;
  const h = normalizeName(home);
  const a = normalizeName(away);
  for (const b of booked) {
    const n = normalizeName(b.name);
    if (n.includes(h) && n.includes(a)) return b.clientEventId;
  }
  return null;
}

export async function runPartnerInventorySync(
  db: Database,
  adapter: FantasySessionAdapter,
  options: PartnerSyncOptions = {},
): Promise<PartnerSyncReport> {
  const sport = options.sport ?? "table_tennis";
  const notes: string[] = [];
  const fetchSport =
    sport === "all"
      ? "all"
      : sport.replace(/\s+/g, "_").toLowerCase() === "table_tennis" ||
          sport.toLowerCase() === "table tennis"
        ? "table_tennis"
        : sport.replace(/\s+/g, "_").toLowerCase() === "tennis"
          ? "tennis"
          : sport.replace(/\s+/g, "_").toLowerCase();

  // Inventory does not require login
  let events: PartnerLiveEvent[] = await adapter.fetchEvents({
    sport: fetchSport === "all" ? "all" : fetchSport,
  });
  if (sport !== "all") {
    events = filterLiveEventsBySport(events, sport);
  }

  const upsert: PartnerEventUpsertResult = upsertPartnerLiveEvents(db, events, {
    nowMs: options.nowMs,
  });

  let enriched = 0;
  if (options.enrichBooked && upsert.inserted.length > 0) {
    try {
      const sportFilter =
        sport.toLowerCase().includes("table")
          ? "table"
          : sport === "all"
            ? undefined
            : sport;
      const booked = await adapter.listBookedEvents({
        sport: sportFilter,
        limit: 100,
      });
      const catalog = booked.map((b) => ({
        clientEventId: b.clientEventId,
        name: b.name,
      }));
      const update = db.query(`
        UPDATE partner_events
        SET client_event_id = $cid, last_updated = $ts
        WHERE partner = $partner AND stream_id = $sid AND (client_event_id IS NULL OR client_event_id = '')
      `);
      const ts = options.nowMs ?? Date.now();
      for (const row of upsert.inserted) {
        const cid = matchBookedClientEventId(row.home, row.away, catalog);
        if (!cid) continue;
        update.run({
          $cid: cid,
          $ts: ts,
          $partner: row.partner,
          $sid: row.streamId,
        });
        row.clientEventId = cid;
        enriched++;
      }
      notes.push(
        `booked enrich: matched ${enriched}/${upsert.inserted.length} new rows by name (metadata only — no prices)`,
      );
    } catch (err) {
      notes.push(
        `booked enrich skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else if (options.enrichBooked) {
    notes.push("booked enrich: no new rows to match");
  }

  notes.push(
    "priced odds: not available from stream-list or Statscore livescorepro",
  );
  notes.push("placeBet POST: still unmapped (ticket response parser ready)");
  notes.push("liquidity:ground merge: deferred until priced markets exist");

  return {
    sport,
    seen: upsert.seen,
    inserted: upsert.inserted.length,
    updated: upsert.updated.length,
    newEvents: upsert.inserted,
    enriched,
    capabilities: {
      inventory: true,
      eventDetection: true,
      bookedMetadata: options.enrichBooked === true,
      pricedOdds: false,
      placeBetRequest: false,
      liquidityMerge: false,
    },
    notes,
  };
}

export function formatSyncReport(report: PartnerSyncReport): string {
  const lines = [
    `partner sync sport=${report.sport} seen=${report.seen} new=${report.inserted} updated=${report.updated} enriched=${report.enriched}`,
    ...report.newEvents.map((e) => `  + ${formatPartnerEventLine(e)}`),
    ...report.notes.map((n) => `  · ${n}`),
  ];
  return lines.join("\n");
}
