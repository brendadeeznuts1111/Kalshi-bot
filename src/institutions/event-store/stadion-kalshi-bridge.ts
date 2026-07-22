/**
 * Stadion ↔ Kalshi event bridge.
 *
 * Namespaces stay separate:
 *   Stadion → sha3(itf|stadion|{matchId})
 *   Kalshi  → competitor UUID pair (+ series + start) or ticker fallback
 *
 * Join key (singles): UTC day + sorted normalized last names + series lane.
 * Ambiguous keys hard-fail (status=ambiguous, no kalshi_event_id) — never
 * surname-first-hit like ghost-trader.
 *
 * On linked: copy Stadion resolution onto the Kalshi event_id so book_ticks
 * can join outcomes without rewriting tick FK rows.
 */
// @see https://bun.com/docs/runtime/sqlite
import type { Database } from "bun:sqlite";
import { asCanonicalEventId, type CanonicalEventId } from "./types.ts";
import { ITF_STADION_SOURCE, tourFromStadionLevel } from "./itf-stadion.ts";
import { winnerOutcomeBit } from "./event-id.ts";

const KALSHI_SOURCE = "kalshi-api";
const METHOD = "surname_day_lane";

export type BridgeStatus = "linked" | "ambiguous" | "unmatched";

export type BridgeSummary = {
  stadionCandidates: number;
  kalshiCandidates: number;
  linked: number;
  ambiguous: number;
  unmatched: number;
  resolutionsPropagated: number;
  anomalies: string[];
};

export type BridgeSide = {
  eventId: CanonicalEventId;
  playerA: string;
  playerB: string;
  startTs: string;
  /** Series lane: KXITFMATCH | KXITFWMATCH | KXITFDOUBLES | KXITFWDOUBLES | … */
  lane: string;
  format: "singles" | "doubles";
};

const ACCENT_MAP: Record<string, string> = {
  é: "e",
  è: "e",
  ê: "e",
  ë: "e",
  á: "a",
  à: "a",
  â: "a",
  ä: "a",
  í: "i",
  ì: "i",
  î: "i",
  ï: "i",
  ó: "o",
  ò: "o",
  ô: "o",
  ö: "o",
  ø: "o",
  ú: "u",
  ù: "u",
  û: "u",
  ü: "u",
  ñ: "n",
  ç: "c",
  š: "s",
  ž: "z",
  ř: "r",
  ć: "c",
  č: "c",
  đ: "d",
};

/** Lowercase + strip common accents for surname compare. */
export function normalizeLastName(raw: string): string {
  let s = raw.trim().toLowerCase();
  for (const [from, to] of Object.entries(ACCENT_MAP)) {
    s = s.replaceAll(from, to);
  }
  return s.replace(/[^a-z0-9]/g, "");
}

/**
 * Last name from a player label.
 * "S. Bejlek" → bejlek, "Julia Grabher" → grabher, trailing initial "Muller A." → muller.
 */
export function extractLastName(name: string): string {
  let s = name.trim();
  if (!s) return "";
  const paren = s.indexOf(" (");
  if (paren >= 0) s = s.slice(0, paren);
  const parts = s.split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  const last = parts[parts.length - 1]!.replace(/\.$/, "");
  if (last.length <= 2 && /^[A-Za-z]/.test(last) && parts.length >= 2) {
    return normalizeLastName(parts[0]!);
  }
  return normalizeLastName(last);
}

/** All last names on a side — doubles split on `/`. */
export function lastNamesFromLabel(label: string): string[] {
  return label
    .split(/\s*\/\s*/)
    .map((p) => extractLastName(p))
    .filter(Boolean);
}

/**
 * Wire day = first 10 chars of ISO start_ts (YYYY-MM-DD).
 * Stadion often pads local calendar dates as `…T12:00:00.000Z`; Kalshi uses
 * occurrence UTC — those prefixes can differ by one calendar day.
 */
