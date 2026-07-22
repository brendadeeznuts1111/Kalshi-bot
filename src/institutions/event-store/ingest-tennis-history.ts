// @see https://bun.com/docs/runtime/sqlite
import type { Database } from "bun:sqlite";
import { winnerOutcomeBit } from "./event-id.ts";
import { impliedProbFromDecimal, TENNIS_DATA_SOURCE } from "./parse-tennis-data-csv.ts";
import type { IngestSummary, TennisHistoryMatch } from "./types.ts";

type InsertEventResult = "inserted" | "skipped";

/** Third-party CSV compilations — never feed p_model / trading graduation. */
const RESEARCH_CORPUS = "research-only";

function insertEvent(db: Database, match: TennisHistoryMatch, ingestedAt: number): InsertEventResult {
  const result = db
    .query(
      `INSERT OR IGNORE INTO events (
        event_id, tour, level, tournament, location, surface, court, round, best_of,
        player_a, player_b, winner, loser, start_ts, outcome, source, source_url, fetched_ts,
        source_row_hash, ingested_at, corpus
      ) VALUES (
        $event_id, $tour, $level, $tournament, $location, $surface, $court, $round, $best_of,
        $player_a, $player_b, $winner, $loser, $start_ts, $outcome, $source, $source_url, $fetched_ts,
        $source_row_hash, $ingested_at, $corpus
      )`,
    )
    .run({
      $event_id: match.eventId,
      $tour: match.tour,
      $level: match.level,
      $tournament: match.tournament,
      $location: match.location,
      $surface: match.surface,
      $court: match.court,
      $round: match.round,
      $best_of: match.bestOf,
      $player_a: match.playerA,
      $player_b: match.playerB,
      $winner: match.winner,
      $loser: match.loser,
      $start_ts: match.startTs,
      $outcome: match.outcome,
      $source: TENNIS_DATA_SOURCE,
      $source_url: `file://${match.sourceFile}#row=${match.sourceRow}`,
      $fetched_ts: ingestedAt,
      $source_row_hash: match.sourceRowHash,
      $ingested_at: ingestedAt,
      $corpus: RESEARCH_CORPUS,
    });
  return result.changes > 0 ? "inserted" : "skipped";
}

function insertOddsTick(
  db: Database,
  eventId: string,
  source: string,
  side: string,
  decimalOdds: number,
  ts: number,
): boolean {
  const implied = impliedProbFromDecimal(decimalOdds);
  const result = db
    .query(
      `INSERT INTO odds_ticks (
         event_id, source, source_url, fetched_ts, corpus, ts, side, decimal_odds, implied_prob, limit_context
       )
       SELECT $event_id, $source, $source_url, $fetched_ts, $corpus, $ts, $side, $decimal_odds, $implied_prob, 'closing'
       WHERE NOT EXISTS (
         SELECT 1 FROM odds_ticks
         WHERE event_id = $event_id AND source = $source AND side = $side AND ts = $ts
       )`,
    )
    .run({
      $event_id: eventId,
      $source: source,
      $source_url: "",
      $fetched_ts: ts,
      $corpus: RESEARCH_CORPUS,
      $ts: ts,
      $side: side,
      $decimal_odds: decimalOdds,
      $implied_prob: implied,
    });
  return result.changes > 0;
}

function insertResolution(db: Database, match: TennisHistoryMatch): boolean {
  const outcome = winnerOutcomeBit(match.winner, match.playerA, match.playerB);
  const result = db
    .query(
      `INSERT OR IGNORE INTO resolutions (
         event_id, outcome, winner, source, source_url, fetched_ts, corpus, resolved_ts
       ) VALUES (
         $event_id, $outcome, $winner, $source, $source_url, $fetched_ts, $corpus, $resolved_ts
       )`,
    )
    .run({
      $event_id: match.eventId,
      $outcome: outcome,
      $winner: match.winner,
      $source: TENNIS_DATA_SOURCE,
      $source_url: `file://${match.sourceFile}#row=${match.sourceRow}`,
      $fetched_ts: Date.now(),
      $corpus: RESEARCH_CORPUS,
      $resolved_ts: match.startTs,
    });
  return result.changes > 0;
}

function insertClosingOdds(db: Database, match: TennisHistoryMatch): number {
  const ts = Date.parse(match.startTs);
  let inserted = 0;
  const books = [
    { key: "pinnacle", odds: match.pinnacle },
    { key: "bet365", odds: match.bet365 },
  ] as const;
  for (const book of books) {
    if (book.odds.winner != null && insertOddsTick(db, match.eventId, book.key, "winner", book.odds.winner, ts)) {
      inserted++;
    }
    if (book.odds.loser != null && insertOddsTick(db, match.eventId, book.key, "loser", book.odds.loser, ts)) {
      inserted++;
    }
  }
  return inserted;
}

export function ingestTennisHistoryMatches(db: Database, matches: TennisHistoryMatch[]): IngestSummary {
  const ingestedAt = Date.now();
  const summary: IngestSummary = {
    filesRead: 0,
    rowsParsed: matches.length,
    eventsInserted: 0,
    eventsSkipped: 0,
    oddsInserted: 0,
    resolutionsInserted: 0,
  };

  db.run("BEGIN");
  try {
    for (const match of matches) {
      const eventResult = insertEvent(db, match, ingestedAt);
      if (eventResult === "inserted") {
        summary.eventsInserted++;
        summary.oddsInserted += insertClosingOdds(db, match);
        if (insertResolution(db, match)) summary.resolutionsInserted++;
      } else {
        summary.eventsSkipped++;
      }
    }
    db.run("COMMIT");
  } catch (err) {
    db.run("ROLLBACK");
    throw err;
  }

  return summary;
}

export async function ingestTennisHistoryFiles(
  db: Database,
  filePaths: string[],
): Promise<IngestSummary> {
  const { parseTennisDataCsv } = await import("./parse-tennis-data-csv.ts");
  const all: TennisHistoryMatch[] = [];
  for (const path of filePaths) {
    const text = await Bun.file(path).text();
    all.push(...parseTennisDataCsv(text, path.split("/").pop() ?? path));
  }
  const summary = ingestTennisHistoryMatches(db, all);
  summary.filesRead = filePaths.length;
  return summary;
}
