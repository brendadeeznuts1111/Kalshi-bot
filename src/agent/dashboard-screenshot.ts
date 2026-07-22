// @see https://bun.com/docs/runtime/image#input
// @see https://bun.com/docs/runtime/hashing#bun-cryptohasher
// @see https://bun.com/docs/runtime/webview#new-bun-webview-options
import { EVIDENCE_DIR, joinPath } from "../research/paths.ts";
import { DASHBOARD_ROUTES } from "./dashboard-views.ts";
import { DASHBOARD_PROBE_EVAL, type DashboardPageProbe } from "./verify-dashboard.ts";
import {
  assertAllowlistedScreenshotUrl,
  defaultDashboardScreenshotUrl,
  DashboardScreenshotUrlError,
} from "./dashboard-screenshot-url.ts";

export { DashboardScreenshotUrlError, assertAllowlistedScreenshotUrl } from "./dashboard-screenshot-url.ts";

export type DashboardImageMeta = {
  width: number;
  height: number;
  format: string;
};

export type DashboardScreenshotWire = {
  ok: true;
  full: string;
  thumbnail: string;
  bytes: number;
  sha256: string;
  image: DashboardImageMeta;
  capturedAt: string;
};

export type DashboardScreenshotManifest = DashboardScreenshotWire & {
  kind: "DashboardScreenshot";
  fullPath: string;
  thumbnailPath: string;
};

export type ProcessScreenshotOptions = {
  outDir?: string;
  slug?: string;
  thumbMaxWidth?: number;
  thumbMaxHeight?: number;
};

export type CaptureDashboardScreenshotOptions = {
  dashboardUrl?: string;
  outDir?: string;
  width?: number;
  height?: number;
  waitMs?: number;
};

export type CaptureDashboardScreenshotDeps = {
  probeAndCapture?: (url: string, opts: CaptureDashboardScreenshotOptions) => Promise<Buffer>;
};

export const LATEST_DASHBOARD_SCREENSHOT_MANIFEST = "latest-dashboard-screenshot.json";

export function sha256HexBytes(data: Uint8Array): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(data);
  return hasher.digest("hex");
}

export function dashboardEvidenceSlug(at = new Date()): string {
  return `dashboard-${at.toISOString().replace(/[:.]/g, "-")}`;
}

export function evidenceUrlPath(filename: string): string {
  return `/evidence/${filename}`;
}

/** Zero-copy header read — no full pixel decode. */
export async function readPngImageMeta(png: Uint8Array): Promise<DashboardImageMeta> {
  const meta = await new Bun.Image(png).metadata();
  return {
    width: meta.width,
    height: meta.height,
    format: meta.format ?? "png",
  };
}

export async function buildDashboardThumbnail(
  png: Uint8Array,
  maxWidth = 320,
  maxHeight = 240,
): Promise<Uint8Array> {
  return new Uint8Array(
    await new Bun.Image(png)
      .resize(maxWidth, maxHeight, { fit: "inside", withoutEnlargement: true })
      .png()
      .bytes(),
  );
}

export async function processDashboardScreenshotBytes(
  png: Buffer,
  options: ProcessScreenshotOptions = {},
): Promise<DashboardScreenshotManifest> {
  const outDir = options.outDir ?? EVIDENCE_DIR;
  const slug = options.slug ?? dashboardEvidenceSlug();
  const fullName = `${slug}.png`;
  const thumbName = `${slug}-thumb.png`;
  const fullPath = joinPath(outDir, fullName);
  const thumbnailPath = joinPath(outDir, thumbName);

  const [image, thumbBytes] = await Promise.all([
    readPngImageMeta(png),
    buildDashboardThumbnail(png, options.thumbMaxWidth, options.thumbMaxHeight),
  ]);
  const sha256 = sha256HexBytes(png);
  const capturedAt = new Date().toISOString();

  await Bun.write(fullPath, png);
  await Bun.write(thumbnailPath, thumbBytes);

  const wire: DashboardScreenshotManifest = {
    kind: "DashboardScreenshot",
    ok: true,
    full: evidenceUrlPath(fullName),
    thumbnail: evidenceUrlPath(thumbName),
    bytes: png.byteLength,
    sha256,
    image,
    capturedAt,
    fullPath,
    thumbnailPath,
  };

  await Bun.write(joinPath(outDir, LATEST_DASHBOARD_SCREENSHOT_MANIFEST), JSON.stringify(wire, null, 2) + "\n");
  return wire;
}

