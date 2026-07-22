// @see https://bun.com/docs/runtime/sqlite
import type { Database } from "bun:sqlite";
import { asCanonicalEventId, unbrand } from "./brands.ts";
import { winnerOutcomeBit } from "./event-id.ts";
import {
  fetchItfStadionDay,
  parseItfStadionDayWire,
  ITF_STADION_SOURCE,
  tourFromStadionLevel,
  type ItfStadionCollectSummary,
  type ItfStadionFetchImpl,
  type PrimaryResultMatch,
} from "./itf-stadion.ts";
import { bridgeStadionToKalshi, type BridgeSummary } from "./stadion-kalshi-bridge.ts";

const TRADING_CORPUS = "trading";

export type IngestPrimaryOptions = {
  /** singles (default) | doubles | all */
  format?: "singles" | "doubles" | "all";
};

export type RepairStadionToursSummary = {
  scanned: number;
  updated: number;
};

/** Recompute tour from level for existing itf-stadion rows (no refetch). */
export function repairStadionToursFromLevel(db: Database): RepairStadionToursSummary {
  const rows = db
    .query(
      `SELECT event_id, tour, level FROM events WHERE source = $source`,
    )
    .all({ $source: ITF_STADION_SOURCE }) as Array<{
    event_id: string;
    tour: string;
    level: string;
  }>;

  let updated = 0;
  db.run("BEGIN");
  try {
    for (const row of rows) {
      const next = tourFromStadionLevel(row.level);
      if (next === "ITF" || next === row.tour) continue;
      const result = db
        .query(`UPDATE events SET tour = $tour WHERE event_id = $event_id AND source = $source`)
        .run({
          $tour: next,
          $event_id: unbrand(asCanonicalEventId(row.event_id)),
          $source: ITF_STADION_SOURCE,
        });
      if (result.changes > 0) updated++;
    }
    db.run("COMMIT");
  } catch (err) {
    db.run("ROLLBACK");
    throw err;
  }
  return { scanned: rows.length, updated };
}

function upsertPrimaryEvent(
  db: Database,
  match: PrimaryResultMatch,
  ingestedAt: number,
): "inserted" | "updated" {
  const existed = db
    .query(`SELECT 1 AS ok FROM events WHERE event_id = $event_id`)
    .get({ $event_id: unbrand(match.eventId) }) as { ok: number } | null;

  db.query(
    `INSERT INTO events (
      event_id, tour, level, tournament, location, surface, court, round, best_of,
      player_a, player_b, winner, loser, start_ts, outcome, score_text,
      source, source_url, fetched_ts, source_row_hash, ingested_at, corpus
    ) VALUES (
      $event_id, $tour, $level, $tournament, $location, $surface, '', $round, NULL,
      $player_a, $player_b, $winner, $loser, $start_ts, $outcome, $score_text,
      $source, $source_url, $fetched_ts, $source_row_hash, $ingested_at, $corpus
    )
    ON CONFLICT(event_id) DO UPDATE SET
      tour = excluded.tour,
      level = excluded.level,
      tournament = excluded.tournament,
      location = excluded.location,
      surface = excluded.surface,
      round = excluded.round,
      player_a = excluded.player_a,
      player_b = excluded.player_b,
      winner = excluded.winner,
      loser = excluded.loser,
      start_ts = excluded.start_ts,
      outcome = excluded.outcome,
      score_text = excluded.score_text,
      source = excluded.source,
      source_url = excluded.source_url,
      fetched_ts = excluded.fetched_ts,
      source_row_hash = excluded.source_row_hash,
      ingested_at = excluded.ingested_at,
      corpus = excluded.corpus`,
  ).run({
    $event_id: unbrand(match.eventId),
    $tour: match.tour,
    $level: match.level,
    $tournament: match.tournament,
    $location: match.location,
    $surface: match.surface,
    $round: match.round,
    $player_a: match.playerA,
    $player_b: match.playerB,
    $winner: match.winner,
    $loser: match.loser,
    $start_ts: match.startTs,
    $outcome: match.outcome,
    $score_text: match.scoreText,
    $source: ITF_STADION_SOURCE,
    $source_url: match.sourceUrl,
    $fetched_ts: match.fetchedTs,
    $source_row_hash: match.sourceRowHash,
    $ingested_at: ingestedAt,
    $corpus: TRADING_CORPUS,
  });

  return existed ? "updated" : "inserted";
}

