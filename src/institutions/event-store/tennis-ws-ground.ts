// @see https://bun.com/docs/runtime/webview
// @see https://bun.com/docs/runtime/image
// @see https://bun.com/docs/runtime/file-io#writing-files-bun-write
/**
 * Visual ground for tennis WS book pipeline: WebView dashboard + Bun.Image thumb.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { ensureCacheDir } from "../../research/cache.ts";
import { joinPath } from "../../research/paths.ts";
import {
  loadTennisWsDashboardModel,
  renderTennisWsDashboardHtml,
  type TennisWsDashboardModel,
} from "./tennis-ws-dashboard.ts";

export const TENNIS_WS_GROUND_DIR = joinPath("research/cache/tennis-ws-ground");
export const TENNIS_WS_GROUND_LATEST = join(TENNIS_WS_GROUND_DIR, "latest.json");

export type TennisWsGroundArtifact = {
  at: string;
  dashboardHtml: string;
  dashboardPng: string;
  thumbWebp: string;
  webview: boolean;
  image: boolean;
  model: TennisWsDashboardModel;
};

/** Compact index written to latest.json (mirrors canary artifact pattern). */
export type TennisWsGroundLatest = {
  at: string;
  dashboardHtml: string;
  dashboardPng: string;
  thumbWebp: string;
  webview: boolean;
  image: boolean;
  watchEvents: number;
  watchTickers: number;
  wsTicks: number;
  restTicks: number;
  rows: number;
  watchWithWs: number;
  wsExchangeClockPct: number | null;
  linkedEventsWithWs: number;
};

function hasWebView(): boolean {
  return typeof (Bun as { WebView?: unknown }).WebView === "function";
}

function hasImagePipeline(): boolean {
  return typeof (Bun as { Image?: unknown }).Image === "function";
}

/** Write dashboard PNG + WebP thumb via Bun.WebView + Bun.Image (macOS WebKit default). */
export async function captureTennisWsGround(
  db: Database,
  options: {
    leadMinutes?: number;
    limit?: number;
    outDir?: string;
    /** When true, skip WebView and only write HTML artifact. */
    htmlOnly?: boolean;
  } = {},
): Promise<TennisWsGroundArtifact> {
  await ensureCacheDir();
  const outDir = options.outDir ?? TENNIS_WS_GROUND_DIR;
  mkdirSync(outDir, { recursive: true });

  const model = loadTennisWsDashboardModel(db, {
    leadMinutes: options.leadMinutes,
    limit: options.limit,
  });
  const html = renderTennisWsDashboardHtml(model);
  const dashboardHtml = join(outDir, "dashboard.html");
  const dashboardPng = join(outDir, "dashboard.png");
  const thumbWebp = join(outDir, "dashboard-thumb.webp");
  await Bun.write(dashboardHtml, html);

  const webview = hasWebView();
  const image = hasImagePipeline();

  if (!options.htmlOnly && webview) {
    // @see https://bun.com/docs/runtime/webview — data: URL navigation + screenshot
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    await using view = new Bun.WebView({ width: 1280, height: 720 });
    await view.navigate(dataUrl);
    await view.evaluate("document.fonts.ready");
    await Bun.write(
      dashboardPng,
      await view.screenshot({ format: "png", encoding: "buffer" }),
    );

    if (image) {
      // @see https://bun.com/docs/runtime/image — chain resize + webp encode
      await Bun.file(dashboardPng)
        .image()
        .resize(480, 270, { fit: "inside" })
        .webp({ quality: 82 })
        .write(thumbWebp);
    }
  }

  return {
    at: model.at,
    dashboardHtml,
    dashboardPng,
    thumbWebp,
    webview: webview && !options.htmlOnly,
    image: image && !options.htmlOnly && webview,
    model,
  };
}

export async function persistTennisWsGroundArtifact(
  artifact: TennisWsGroundArtifact,
  latestPath: string = TENNIS_WS_GROUND_LATEST,
): Promise<TennisWsGroundLatest> {
  const latest: TennisWsGroundLatest = {
    at: artifact.at,
    dashboardHtml: artifact.dashboardHtml,
    dashboardPng: artifact.dashboardPng,
    thumbWebp: artifact.thumbWebp,
    webview: artifact.webview,
    image: artifact.image,
    watchEvents: artifact.model.watchEvents,
    watchTickers: artifact.model.watchTickers,
    wsTicks: artifact.model.wsTicks,
    restTicks: artifact.model.restTicks,
    rows: artifact.model.rows.length,
    watchWithWs: artifact.model.coverage.watchWithWs,
    wsExchangeClockPct: artifact.model.coverage.wsExchangeClockPct,
    linkedEventsWithWs: artifact.model.coverage.linkedEventsWithWs,
  };
  await Bun.write(latestPath, JSON.stringify(latest, null, 2));
  return latest;
}

/** Read latest visual ground artifact (cache-only; no WebView invoke). */
export async function loadLatestWsGround(
  latestPath: string = TENNIS_WS_GROUND_LATEST,
): Promise<TennisWsGroundLatest | null> {
  const file = Bun.file(latestPath);
  if (!(await file.exists())) return null;
  try {
    return (await file.json()) as TennisWsGroundLatest;
  } catch {
    return null;
  }
}

export function formatTennisWsGroundLines(artifact: TennisWsGroundArtifact): string[] {
  const m = artifact.model;
  const lines = [
    "Tennis WS ground (Bun.WebView + Bun.Image)",
    `  at=${artifact.at}`,
    `  watch=${m.watchEvents} events / ${m.watchTickers} tickers`,
    `  book_ticks: ws=${m.wsTicks} rest=${m.restTicks} rows=${m.rows.length}`,
    `  coverage: watch_ws=${m.coverage.watchWithWs}/${m.coverage.watchTickers} linked+ws=${m.coverage.linkedEventsWithWs}/${m.coverage.linkedEventsTotal}`,
    `  html=${artifact.dashboardHtml}`,
  ];
  if (artifact.webview) lines.push(`  png=${artifact.dashboardPng}`);
  if (artifact.image) lines.push(`  thumb=${artifact.thumbWebp}`);
  if (!artifact.webview) {
    lines.push("  webview=skipped (Bun.WebView unavailable or --html-only)");
  }
  return lines;
}
