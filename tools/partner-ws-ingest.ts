#!/usr/bin/env bun
/**
 * Ingest Bun.WebView Pandora WS capture → CoefficientStore → partner_ledger odds_book.
 *
 *   # Process latest capture (or capture live)
 *   bun run partner:ws-ingest
 *   bun run partner:ws-ingest -- --jsonl=research/cache/partner-ws-capture/ws-….jsonl
 *   bun run partner:ws-ingest -- --capture --sport=220 --seconds=25
 *   bun run partner:ws-ingest -- --capture --url="$LIVE_DESKTOP_URL" --seconds=30
 *   bun run partner:ws-ingest -- --out-id=out-SPEN-1 --partner-code=SPEN --json
 *
 * @see https://bun.com/docs/runtime/webview
 */
// @see https://bun.com/docs/runtime/webview
// @see https://bun.com/docs/runtime/sqlite
import { openEventStore } from "../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../src/institutions/event-store/paths.ts";
import { runWebViewWsPipeline } from "../src/partner/webview-ws-pipeline.ts";

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function main(): Promise<void> {
  const db = openEventStore({ dbPath: DEFAULT_EVENT_STORE_DB });
  const capture = hasFlag("capture");
  const jsonl = argValue("jsonl");
  const noLedger = hasFlag("no-ledger");

  try {
    const result = await runWebViewWsPipeline({
      capture,
      jsonl,
      sport: argValue("sport"),
      url: argValue("url") ?? process.env.LIVE_DESKTOP_URL,
      seconds: Number(argValue("seconds") ?? "25") || 25,
      outId: argValue("out-id") ?? "webview-plive",
      partnerId: argValue("partner-id") ?? "partner-default",
      partnerCode: argValue("partner-code") ?? "PLIVE",
      writeLedger: !noLedger,
      db,
    });

    const payload = {
      capturePath: result.capturePath,
      pricedEvents: result.pricedEvents,
      pricedLines: result.pricedLines,
      ledgerId: result.ledgerId,
      report: result.report,
      sampleMarkets: result.sampleMarkets,
    };

    if (hasFlag("json")) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(
        `webview ingest: events=${result.pricedEvents} lines=${result.pricedLines} capture=${result.capturePath ?? "—"}`,
      );
      console.log(
        `  binaryHeaders=${result.report.binaryHeaders} gzip=${result.report.gzipBodies} ingests=${result.report.coefficientIngests}`,
      );
      if (result.ledgerId) console.log(`  ledger odds_book id=${result.ledgerId}`);
      for (const m of result.sampleMarkets.slice(0, 8)) {
        console.log(
          `  · ${m.ticker}  home=${m.homePrice ?? "—"} away=${m.awayPrice ?? "—"}`,
        );
      }
      if (result.report.errors.length) {
        console.error("  errors:", result.report.errors.slice(0, 5).join(" | "));
      }
      if (result.pricedLines === 0) {
        console.error(
          "  No priced lines — re-run with --capture --seconds=30 or a signed LIVE_DESKTOP_URL",
        );
        process.exitCode = 2;
      }
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  }
}

await main();