export function dayFromStartTs(startTs: string): string {
  const d = startTs.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    throw new Error(`start_ts day required (YYYY-MM-DD…), got ${startTs}`);
  }
  return d;
}

/** Primary wire day ±1 UTC calendar day (hard-fail later if multi-hit). */
export function matchDayCandidates(startTs: string): string[] {
  const primary = dayFromStartTs(startTs);
  const noon = Date.parse(`${primary}T12:00:00.000Z`);
  if (!Number.isFinite(noon)) return [primary];
  const prev = new Date(noon - 86_400_000).toISOString().slice(0, 10);
  const next = new Date(noon + 86_400_000).toISOString().slice(0, 10);
  return [...new Set([primary, prev, next])];
}

function lanesFromTourOnly(tour: string, format: "singles" | "doubles"): string[] {
  if (format === "doubles") {
    if (tour === "ITF-W" || tour === "ITF-WD") return ["KXITFWDOUBLES"];
    if (tour === "ITF-M" || tour === "ITF-MD") return ["KXITFDOUBLES"];
    return ["KXITFDOUBLES", "KXITFWDOUBLES"];
  }
  if (tour === "ITF-W" || tour === "ITF-WD") return ["KXITFWMATCH"];
  if (tour === "ITF-M" || tour === "ITF-MD") return ["KXITFMATCH"];
  return ["KXITFMATCH", "KXITFWMATCH"];
}

/**
 * Map Stadion tour + format → Kalshi series lane(s) accepted for a match.
 * When stored tour conflicts with level (poisoned ITF-M on women's WTT), probe
 * level-derived lane first then both — ambiguous multi-hit still hard-fails.
 */
export function lanesForStadionTour(
  tour: string,
  format: "singles" | "doubles",
  level?: string,
): string[] {
  const fromTour = lanesFromTourOnly(tour, format);
  if (!level?.trim()) return fromTour;

  const levelTour = tourFromStadionLevel(level);
  if (levelTour === "ITF") return fromTour;

  const tourNorm =
    tour === "ITF-WD" ? "ITF-W" : tour === "ITF-MD" ? "ITF-M" : tour;
  if (levelTour === tourNorm) return fromTour;

  // Poisoned / mismatched tour: prefer level lane, then include stored tour lane.
  const fromLevel = lanesFromTourOnly(levelTour, format);
  return [...new Set([...fromLevel, ...fromTour])];
}

export function laneFromKalshiSeries(series: string): string {
  return series.trim().toUpperCase();
}

export function formatFromLane(lane: string): "singles" | "doubles" {
  return /DOUBLES/i.test(lane) ? "doubles" : "singles";
}

/**
 * Match key: day|lane|sortedLastNames…
 * Returns null when name count doesn't match format (refuse guess).
 */
export function buildMatchKey(parts: {
  day: string;
  lane: string;
  playerA: string;
  playerB: string;
  format: "singles" | "doubles";
}): string | null {
  const names = [...lastNamesFromLabel(parts.playerA), ...lastNamesFromLabel(parts.playerB)];
  const expect = parts.format === "doubles" ? 4 : 2;
  if (names.length !== expect) return null;
  if (new Set(names).size !== names.length) return null; // identical surnames → refuse
  return [parts.day, parts.lane.toUpperCase(), ...names.slice().sort()].join("|");
}

type IndexedSide = BridgeSide & { matchKey: string };

