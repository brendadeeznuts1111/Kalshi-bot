// @see https://bun.com/docs/runtime/sqlite
/**
 * Persist partner stream inventory (Fantasy402 stream-list) and detect new rows.
 */
import type { Database } from "bun:sqlite";
import type { PartnerLiveEvent } from "./types.ts";

export type PartnerEventRow = {
  partner: string;
  streamId: string;
  lsId: string | null;
  clientEventId: string | null;
  sport: string;
  league: string;
  home: string | null;
  away: string | null;
  feedId: string | null;
  startTime: number | null;
  status: string;
  firstSeen: number;
  lastUpdated: number;
};

export type PartnerEventUpsertResult = {
  inserted: PartnerEventRow[];
  updated: PartnerEventRow[];
  seen: number;
};

export function listPartnerStreamIds(
  db: Database,
  partner: string,
): Set<string> {
  const rows = db
    .query(
      `SELECT stream_id AS streamId FROM partner_events WHERE partner = $p`,
    )
    .all({ $p: partner }) as Array<{ streamId: string }>;
  return new Set(rows.map((r) => String(r.streamId)));
}

export function liveEventToRow(
  event: PartnerLiveEvent,
  nowMs: number,
  existing?: { firstSeen: number; status?: string },
): PartnerEventRow {
  const streamId =
    event.streamId != null
      ? String(event.streamId)
      : String(event.eventId || "");
  return {
    partner: event.partner,
    streamId,
    lsId: null,
    clientEventId: null,
    sport: event.sport,
    league: event.league,
    home: event.home,
    away: event.away,
    feedId: event.feedId != null ? String(event.feedId) : null,
    startTime: null,
    status: existing?.status ?? "unknown",
    firstSeen: existing?.firstSeen ?? nowMs,
    lastUpdated: nowMs,
  };
}

/**
 * Upsert live inventory rows. Returns which stream_ids were newly inserted.
 */
export function upsertPartnerLiveEvents(
  db: Database,
  events: PartnerLiveEvent[],
  options: { nowMs?: number } = {},
): PartnerEventUpsertResult {
  const nowMs = options.nowMs ?? Date.now();
  const insert = db.query(`
    INSERT INTO partner_events (
      partner, stream_id, ls_id, client_event_id, sport, league, home, away,
      feed_id, start_time, status, first_seen, last_updated
    ) VALUES (
      $partner, $stream_id, $ls_id, $client_event_id, $sport, $league, $home, $away,
      $feed_id, $start_time, $status, $first_seen, $last_updated
    )
    ON CONFLICT(partner, stream_id) DO UPDATE SET
      sport = excluded.sport,
      league = excluded.league,
      home = excluded.home,
      away = excluded.away,
      feed_id = excluded.feed_id,
      last_updated = excluded.last_updated
  `);

  const inserted: PartnerEventRow[] = [];
  const updated: PartnerEventRow[] = [];

  const partnerSets = new Map<string, Set<string>>();
  const getSet = (partner: string) => {
    let s = partnerSets.get(partner);
    if (!s) {
      s = listPartnerStreamIds(db, partner);
      partnerSets.set(partner, s);
    }
    return s;
  };

  for (const event of events) {
    const set = getSet(event.partner);
    const streamId =
      event.streamId != null
        ? String(event.streamId)
        : String(event.eventId || "");
    if (!streamId) continue;
    const isNew = !set.has(streamId);
    const row = liveEventToRow(event, nowMs, {
      firstSeen: nowMs,
      status: "unknown",
    });
    insert.run({
      $partner: row.partner,
      $stream_id: row.streamId,
      $ls_id: row.lsId,
      $client_event_id: row.clientEventId,
      $sport: row.sport,
      $league: row.league,
      $home: row.home,
      $away: row.away,
      $feed_id: row.feedId,
      $start_time: row.startTime,
      $status: row.status,
      $first_seen: row.firstSeen,
      $last_updated: row.lastUpdated,
    });
    if (isNew) {
      set.add(streamId);
      inserted.push(row);
    } else {
      updated.push(row);
    }
  }

  return { inserted, updated, seen: events.length };
}

/** Filter PartnerLiveEvent by sport (table tennis, tennis, …). */
export function filterLiveEventsBySport(
  events: PartnerLiveEvent[],
  sport: string,
): PartnerLiveEvent[] {
  const want = sport.trim().toLowerCase().replace(/_/g, " ");
  if (!want || want === "all") return events;
  return events.filter((e) => {
    const s = e.sport.toLowerCase().replace(/_/g, " ");
    if (want === "table tennis" || want === "tabletennis") {
      return s.includes("table tennis") || s === "table tennis";
    }
    if (want === "tennis") {
      // exact tennis, not table tennis
      return s === "tennis" || (s.includes("tennis") && !s.includes("table"));
    }
    return s === want || s.includes(want);
  });
}

export function formatPartnerEventLine(row: PartnerEventRow): string {
  const matchup = [row.home, row.away].filter(Boolean).join(" vs ") || "TBD";
  return `${row.sport} · ${row.league || "—"} · ${matchup} · stream=${row.streamId}`;
}