async function defaultProbeAndCapture(
  url: string,
  opts: CaptureDashboardScreenshotOptions,
): Promise<Buffer> {
  assertAllowlistedScreenshotUrl(url);
  const backend = process.platform === "darwin" ? "webkit" : "chrome";
  await using view = new Bun.WebView({
    width: opts.width ?? 1280,
    height: opts.height ?? 860,
    backend,
  });
  await view.navigate(url);
  if ((opts.waitMs ?? 1200) > 0) {
    await Bun.sleep(opts.waitMs ?? 1200);
  }
  await view.evaluate<DashboardPageProbe>(DASHBOARD_PROBE_EVAL);
  const png = await view.screenshot({ format: "png", encoding: "buffer" });
  return png;
}

export async function captureDashboardScreenshot(
  options: CaptureDashboardScreenshotOptions = {},
  deps: CaptureDashboardScreenshotDeps = {},
): Promise<DashboardScreenshotManifest> {
  const dashboardUrl = options.dashboardUrl ?? defaultDashboardScreenshotUrl();
  assertAllowlistedScreenshotUrl(dashboardUrl);
  const capture = deps.probeAndCapture ?? defaultProbeAndCapture;
  const png = await capture(dashboardUrl, options);
  return processDashboardScreenshotBytes(png, { outDir: options.outDir });
}

export async function loadLatestDashboardScreenshot(
  outDir: string = EVIDENCE_DIR,
): Promise<DashboardScreenshotManifest | null> {
  const manifestPath = joinPath(outDir, LATEST_DASHBOARD_SCREENSHOT_MANIFEST);
  const file = Bun.file(manifestPath);
  if (!(await file.exists())) return null;
  try {
    const raw = (await file.json()) as DashboardScreenshotManifest;
    if (raw.kind !== "DashboardScreenshot" || !raw.ok) return null;
    return raw;
  } catch {
    return null;
  }
}

export function formatBytes(n: number): string {
  return n.toLocaleString("en-US");
}

export function renderAuditEvidenceSection(evidence: DashboardScreenshotManifest | null): string {
  if (!evidence) {
    return `<h2>Audit evidence</h2>
<p><em>No dashboard screenshot yet.</em> Use <strong>Screenshot</strong> in the toolbar or <code>POST ${DASHBOARD_ROUTES.screenshot}</code>.</p>
<p class="audit-hint">Evidence chain: visual (thumbnail), cryptographic (SHA-256), structural (dimensions/format).</p>`;
  }

  const { image } = evidence;
  return `<h2>Audit evidence</h2>
<div class="audit-evidence">
  <div class="audit-visual">
    <a href="${evidence.full}" target="_blank" rel="noopener">
      <img src="${evidence.thumbnail}" alt="Dashboard screenshot thumbnail" width="320" />
    </a>
    <p><button class="action secondary" type="button" data-capture-screenshot>Recapture</button></p>
  </div>
  <dl class="audit-meta">
    <dt>Captured</dt><dd><code>${evidence.capturedAt}</code></dd>
    <dt>SHA-256</dt><dd><code>${evidence.sha256}</code></dd>
    <dt>Size</dt><dd>${formatBytes(evidence.bytes)} bytes</dd>
    <dt>Dimensions</dt><dd>${image.width}×${image.height} ${image.format}</dd>
    <dt>Full image</dt><dd><a href="${evidence.full}">${evidence.full}</a></dd>
  </dl>
</div>
<p class="audit-hint">Three verification dimensions: visual (thumbnail), cryptographic (SHA-256), structural (${image.width}×${image.height} ${image.format}).</p>`;
}

export function auditEvidenceClientScript(): string {
  return `<script>
(function () {
  const btn = document.getElementById("capture-screenshot");
  btn?.addEventListener("click", async () => {
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = "Capturing…";
    try {
      const res = await fetch("${DASHBOARD_ROUTES.screenshot}", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || res.statusText);
      location.reload();
    } catch (err) {
      alert(String(err.message || err));
      btn.disabled = false;
      btn.textContent = label;
    }
  });
})();
</script>`;
}