function loadKalshiSides(db: Database): IndexedSide[] {
  const rows = db
    .query(
      `SELECT e.event_id AS event_id,
              e.player_a AS player_a,
              e.player_b AS player_b,
              e.start_ts AS start_ts,
              COALESCE(
                (SELECT m.series FROM markets m
                  WHERE m.event_id = e.event_id AND m.series != ''
                  ORDER BY CASE m.market_kind WHEN 'match_winner' THEN 0 ELSE 1 END
                  LIMIT 1),
                ''
              ) AS series
       FROM events e
       WHERE e.source = $source`,
    )
    .all({ $source: KALSHI_SOURCE }) as Array<{
    event_id: string;
    player_a: string;
    player_b: string;
    start_ts: string;
    series: string;
  }>;

  const out: IndexedSide[] = [];
  for (const r of rows) {
    if (!r.series) continue;
    const lane = laneFromKalshiSeries(r.series);
    const format = formatFromLane(lane);
    let day: string;
    try {
      day = dayFromStartTs(r.start_ts);
    } catch {
      continue;
    }
    const matchKey = buildMatchKey({
      day,
      lane,
      playerA: r.player_a,
      playerB: r.player_b,
      format,
    });
    if (!matchKey) continue;
    out.push({
      eventId: asCanonicalEventId(r.event_id),
      playerA: r.player_a,
      playerB: r.player_b,
      startTs: r.start_ts,
      lane,
      format,
      matchKey,
    });
  }
  return out;
}

function loadStadionSides(db: Database): Array<IndexedSide & { tour: string }> {
  const rows = db
    .query(
      `SELECT event_id, player_a, player_b, start_ts, tour, level
       FROM events
       WHERE source = $source`,
    )
    .all({ $source: ITF_STADION_SOURCE }) as Array<{
    event_id: string;
    player_a: string;
    player_b: string;
    start_ts: string;
    tour: string;
    level: string;
  }>;

  const out: Array<IndexedSide & { tour: string }> = [];
  for (const r of rows) {
    const format: "singles" | "doubles" =
      /doubles/i.test(r.level) || r.player_a.includes("/") || r.player_b.includes("/")
        ? "doubles"
        : "singles";
    let days: string[];
    try {
      // Probe ±1 day so Stadion local-pad vs Kalshi occurrence UTC can still link;
      // multi-hit across days → ambiguous (hard-fail).
      days = matchDayCandidates(r.start_ts);
    } catch {
      continue;
    }
    const lanes = lanesForStadionTour(r.tour, format, r.level);
    for (const lane of lanes) {
      for (const day of days) {
        const matchKey = buildMatchKey({
          day,
          lane,
          playerA: r.player_a,
          playerB: r.player_b,
          format,
        });
        if (!matchKey) continue;
        out.push({
          eventId: asCanonicalEventId(r.event_id),
          playerA: r.player_a,
          playerB: r.player_b,
          startTs: r.start_ts,
          lane,
          format,
          matchKey,
          tour: r.tour,
        });
      }
    }
  }
  return out;
}

function upsertLink(
  db: Database,
  row: {
    stadionEventId: CanonicalEventId;
    kalshiEventId: CanonicalEventId | null;
    status: BridgeStatus;
    matchKey: string;
    detail: string;
    linkedAt: number;
  },
): void {
  db.query(
    `INSERT INTO event_links (
       stadion_event_id, kalshi_event_id, status, match_key, method, detail, linked_at
     ) VALUES (
       $stadion, $kalshi, $status, $match_key, $method, $detail, $linked_at
     )
     ON CONFLICT (stadion_event_id) DO UPDATE SET
       kalshi_event_id = excluded.kalshi_event_id,
       status = excluded.status,
       match_key = excluded.match_key,
       method = excluded.method,
       detail = excluded.detail,
       linked_at = excluded.linked_at`,
  ).run({
    $stadion: row.stadionEventId,
    $kalshi: row.kalshiEventId,
    $status: row.status,
    $match_key: row.matchKey,
    $method: METHOD,
    $detail: row.detail,
    $linked_at: row.linkedAt,
  });
}

/** Outcome bit relative to Kalshi player_a/player_b (may differ from Stadion sort order). */
export function outcomeBitForKalshiPlayers(
  winner: string,
  playerA: string,
  playerB: string,
): 0 | 1 {
  try {
    return winnerOutcomeBit(winner, playerA, playerB);
  } catch {
    const w = extractLastName(winner);
    const a = extractLastName(playerA);
    const b = extractLastName(playerB);
    if (w && w === a && w !== b) return 1;
    if (w && w === b && w !== a) return 0;
    throw new Error(
      `cannot map winner "${winner}" onto Kalshi players "${playerA}" / "${playerB}"`,
    );
  }
}

