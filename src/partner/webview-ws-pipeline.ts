/**
 * End-to-end: Bun.WebView capture (or JSONL) → coefficient ingest → ledger odds_book.
 */
// @see https://bun.com/docs/runtime/sqlite
import type { Database } from "bun:sqlite";
import { CoefficientStore } from "./fantasy-ultra/coefficient-store.ts";
import { writeOddsBookSnapshot } from "./ledger.ts";
import { capturePandoraViaWebView } from "./webview-ws-capture.ts";
import {
  findLatestWebViewCapture,
  ingestWebViewWsFrames,
  ingestWebViewWsJsonl,
  type WebViewIngestReport,
} from "./webview-ws-ingest.ts";

export type WebViewPipelineOptions = {
  /** Capture live via WebView (default false if jsonl provided) */
  capture?: boolean;
  sport?: string;
  url?: string;
  seconds?: number;
  /** Explicit JSONL path; else latest under cache dir */
  jsonl?: string;
  outId?: string;
  partnerId?: string;
  partnerCode?: string;
  /** Write partner_ledger odds_book row */
  writeLedger?: boolean;
  db?: Database;
};

export type WebViewPipelineResult = {
  capturePath: string | null;
  report: WebViewIngestReport;
  pricedEvents: number;
  pricedLines: number;
  markets: ReturnType<CoefficientStore["toPartnerMarkets"]>;
  sampleMarkets: ReturnType<CoefficientStore["toPartnerMarkets"]>;
  ledgerId: string | null;
  store: CoefficientStore;
};

/**
 * Run capture (optional) + ingest + optional ledger write.
 */
export async function runWebViewWsPipeline(
  options: WebViewPipelineOptions = {},
): Promise<WebViewPipelineResult> {
  let capturePath: string | null = options.jsonl ?? null;
  let framesIngest: Awaited<ReturnType<typeof ingestWebViewWsJsonl>> | null =
    null;

  if (options.capture || (!capturePath && options.capture !== false && !options.jsonl)) {
    // explicit capture=true, or neither jsonl nor capture=false
  }

  const doCapture =
    options.capture === true ||
    (options.capture !== false && !options.jsonl && !options.capture);

  // Prefer: if jsonl set, only jsonl; if capture true, capture; if both unset, try latest then capture
  if (options.jsonl) {
    framesIngest = await ingestWebViewWsJsonl(options.jsonl);
    capturePath = options.jsonl;
  } else if (options.capture === true) {
    const cap = await capturePandoraViaWebView({
      ...(options.sport !== undefined ? { sport: options.sport } : {}),
      ...(options.url !== undefined ? { url: options.url } : {}),
      ...(options.seconds !== undefined ? { seconds: options.seconds } : {}),
    });
    capturePath = cap.outPath;
    const { store, report } = ingestWebViewWsFrames(cap.frames);
    framesIngest = { store, report, path: cap.outPath };
  } else {
    const latest = await findLatestWebViewCapture();
    if (latest) {
      framesIngest = await ingestWebViewWsJsonl(latest);
      capturePath = latest;
    } else if (doCapture) {
      const cap = await capturePandoraViaWebView({
        ...(options.sport !== undefined ? { sport: options.sport } : {}),
        ...(options.url !== undefined ? { url: options.url } : {}),
        ...(options.seconds !== undefined ? { seconds: options.seconds } : {}),
      });
      capturePath = cap.outPath;
      const { store, report } = ingestWebViewWsFrames(cap.frames);
      framesIngest = { store, report, path: cap.outPath };
    } else {
      throw new Error(
        "No WebView capture JSONL found — pass --jsonl=… or --capture",
      );
    }
  }

  if (!framesIngest) {
    throw new Error("webview pipeline: ingest failed");
  }

  const { store, report } = framesIngest;
  const markets = store.toPartnerMarkets();
  const sampleMarkets = markets.slice(0, 12);

  let ledgerId: string | null = null;
  if (options.writeLedger !== false && options.db) {
    const row = writeOddsBookSnapshot(options.db, {
      outId: options.outId ?? "webview-plive",
      partnerId: options.partnerId ?? "partner-default",
      partnerCode: options.partnerCode ?? "PLIVE",
      pricedLines: report.pricedLines,
      pricedEvents: report.pricedEvents,
      markets: sampleMarkets,
      source: "bun.webview+cdp+pandora",
      capturePath: capturePath ?? undefined,
    });
    ledgerId = row.id;
  }

  return {
    capturePath,
    report,
    pricedEvents: report.pricedEvents,
    pricedLines: report.pricedLines,
    markets,
    sampleMarkets,
    ledgerId,
    store,
  };
}
