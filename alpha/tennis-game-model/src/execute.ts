/**
 * One shadow tick from event-store book_ticks (no network).
 */
import { asKalshiMarketTicker } from "../../../src/institutions/event-store/brands.ts";
import { DEFAULT_EVENT_STORE_DB } from "../../../src/institutions/event-store/paths.ts";
import { openEventStore } from "../../../src/institutions/event-store/open-db.ts";
import { latestBookTickForTicker } from "./book-context.ts";
import { MIN_CONTRACTS, passesThreshold } from "./fees.ts";
import { loadProgramManifest } from "./program.ts";
import { appendShadowLine } from "./shadow.ts";
import { buildSignalContext, decide, midCents } from "./signal.ts";

export type ExecuteOptions = {
  live?: boolean;
  ticker: string;
  eventId?: string;
  dbPath?: string;
};

export function liveArmed(programName: string, cliLive: boolean): boolean {
  return cliLive && Bun.env.ALPHA_LIVE === programName;
}

export async function executeOnce(options: ExecuteOptions): Promise<void> {
  const manifest = await loadProgramManifest();
  const minContracts = manifest.minContracts ?? MIN_CONTRACTS;

  if (manifest.status === "killed") {
    throw new Error(`Program ${manifest.name} is killed — no execution`);
  }

  const ticker = asKalshiMarketTicker(options.ticker);
  const db = openEventStore({ dbPath: options.dbPath ?? DEFAULT_EVENT_STORE_DB, readonly: true });
  const tick = latestBookTickForTicker(db, ticker);
  if (!tick) {
    console.error(`No book_ticks for ${options.ticker} (kalshi-ws or kalshi-rest)`);
    process.exit(1);
  }

  const built = buildSignalContext({
    ticker: options.ticker,
    eventId: options.eventId ?? tick.eventId,
    book: tick.book,
  });
  if (!built) {
    console.log("Skip: stub p_model unavailable — no tradeable mid in book_ticks");
    return;
  }

  const ctx = { ...built, contracts: minContracts };
  let decision = decide(ctx, minContracts);

  const priceCents = ctx.book.asks[0]?.priceCents ?? midCents(ctx.book) ?? 50;

  if (decision.action === "trade") {
    if (!passesThreshold(ctx.pModel, priceCents, decision.contracts ?? minContracts)) {
      decision = {
        action: "skip",
        reason: "below fee-aware threshold after ceil fee math",
      };
    }
  }

  const shadowStatuses = new Set<typeof manifest.status>(["shadow", "pilot"]);
  const armed = liveArmed(manifest.name, options.live === true);

  await appendShadowLine({
    ctx,
    decision,
    priceCents,
    side: decision.side ?? "yes",
  });

  console.log(
    `Book: source=${tick.source} clock=${tick.sourceClock} mid=${tick.midCents} spread=${tick.spreadCents} recv_ts=${tick.recvTs}`,
  );

  if (decision.action === "skip") {
    console.log(`Skip: ${decision.reason}`);
    return;
  }

  if (shadowStatuses.has(manifest.status) || !armed) {
    if (manifest.status === "live" && !armed) {
      console.log(`Live blocked — set ALPHA_LIVE=${manifest.name} and pass --live`);
    } else {
      console.log(`Shadow/pilot log appended (${manifest.status})`);
    }
    return;
  }

  console.log("Live execution not wired for tennis-game-model — shadow only");
}