function propagateResolution(
  db: Database,
  stadionEventId: CanonicalEventId,
  kalshiEventId: CanonicalEventId,
): boolean {
  const src = db
    .query(
      `SELECT winner, loser, outcome, score_text
       FROM events WHERE event_id = $id AND source = $source`,
    )
    .get({ $id: stadionEventId, $source: ITF_STADION_SOURCE }) as
    | {
        winner: string;
        loser: string;
        outcome: string;
        score_text: string;
      }
    | null;
  if (!src?.winner) return false;

  const kalshiPlayers = db
    .query(`SELECT player_a, player_b FROM events WHERE event_id = $id AND source = $src`)
    .get({ $id: kalshiEventId, $src: KALSHI_SOURCE }) as
    | { player_a: string; player_b: string }
    | null;
  if (!kalshiPlayers) return false;

  let outcomeBit: 0 | 1;
  try {
    outcomeBit = outcomeBitForKalshiPlayers(
      src.winner,
      kalshiPlayers.player_a,
      kalshiPlayers.player_b,
    );
  } catch {
    // Link stands; resolution propagation skipped — surfaced via no insert.
    return false;
  }

  db.query(
    `UPDATE events SET
       winner = $winner,
       loser = $loser,
       outcome = $outcome,
       score_text = $score_text
     WHERE event_id = $id AND source = $ksource`,
  ).run({
    $winner: src.winner,
    $loser: src.loser,
    $outcome: src.outcome,
    $score_text: src.score_text,
    $id: kalshiEventId,
    $ksource: KALSHI_SOURCE,
  });

  const res = db
    .query(
      `SELECT winner, source, source_url, fetched_ts, corpus, resolved_ts
       FROM resolutions WHERE event_id = $id`,
    )
    .get({ $id: stadionEventId }) as
    | {
        winner: string;
        source: string;
        source_url: string;
        fetched_ts: number | null;
        corpus: string;
        resolved_ts: string;
      }
    | null;
  if (!res) return false;

  const inserted = db
    .query(
      `INSERT OR IGNORE INTO resolutions (
         event_id, outcome, winner, source, source_url, fetched_ts, corpus, resolved_ts
       ) VALUES (
         $event_id, $outcome, $winner, $source, $source_url, $fetched_ts, $corpus, $resolved_ts
       )`,
    )
    .run({
      $event_id: kalshiEventId,
      $outcome: outcomeBit,
      $winner: res.winner,
      $source: res.source,
      $source_url: res.source_url,
      $fetched_ts: res.fetched_ts,
      $corpus: res.corpus,
      $resolved_ts: res.resolved_ts,
    });
  return inserted.changes > 0;
}

/**
 * Bridge all Stadion events in DB to Kalshi events already synced.
 * Idempotent upsert on stadion_event_id.
 */
