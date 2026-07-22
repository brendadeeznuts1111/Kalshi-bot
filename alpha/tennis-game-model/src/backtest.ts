/**
 * Backtest: Brier score of game-model vs market mid on resolved ITF events.
 */
import { midFromBookSnapshot } from "../../../src/bot/kalshi-book-parse.ts";
import type { BookSnapshot } from "../../../src/institutions/alpha-signal-types.ts";
import {
  asCanonicalEventId,
  asKalshiMarketTicker,
  unbrand,
} from "../../../src/institutions/event-store/brands.ts";
import { DEFAULT_EVENT_STORE_DB } from "../../../src/institutions/event-store/paths.ts";
import { openEventStore } from "../../../src/institutions/event-store/open-db.ts";
import { loadScoreContext } from "./score-context.ts";
import { buildGameModelP } from "./game-model.ts";

export type BacktestRow = {
  eventId: string;
  ticker: string;
  outcome: 0 | 1;
  pModel: number;
  pMarket: number;
  brierModel: number;
  brierMarket: number;
};

export type BacktestSummary = {
  rows: number;
  brierModel: number;
  brierMarket: number;
  midBandRows: number;
  brierModelMidBand: number;
};

function parseBook(json: string): BookSnapshot | null {
  try {
    return JSON.parse(json) as BookSnapshot;
  } catch {
    return null;
  }
}

export function summarizeBacktest(rows: BacktestRow[]): BacktestSummary {
  if (!rows.length) {
    return { rows: 0, brierModel: 0, brierMarket: 0, midBandRows: 0, brierModelMidBand: 0 };
  }
  const midBand = rows.filter((r) => r.pMarket >= 0.3 && r.pMarket <= 0.7);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    rows: rows.length,
    brierModel: mean(rows.map((r) => r.brierModel)),
    brierMarket: mean(rows.map((r) => r.brierMarket)),
    midBandRows: midBand.length,
    brierModelMidBand: midBand.length ? mean(midBand.map((r) => r.brierModel)) : 0,
  };
}

export function runBacktest(dbPath: string = DEFAULT_EVENT_STORE_DB): BacktestSummary {
  const db = openEventStore({ dbPath, readonly: true });
  const resolved = db
    .query(
      `SELECT r.event_id, r.outcome, r.winner, m.ticker, m.yes_side_label,
              e.player_a, e.player_b
       FROM resolutions r
       JOIN markets m ON m.event_id = r.event_id
       JOIN events e ON e.event_id = r.event_id
       WHERE m.market_kind = 'match_winner' OR m.market_kind = ''
       ORDER BY r.event_id`,
    )
    .all() as Array<{
    event_id: string;
    outcome: number;
    winner: string;
    ticker: string;
    yes_side_label: string;
    player_a: string;
    player_b: string;
  }>;

  const rows: BacktestRow[] = [];

  for (const row of resolved) {
    const eventId = asCanonicalEventId(row.event_id);
    const ticker = asKalshiMarketTicker(row.ticker);
    const tick = db
      .query(
        `SELECT levels_json FROM book_ticks
         WHERE event_id = $e AND ticker = $t
         ORDER BY id ASC LIMIT 1`,
      )
      .get({ $e: unbrand(eventId), $t: unbrand(ticker) }) as { levels_json: string } | null;
    if (!tick) continue;

    const book = parseBook(tick.levels_json);
    if (!book) continue;
    const mid = midFromBookSnapshot(book);
    if (mid == null) continue;

    const score = loadScoreContext(db, eventId, ticker);
    const model = buildGameModelP({
      db,
      ticker,
      eventId,
      currentMidCents: mid,
      score,
    });
    if (!model) continue;

    const pMarket = mid / 100;
    const yesWon = row.winner === row.yes_side_label ? 1 : 0;
    const outcome = yesWon as 0 | 1;
    rows.push({
      eventId: unbrand(eventId),
      ticker: unbrand(ticker),
      outcome,
      pModel: model.pModel,
      pMarket,
      brierModel: (model.pModel - outcome) ** 2,
      brierMarket: (pMarket - outcome) ** 2,
    });
  }

  return summarizeBacktest(rows);
}

if (import.meta.main) {
  const dbPath = Bun.argv.find((a) => a.startsWith("--db="))?.slice("--db=".length);
  const summary = runBacktest(dbPath);
  console.log(JSON.stringify(summary, null, 2));
}
