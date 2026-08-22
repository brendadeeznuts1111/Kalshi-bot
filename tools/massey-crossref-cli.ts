#!/usr/bin/env bun
/**
 * Crossref Massey Ratings vs the plive/ezlive book (fantasy402).
 *
 * Joins the latest Massey snapshots (research/cache/massey.db) for a sport
 * bucket against book events (event-store.db skin_events) and reports
 * coverage + Massey-implied win probabilities for matched teams.
 *
 * Usage:
 *   bun run massey:crossref -- --sport=volleyball
 *   bun run massey:crossref -- --sport=tennis --json
 *   bun run massey:crossref -- --sport=basketball --rows=10
 *
 * Flags:
 *   --sport   book sport bucket (volleyball | tennis | basketball | ...).
 *   --rows=N  print first N matched rows (default 10; 0 = all).
 *   --json    emit one JSON object { summary, rows }.
 */
import { argValue, hasFlag } from '../src/cli/argv.ts';
import { openEventStore } from '../src/institutions/event-store/open-db.ts';
import { openMasseyDb } from '../src/institutions/massey/store.ts';
import { crossrefSport, type BookSkinEvent, type MasseyCrossrefRow } from '../src/institutions/massey/crossref.ts';

function loadBookEvents(db: ReturnType<typeof openEventStore>, sport: string): BookSkinEvent[] {
  const seen = new Set<string>();
  const stmt = db.prepare(
    "SELECT league, home, away, competition_id FROM skin_events WHERE sport = ?"
  );
  const out: BookSkinEvent[] = [];
  for (const row of stmt.all(sport) as { league: string; home: string | null; away: string | null; competition_id: string | null }[]) {
    const key = row.league + "|" + (row.home ?? "") + "|" + (row.away ?? "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      league: row.league,
      home: row.home,
      away: row.away,
      competitionId: row.competition_id,
    });
  }
  return out;
}

function formatRow(r: MasseyCrossrefRow): string {
  const hm = r.homeMatch ? r.homeMatch.team + "(" + r.homeMatch.quality + ")" : "-";
  const am = r.awayMatch ? r.awayMatch.team + "(" + r.awayMatch.quality + ")" : "-";
  return [
    r.bookLeague.padEnd(28).slice(0, 28),
    (r.bookHome || "-").padEnd(24).slice(0, 24),
    hm.padEnd(20).slice(0, 20),
    (r.homeWinPct != null ? r.homeWinPct.toFixed(3) : "-").padStart(6),
    (r.bookAway || "-").padEnd(24).slice(0, 24),
    am.padEnd(20).slice(0, 20),
    (r.awayWinPct != null ? r.awayWinPct.toFixed(3) : "-").padStart(6),
  ].join("  ");
}

async function main(): Promise<void> {
  const sport = argValue('sport') ?? 'volleyball';
  const json = hasFlag('json');
  const rowsLimit = Number(argValue('rows') ?? '10') || 0;
  const masseyDb = openMasseyDb();
  const bookDb = openEventStore({ readonly: true });
  const events = loadBookEvents(bookDb, sport);
  const result = crossrefSport(masseyDb, events, sport);

  if (json) {
    console.log(JSON.stringify({
      sport,
      total: result.total,
      covered: result.covered,
      uncovered: result.total - result.covered,
      rows: result.rows.slice(0, rowsLimit || undefined),
    }));
  } else {
    console.log("sport: " + sport + " | book events: " + result.total + " | covered: " + result.covered + " | uncovered: " + (result.total - result.covered));
    console.log("");
    console.log(["league", "book home", "massey home", "p(home)", "book away", "massey away", "p(away)"].join("  "));
    const shown = result.rows.filter((r) => r.covered).slice(0, rowsLimit || undefined);
    if (shown.length === 0) {
      console.log("(no book events matched a Massey snapshot for this sport)");
      console.log("hint: run bun run massey:sync -- --sport=<massey target> --write first");
    } else {
      for (const r of shown) console.log(formatRow(r));
    }
  }
  masseyDb.close();
  bookDb.close();
}

await main();