function upsertPrimaryResolution(db: Database, match: PrimaryResultMatch): boolean {
  const outcome = winnerOutcomeBit(match.winner, match.playerA, match.playerB);
  const result = db
    .query(
      `INSERT INTO resolutions (
         event_id, outcome, winner, source, source_url, fetched_ts, corpus, resolved_ts
       ) VALUES (
         $event_id, $outcome, $winner, $source, $source_url, $fetched_ts, $corpus, $resolved_ts
       )
       ON CONFLICT(event_id) DO UPDATE SET
         outcome = excluded.outcome,
         winner = excluded.winner,
         source = excluded.source,
         source_url = excluded.source_url,
         fetched_ts = excluded.fetched_ts,
         corpus = excluded.corpus,
         resolved_ts = excluded.resolved_ts`,
    )
    .run({
      $event_id: unbrand(match.eventId),
      $outcome: outcome,
      $winner: match.winner,
      $source: ITF_STADION_SOURCE,
      $source_url: match.sourceUrl,
      $fetched_ts: match.fetchedTs,
      $corpus: TRADING_CORPUS,
      $resolved_ts: match.endTs ?? match.startTs,
    });
  return result.changes > 0;
}

export function ingestPrimaryResultMatches(
  db: Database,
  matches: PrimaryResultMatch[],
  options: IngestPrimaryOptions = {},
): Pick<
  ItfStadionCollectSummary,
  | "matchesParsed"
  | "singles"
  | "doubles"
  | "eventsInserted"
  | "eventsUpdated"
  | "resolutionsInserted"
> {
  const format = options.format ?? "singles";
  const filtered = matches.filter((m) => format === "all" || m.format === format);
  const ingestedAt = Date.now();
  const summary = {
    matchesParsed: filtered.length,
    singles: filtered.filter((m) => m.format === "singles").length,
    doubles: filtered.filter((m) => m.format === "doubles").length,
    eventsInserted: 0,
    eventsUpdated: 0,
    resolutionsInserted: 0,
  };

  db.run("BEGIN");
  try {
    for (const match of filtered) {
      const action = upsertPrimaryEvent(db, match, ingestedAt);
      if (action === "inserted") summary.eventsInserted++;
      else summary.eventsUpdated++;
      if (upsertPrimaryResolution(db, match)) summary.resolutionsInserted++;
    }
    db.run("COMMIT");
  } catch (err) {
    db.run("ROLLBACK");
    throw err;
  }
  return summary;
}

export type CollectItfStadionDayResult = ItfStadionCollectSummary & {
  bridge?: BridgeSummary;
};

export async function collectItfStadionDay(
  db: Database,
  dayIso: string,
  options: IngestPrimaryOptions & {
    force?: boolean;
    fetchImpl?: ItfStadionFetchImpl;
    /** After ingest, link Stadion rows to synced Kalshi events (default true). */
    bridge?: boolean;
  } = {},
): Promise<CollectItfStadionDayResult> {
  const { wire, sourceUrl, fetchedTs, cacheHit } = await fetchItfStadionDay(dayIso, {
    force: options.force,
    fetchImpl: options.fetchImpl,
  });
  const matches = parseItfStadionDayWire(wire, { sourceUrl, fetchedTs });
  const ingest = ingestPrimaryResultMatches(db, matches, { format: options.format });
  const bridge = options.bridge === false ? undefined : bridgeStadionToKalshi(db);
  return {
    day: dayIso,
    sourceUrl,
    fetchedTs,
    cacheHit,
    ...ingest,
    bridge,
  };
}

export async function collectItfStadionRange(
  db: Database,
  days: string[],
  options: IngestPrimaryOptions & {
    force?: boolean;
    pauseMs?: number;
    bridge?: boolean;
  } = {},
): Promise<CollectItfStadionDayResult[]> {
  const out: CollectItfStadionDayResult[] = [];
  const pauseMs = options.pauseMs ?? 1500;
  for (let i = 0; i < days.length; i++) {
    // Bridge once after the full range so mid-range Kalshi syncs can match.
    const bridgeThisDay = false;
    out.push(
      await collectItfStadionDay(db, days[i]!, { ...options, bridge: bridgeThisDay }),
    );
    if (i < days.length - 1 && pauseMs > 0) await Bun.sleep(pauseMs);
  }
  if (options.bridge !== false && out.length) {
    const bridge = bridgeStadionToKalshi(db);
    const last = out[out.length - 1]!;
    last.bridge = bridge;
  }
  return out;
}

export function recentUtcDays(n: number, end = new Date()): string[] {
  const days: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}
