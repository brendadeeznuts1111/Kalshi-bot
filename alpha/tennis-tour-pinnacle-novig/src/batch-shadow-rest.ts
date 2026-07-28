// REST-only batch runner — resolved tour-series events → shadow-log
// No Odds API dependency. Reads book_ticks from event-store, writes shadow lines.

import { openEventStore } from "../../../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../../../src/institutions/event-store/paths.ts";
import type {
  BookSnapshot,
  Decision,
  SignalContext,
} from "../../../src/institutions/alpha-signal-types.ts";
import { appendShadowLine, buildToxicityMarkFields } from "./shadow.ts";
import { loadProgramManifest } from "./program.ts";

const TOUR_SERIES = [
  "KXATPMATCH",
  "KXWTAMATCH",
  "KXATPCHALLENGERMATCH",
  "KXWTACHALLENGERMATCH",
] as const;

function midCents(book: BookSnapshot): number | null {
  if (book.crossed) return null;
  const bestBid = book.bids[0]?.priceCents;
  const bestAsk = book.asks[0]?.priceCents;
  if (bestBid == null || bestAsk == null) return null;
  return Math.round((bestBid + bestAsk) / 2);
}

function parseFlags(argv: string[]) {
  const flags: {
    db?: string;
    dryRun?: boolean;
    from?: string;
    to?: string;
  } = {};
  for (const arg of argv) {
    if (arg === "--dry-run") {
      flags.dryRun = true;
    } else if (arg.startsWith("--db=")) {
      flags.db = arg.slice("--db=".length);
    } else if (arg.startsWith("--from=")) {
      flags.from = arg.slice("--from=".length);
    } else if (arg.startsWith("--to=")) {
      flags.to = arg.slice("--to=".length);
    }
  }
  return flags;
}

async function main() {
  const flags = parseFlags(Bun.argv.slice(2));
  const dbPath = flags.db ?? DEFAULT_EVENT_STORE_DB;
  const dryRun = flags.dryRun ?? false;

  const manifest = await loadProgramManifest(
    "alpha/tennis-tour-pinnacle-novig/program.json",
  );
  const minContracts = manifest.minContracts ?? 5;

  const db = openEventStore({ dbPath, readonly: true });

  const seriesPlaceholders = TOUR_SERIES.map((_, i) => `$s${i}`).join(", ");
  const params: Record<string, string | number> = {};
  TOUR_SERIES.forEach((s, i) => {
    params[`$s${i}`] = s;
  });

  let sql = `
    SELECT DISTINCT b.event_id, b.ticker
    FROM book_ticks b
    JOIN markets m ON m.ticker = b.ticker
    JOIN events e ON e.event_id = b.event_id
    WHERE m.series IN (${seriesPlaceholders})
      AND EXISTS (SELECT 1 FROM resolutions r WHERE r.event_id = b.event_id)
  `;

  if (flags.from) {
    sql += ` AND e.start_ts >= $from`;
    params.$from = `${flags.from}T00:00:00Z`;
  }
  if (flags.to) {
    sql += ` AND e.start_ts <= $to`;
    params.$to = `${flags.to}T23:59:59.999Z`;
  }

  sql += ` ORDER BY b.event_id, b.ticker`;

  const rows = db.query(sql).all(params) as Array<{
    event_id: string;
    ticker: string;
  }>;

  const latestTickStmt = db.query(`
    SELECT levels_json, source, ts, seq
    FROM book_ticks
    WHERE event_id = $event_id AND ticker = $ticker
    ORDER BY ts DESC, CASE source WHEN 'kalshi-ws' THEN 0 ELSE 1 END
    LIMIT 1
  `);

  let processed = 0;
  let skipped = 0;
  let shadowAppended = 0;

  for (const row of rows) {
    processed++;

    const tick = latestTickStmt.get({
      $event_id: row.event_id,
      $ticker: row.ticker,
    }) as { levels_json: string; source: string; ts: number; seq: number } | null;

    if (!tick) {
      skipped++;
      continue;
    }

    const book = JSON.parse(tick.levels_json) as BookSnapshot;
    const mid = midCents(book);
    const bestAsk = book.asks[0]?.priceCents ?? null;

    if (book.crossed || bestAsk == null || mid == null) {
      skipped++;
      continue;
    }

    const ctx: SignalContext = {
      ticker: row.ticker,
      eventId: row.event_id,
      book,
      pModel: mid / 100,
      components: {
        market_mid: mid / 100,
      },
    };

    const decision: Decision = {
      action: "trade",
      side: "yes",
      contracts: minContracts,
      limitCents: bestAsk,
      reason: "rest-backtest trade",
    };

    if (!dryRun) {
      await appendShadowLine(
        { ctx, decision, priceCents: bestAsk, side: "yes" },
        {
          manifestPath: "alpha/tennis-tour-pinnacle-novig/program.json",
          programRoot: "alpha/tennis-tour-pinnacle-novig",
        },
      );
    }
    shadowAppended++;
  }

  console.log(`batch-shadow-rest summary:
  dbPath:    ${dbPath}
  dryRun:    ${dryRun}
  processed: ${processed}
  skipped:   ${skipped}
  appended:  ${shadowAppended}`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
