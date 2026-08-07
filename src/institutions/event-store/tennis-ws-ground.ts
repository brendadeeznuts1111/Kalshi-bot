// @see https://bun.com/docs/runtime/webview
// @see https://bun.com/docs/runtime/image
// @see https://bun.com/docs/runtime/file-io#writing-files-bun-write
// @see https://bun.com/docs/runtime/file-io#reading-files-bun-file
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
import {
  resolveTennisLeadMinutes,
  resolveTennisWatchLimit,
  TENNIS_WS_GROUND_THUMB_HEIGHT,
  TENNIS_WS_GROUND_THUMB_WIDTH,
  TENNIS_WS_GROUND_WEBP_QUALITY,
  TENNIS_WS_GROUND_WEBVIEW_HEIGHT,
  TENNIS_WS_GROUND_WEBVIEW_WIDTH,
} from "./tennis-lane-constants.ts";
import {
  buildVisualSnapshotMeta,
  type BunWebViewOptions,
  type VisualSnapshotMeta,
} from "./visual-snapshot-meta.ts";

export const TENNIS_WS_GROUND_DIR = joinPath("research/cache/tennis-ws-ground");
export const TENNIS_WS_GROUND_LATEST = join(TENNIS_WS_GROUND_DIR, "latest.json");

export type TennisWsGroundArtifact = {
  at: string;
  dashboardHtml: string;
  dashboardPng: string;
  thumbWebp: string;
  webview: boolean;
  image: boolean;
  /** Bun-native capture provenance; absent only on legacy/injected artifacts. */
  snapshotMeta?: VisualSnapshotMeta;
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
  snapshotMeta: VisualSnapshotMeta;
  watchEvents: number;
  watchTickers: number;
  wsTicks: number;
  restTicks: number;
  rows: number;
  watchWithWs: number;
  wsExchangeClockPct: number | null;
  linkedEventsWithWs: number;
};

function resolveWebViewBackend(): BunWebViewOptions["backend"] {
  return process.platform === "darwin" ? "webkit" : "chrome";
}

function hasWebView(): boolean {
  return typeof Bun.WebView === "function";
}

function hasImagePipeline(): boolean {
  return typeof Bun.Image === "function";
}

/** Write dashboard PNG + WebP thumb via Bun.WebView + Bun.Image (webkit on macOS, chrome elsewhere). */
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
    leadMinutes: resolveTennisLeadMinutes(options.leadMinutes),
    limit: resolveTennisWatchLimit(options.limit),
  });
  const html = renderTennisWsDashboardHtml(model);
  const dashboardHtml = join(outDir, "dashboard.html");
  const dashboardPng = join(outDir, "dashboard.png");
  const thumbWebp = join(outDir, "dashboard-thumb.webp");
  await Bun.write(dashboardHtml, html);

  let webviewCaptured = false;
  let imageCaptured = false;
  let webviewError: string | null = null;
  let imageError: string | null = null;

  if (!options.htmlOnly && hasWebView()) {
    // @see https://bun.com/docs/runtime/webview — data: URL navigation + screenshot
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    const viewOptions: BunWebViewOptions = {
      width: TENNIS_WS_GROUND_WEBVIEW_WIDTH,
      height: TENNIS_WS_GROUND_WEBVIEW_HEIGHT,
      backend: resolveWebViewBackend(),
      url: dataUrl,
    };
    try {
      await using view = new Bun.WebView(viewOptions);
      await view.evaluate("document.fonts.ready.then(() => true)");
      await Bun.write(
        dashboardPng,
        await view.screenshot({ format: "png", encoding: "buffer" }),
      );
      webviewCaptured = true;

      if (hasImagePipeline()) {
        // @see https://bun.com/docs/runtime/image — chain resize + webp encode
        try {
          await Bun.file(dashboardPng)
            .image()
            .resize(TENNIS_WS_GROUND_THUMB_WIDTH, TENNIS_WS_GROUND_THUMB_HEIGHT, { fit: "inside" })
            .webp({ quality: TENNIS_WS_GROUND_WEBP_QUALITY })
            .write(thumbWebp);
          imageCaptured = true;
        } catch (error) {
          imageError = errorMessage(error);
        }
      }
    } catch (error) {
      // WebView or Image unavailable at runtime — HTML artifact still written
      webviewError = errorMessage(error);
    }
  }

  const snapshotMeta = await buildVisualSnapshotMeta({
    capturedAt: model.at,
    backend: resolveWebViewBackend(),
    width: TENNIS_WS_GROUND_WEBVIEW_WIDTH,
    height: TENNIS_WS_GROUND_WEBVIEW_HEIGHT,
    webviewCaptured,
    webviewAttempted: !options.htmlOnly,
    webviewError,
    imageGenerated: imageCaptured,
    imageAttempted: webviewCaptured && hasImagePipeline(),
    imageError,
    sourcePath: dashboardPng,
    thumbnailPath: thumbWebp,
  });

  return {
    at: model.at,
    dashboardHtml,
    dashboardPng,
    thumbWebp,
    webview: webviewCaptured,
    image: imageCaptured,
    snapshotMeta,
    model,
  };
}

export async function persistTennisWsGroundArtifact(
  artifact: TennisWsGroundArtifact,
  latestPath: string = TENNIS_WS_GROUND_LATEST,
): Promise<TennisWsGroundLatest> {
  const snapshotMeta =
    artifact.snapshotMeta ??
    (await buildVisualSnapshotMeta({
      capturedAt: artifact.at,
      backend: resolveWebViewBackend(),
      width: TENNIS_WS_GROUND_WEBVIEW_WIDTH,
      height: TENNIS_WS_GROUND_WEBVIEW_HEIGHT,
      webviewCaptured: artifact.webview,
      webviewAttempted: artifact.webview,
      imageGenerated: artifact.image,
      imageAttempted: artifact.image,
      sourcePath: artifact.dashboardPng,
      thumbnailPath: artifact.thumbWebp,
    }));
  const latest: TennisWsGroundLatest = {
    at: artifact.at,
    dashboardHtml: artifact.dashboardHtml,
    dashboardPng: artifact.dashboardPng,
    thumbWebp: artifact.thumbWebp,
    webview: artifact.webview,
    image: artifact.image,
    snapshotMeta,
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
