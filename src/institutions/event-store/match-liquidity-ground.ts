// @see https://bun.com/docs/runtime/webview
// @see https://bun.com/docs/runtime/image
// @see https://bun.com/docs/runtime/file-io#writing-files-bun-write
// @see https://bun.com/docs/runtime/file-io#reading-files-bun-file
/**
 * Visual ground for match_liquidity: WebView dashboard + Bun.Image thumb.
 * Mirrors tennis-ws-ground capture pipeline (data: URL → PNG → WebP).
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { ensureCacheDir } from "../../research/cache.ts";
import { joinPath } from "../../research/paths.ts";
import {
  loadMatchLiquidityDashboardModel,
  renderMatchLiquidityDashboardHtml,
  type MatchLiquidityDashboardModel,
} from "./match-liquidity-dashboard.ts";
import {
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

export const MATCH_LIQUIDITY_GROUND_DIR = joinPath("research/cache/match-liquidity-ground");
export const MATCH_LIQUIDITY_GROUND_LATEST = join(MATCH_LIQUIDITY_GROUND_DIR, "latest.json");

export type MatchLiquidityGroundArtifact = {
  at: string;
  dashboardHtml: string;
  dashboardPng: string;
  thumbWebp: string;
  webview: boolean;
  image: boolean;
  /** Bun-native capture provenance; absent only on legacy/injected artifacts. */
  snapshotMeta?: VisualSnapshotMeta;
  model: MatchLiquidityDashboardModel;
};

export type MatchLiquidityGroundLatest = {
  at: string;
  dashboardHtml: string;
  dashboardPng: string;
  thumbWebp: string;
  webview: boolean;
  image: boolean;
  snapshotMeta: VisualSnapshotMeta;
  total: number;
  quoted: number;
  liquidityOk: number;
  tradable: number;
  rows: number;
};

function resolveWebViewBackend(): BunWebViewOptions["backend"] {
  return process.platform === "darwin" ? "webkit" : "chrome";
}

function hasWebView(): boolean {
  return typeof Bun.WebView === "function";
}

function hasImagePipeline(): boolean {
  // Prefer file().image() chain (tennis-ws-ground); Bun.Image class may also exist.
  return typeof Bun.Image === "function" || typeof (Bun.file as unknown) === "function";
}

/** Write dashboard PNG + WebP thumb via Bun.WebView + Bun.Image. */
export async function captureMatchLiquidityGround(
  db: Database,
  options: {
    limit?: number;
    outDir?: string;
    htmlOnly?: boolean;
  } = {},
): Promise<MatchLiquidityGroundArtifact> {
  await ensureCacheDir();
  const outDir = options.outDir ?? MATCH_LIQUIDITY_GROUND_DIR;
  mkdirSync(outDir, { recursive: true });

  const model = loadMatchLiquidityDashboardModel(db, { limit: options.limit });
  const html = renderMatchLiquidityDashboardHtml(model);
  const dashboardHtml = join(outDir, "dashboard.html");
  const dashboardPng = join(outDir, "dashboard.png");
  const thumbWebp = join(outDir, "dashboard-thumb.webp");
  await Bun.write(dashboardHtml, html);

  let webviewCaptured = false;
  let imageCaptured = false;
  let webviewError: string | null = null;
  let imageError: string | null = null;

  if (!options.htmlOnly && hasWebView()) {
    // @see https://bun.com/docs/runtime/webview
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
        // @see https://bun.com/docs/runtime/image
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
      // HTML still written
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

export async function persistMatchLiquidityGroundArtifact(
  artifact: MatchLiquidityGroundArtifact,
  latestPath: string = MATCH_LIQUIDITY_GROUND_LATEST,
): Promise<MatchLiquidityGroundLatest> {
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
  const latest: MatchLiquidityGroundLatest = {
    at: artifact.at,
    dashboardHtml: artifact.dashboardHtml,
    dashboardPng: artifact.dashboardPng,
    thumbWebp: artifact.thumbWebp,
    webview: artifact.webview,
    image: artifact.image,
    snapshotMeta,
    total: artifact.model.summary.total,
    quoted: artifact.model.summary.quoted,
    liquidityOk: artifact.model.summary.liquidityOk,
    tradable: artifact.model.summary.tradable,
    rows: artifact.model.rows.length,
  };
  await Bun.write(latestPath, JSON.stringify(latest, null, 2));
  return latest;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function loadLatestMatchLiquidityGround(
  latestPath: string = MATCH_LIQUIDITY_GROUND_LATEST,
): Promise<MatchLiquidityGroundLatest | null> {
  const file = Bun.file(latestPath);
  if (!(await file.exists())) return null;
  try {
    return (await file.json()) as MatchLiquidityGroundLatest;
  } catch {
    return null;
  }
}

export function formatMatchLiquidityGroundLines(artifact: MatchLiquidityGroundArtifact): string[] {
  const s = artifact.model.summary;
  const lines = [
    "Match liquidity ground (Bun.WebView + Bun.Image)",
    `  at=${artifact.at}`,
    `  rows=${s.total} quoted=${s.quoted} liq_ok=${s.liquidityOk} tradable=${s.tradable}`,
    `  table=${s.tablePresent ? "present" : "missing"}`,
    `  html=${artifact.dashboardHtml}`,
  ];
  if (artifact.webview) lines.push(`  png=${artifact.dashboardPng}`);
  if (artifact.image) lines.push(`  thumb=${artifact.thumbWebp}`);
  if (!artifact.webview) {
    lines.push("  webview=skipped (Bun.WebView unavailable or --html-only)");
  }
  return lines;
}
