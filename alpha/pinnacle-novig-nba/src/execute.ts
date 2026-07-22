// @see https://bun.com/docs/runtime/networking/fetch#sending-an-http-request
/**
 * Live requires BOTH: `--live` CLI flag AND `ALPHA_LIVE=<program-name>` env.
 * Env names the program so a generic export cannot arm every tenant.
 */
import { placeOrder } from "../../../src/bot/kalshi-client.ts";
import { MIN_CONTRACTS, passesThreshold } from "./fees.ts";
import { loadProgramManifest } from "./program.ts";
import {
  addEventExposure,
  wouldExceedEventCap,
} from "./exposure.ts";
import { appendShadowLine } from "./shadow.ts";
import {
  buildSignalContext,
  decide,
  type BookSnapshot,
  type SignalContext,
} from "./signal.ts";

export type ExecuteOptions = {
  live?: boolean;
  ticker: string;
  eventId: string;
  book: BookSnapshot;
  pModel: number;
  components: Record<string, number>;
  priceCents: number;
  contracts?: number;
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

  const ctx: SignalContext = {
    ticker: options.ticker,
    eventId: options.eventId,
    book: options.book,
    pModel: options.pModel,
    components: options.components,
    contracts: options.contracts ?? minContracts,
  };

  const built = await buildSignalContext({
    ticker: options.ticker,
    eventId: options.eventId,
    book: options.book,
    kalshiPriceCents: options.priceCents,
  });
  if (built) {
    ctx.pModel = built.pModel;
    ctx.components = built.components;
    ctx.eventId = built.eventId;
  }

  let decision = decide(ctx, minContracts);

  if (decision.action === "trade") {
    if (
      !passesThreshold(ctx.pModel, options.priceCents, decision.contracts ?? minContracts)
    ) {
      decision = {
        action: "skip",
        reason: "below fee-aware threshold after ceil fee math",
      };
    } else if (
      wouldExceedEventCap(
        ctx.eventId,
        decision.contracts ?? minContracts,
        manifest.gates.pilotMaxContracts,
      )
    ) {
      decision = {
        action: "skip",
        reason: `event exposure cap (${manifest.gates.pilotMaxContracts} contracts per eventId)`,
      };
    }
  }

  const shadowStatuses = new Set<typeof manifest.status>(["shadow", "pilot"]);
  const armed = liveArmed(manifest.name, options.live === true);

  await appendShadowLine({
    ctx,
    decision,
    priceCents: options.priceCents,
    side: decision.side ?? "yes",
  });

  if (decision.action === "skip") {
    console.log(`Skip: ${decision.reason}`);
    return;
  }

  if (shadowStatuses.has(manifest.status) || !armed) {
    if (manifest.status === "live" && !armed) {
      console.log("Live blocked — set ALPHA_LIVE=" + manifest.name + " and pass --live");
    } else {
      console.log(`Shadow/pilot log appended (${manifest.status})`);
    }
    return;
  }

  addEventExposure(ctx.eventId, decision.contracts ?? minContracts);
  const result = await placeOrder({
    ticker: options.ticker,
    side: decision.side ?? "yes",
    count: decision.contracts ?? minContracts,
    priceCents: decision.limitCents ?? options.priceCents,
    dryRun: false,
  });
  console.log(`Live order: ${result.orderId}`);
}

if (import.meta.main) {
  const live = Bun.argv.includes("--live");
  const ticker = Bun.argv.find((a) => a.startsWith("--ticker="))?.slice("--ticker=".length);
  const eventId =
    Bun.argv.find((a) => a.startsWith("--event="))?.slice("--event=".length) ?? "unknown-event";
  const priceArg = Bun.argv.find((a) => a.startsWith("--price="))?.slice("--price=".length);
  const pArg = Bun.argv.find((a) => a.startsWith("--p="))?.slice("--p=".length);
  if (!ticker || !priceArg || !pArg) {
    console.error(
      "Usage: bun src/execute.ts --ticker=KX... --event=evt-1 --price=55 --p=0.58 [--live]  (requires ALPHA_LIVE=<name>)",
    );
    process.exit(1);
  }
  const priceCents = Number(priceArg);
  await executeOnce({
    live,
    ticker,
    eventId,
    book: { ts: Date.now(), bids: [], asks: [{ priceCents, size: 100 }], seq: 1 },
    pModel: Number(pArg),
    components: { pinnacle_novig: Number(pArg) },
    priceCents,
  });
}
