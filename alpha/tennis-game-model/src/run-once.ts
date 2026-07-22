/**
 * One shadow tick: read latest book_ticks from event-store → executeOnce.
 *
 * Usage (from program root):
 *   bun src/run-once.ts --ticker=KXITFMATCH-26JUL22AAA-BBB --fetch-book
 *   bun run alpha:run -- --program=tennis-game-model --ticker=KXITFMATCH-... --fetch-book
 */
import { asKalshiMarketTicker } from "../../../src/institutions/event-store/brands.ts";
import { executeOnce } from "./execute.ts";

function arg(name: string): string | undefined {
  return Bun.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

if (import.meta.main) {
  const ticker = arg("ticker");
  const eventId = arg("event");
  const dbPath = arg("db");
  const live = Bun.argv.includes("--live");
  const fetchBook = Bun.argv.includes("--fetch-book");

  if (!ticker || !fetchBook) {
    console.error(
      "Usage: bun src/run-once.ts --ticker=KXITFMATCH-... --fetch-book [--event=evt-id] [--db=path/to/event-store.db] [--live]",
    );
    process.exit(1);
  }

  asKalshiMarketTicker(ticker);

  await executeOnce({
    live,
    ticker,
    eventId,
    dbPath,
  });
}