export function bridgeStadionToKalshi(db: Database): BridgeSummary {
  const linkedAt = Date.now();
  const summary: BridgeSummary = {
    stadionCandidates: 0,
    kalshiCandidates: 0,
    linked: 0,
    ambiguous: 0,
    unmatched: 0,
    resolutionsPropagated: 0,
    anomalies: [],
  };

  const kalshi = loadKalshiSides(db);
  summary.kalshiCandidates = new Set(kalshi.map((k) => k.eventId)).size;

  const kalshiByKey = new Map<string, IndexedSide[]>();
  for (const k of kalshi) {
    const list = kalshiByKey.get(k.matchKey) ?? [];
    list.push(k);
    kalshiByKey.set(k.matchKey, list);
  }

  // Stadion may appear under multiple lanes when tour=ITF; dedupe by eventId after pick.
  const stadionRows = loadStadionSides(db);
  const byStadion = new Map<string, Array<IndexedSide & { tour: string }>>();
  for (const s of stadionRows) {
    const list = byStadion.get(s.eventId) ?? [];
    list.push(s);
    byStadion.set(s.eventId, list);
  }
  summary.stadionCandidates = byStadion.size;

  db.run("BEGIN");
  try {
    for (const [stadionId, variants] of byStadion) {
      const hits: Array<{ variant: IndexedSide; kalshi: IndexedSide }> = [];
      for (const v of variants) {
        const cands = kalshiByKey.get(v.matchKey) ?? [];
        for (const c of cands) hits.push({ variant: v, kalshi: c });
      }

      const uniqueKalshi = [...new Map(hits.map((h) => [h.kalshi.eventId, h])).values()];
      const matchKey = variants[0]!.matchKey;
      const stadionEventId = asCanonicalEventId(stadionId);

      if (uniqueKalshi.length === 0) {
        upsertLink(db, {
          stadionEventId,
          kalshiEventId: null,
          status: "unmatched",
          matchKey,
          detail: `lanes=${variants.map((v) => v.lane).join(",")}`,
          linkedAt,
        });
        summary.unmatched++;
        continue;
      }

      if (uniqueKalshi.length > 1) {
        const detail = uniqueKalshi.map((h) => h.kalshi.eventId).join(",");
        upsertLink(db, {
          stadionEventId,
          kalshiEventId: null,
          status: "ambiguous",
          matchKey,
          detail,
          linkedAt,
        });
        summary.ambiguous++;
        summary.anomalies.push(`ambiguous:${stadionId}:${detail}`);
        continue;
      }

      const hit = uniqueKalshi[0]!;
      // Same Kalshi claimed by another Stadion key already linked this pass?
      const prior = db
        .query(
          `SELECT stadion_event_id FROM event_links
           WHERE kalshi_event_id = $k AND status = 'linked' AND stadion_event_id != $s`,
        )
        .get({ $k: hit.kalshi.eventId, $s: stadionEventId }) as { stadion_event_id: string } | null;
      if (prior) {
        upsertLink(db, {
          stadionEventId,
          kalshiEventId: null,
          status: "ambiguous",
          matchKey: hit.variant.matchKey,
          detail: `kalshi_claimed_by:${prior.stadion_event_id}`,
          linkedAt,
        });
        summary.ambiguous++;
        summary.anomalies.push(
          `ambiguous:${stadionId}:kalshi_claimed_by:${prior.stadion_event_id}`,
        );
        continue;
      }

      upsertLink(db, {
        stadionEventId,
        kalshiEventId: hit.kalshi.eventId,
        status: "linked",
        matchKey: hit.variant.matchKey,
        detail: "",
        linkedAt,
      });
      summary.linked++;
      if (propagateResolution(db, stadionEventId, hit.kalshi.eventId)) {
        summary.resolutionsPropagated++;
      }
    }
    db.run("COMMIT");
  } catch (err) {
    db.run("ROLLBACK");
    throw err;
  }

  return summary;
}

export function getLinkedKalshiEventId(
  db: Database,
  stadionEventId: CanonicalEventId,
): CanonicalEventId | undefined {
  const row = db
    .query(
      `SELECT kalshi_event_id FROM event_links
       WHERE stadion_event_id = $id AND status = 'linked'`,
    )
    .get({ $id: stadionEventId }) as { kalshi_event_id: string | null } | null;
  return tryAsId(row?.kalshi_event_id);
}

export function getLinkedStadionEventId(
  db: Database,
  kalshiEventId: CanonicalEventId,
): CanonicalEventId | undefined {
  const row = db
    .query(
      `SELECT stadion_event_id FROM event_links
       WHERE kalshi_event_id = $id AND status = 'linked'`,
    )
    .get({ $id: kalshiEventId }) as { stadion_event_id: string } | null;
  return tryAsId(row?.stadion_event_id);
}

function tryAsId(raw: string | null | undefined): CanonicalEventId | undefined {
  if (!raw?.trim()) return undefined;
  return asCanonicalEventId(raw);
}
