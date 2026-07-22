// @see https://bun.com/docs/runtime/networking/fetch#sending-an-http-request
/**
 * One shadow tick: fetch Pinnacle → map ticker → executeOnce (log only in shadow).
 *
 * Usage (from program root):
 *   bun src/run-once.ts --ticker=KXMLBGAME-26JUL242010ATHMIN-MIN --fetch-book
 *   bun src/run-once.ts --ticker=KXMLBGAME-26JUL242010ATHMIN-MIN --price=55 --sport=baseball_mlb
 */
import { joinPath } from "../../../src/research/paths.ts";
import { fetchOdds } from "../../../src/alpha/odds-feed.ts";
import { parseOddsEventsWire } from "../../../src/alpha/odds-types.ts";
import { fetchKalshiBookSnapshot } from "../../../src/bot/kalshi-market-data.ts";
import { asKalshiMarketTicker } from "../../../src/institutions/event-store/brands.ts";
import { executeOnce } from "./execute.ts";
import { setOddsEvents } from "./signal.ts";

function arg(name: string): string | undefined {
  return Bun.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function loadEvents(offline: boolean, sport: string) {
  if (offline) {
    console.error("Refusing --offline for baseline — live ODDS_API_KEY required for measuring stick data.");
    process.exit(1);
  }
  const { events } = await fetchOdds(sport);
  return events;
}

if (import.meta.main) {
  const ticker = arg("ticker");
  const priceArg = arg("price");
  const sport = arg("sport") ?? "baseball_mlb";
  const eventId = arg("event") ?? "pending-map";
  const live = Bun.argv.includes("--live");
  const offline = Bun.argv.includes("--offline");
  const fetchBook = Bun.argv.includes("--fetch-book");

  if (!ticker || (!priceArg && !fetchBook)) {
    console.error(
      "Usage: bun src/run-once.ts --ticker=KXMLBGAME-... (--price=55 | --fetch-book) [--sport=baseball_mlb] [--live]",
    );
    process.exit(1);
  }

  const events = await loadEvents(offline, sport);
  setOddsEvents(events);

  let book;
  let priceCents: number;
  if (fetchBook) {
    book = await fetchKalshiBookSnapshot(asKalshiMarketTicker(ticker));
    priceCents = book.asks[0]?.priceCents ?? book.bids[0]?.priceCents ?? 50;
  } else {
    priceCents = Number(priceArg);
    book = {
      ts: Date.now(),
      bids: [{ priceCents: Math.max(1, priceCents - 3), size: 50 }],
      asks: [{ priceCents, size: 100 }],
      seq: 1,
    };
  }

  await executeOnce({
    live,
    ticker,
    eventId,
    book,
    pModel: 0.5,
    components: { placeholder: 0.5 },
    priceCents,
  });
}
