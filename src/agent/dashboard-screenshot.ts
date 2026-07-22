// @see https://bun.com/docs/runtime/image#input
// @see https://bun.com/docs/runtime/image#metadata
// @see https://bun.com/docs/runtime/hashing#bun-cryptohasher
// @see https://bun.com/docs/runtime/webview#new-bun-webview-options
import {
  extractImageEvidenceMeta,
  resizeScreenshotPng,
} from "../../../lib/image-metadata.ts";
import {
  TEST_003,
  remediateScreenshotCapture,
  runTest003,
  type Test003Response,
} from "../../../lib/screenshot-remediation.ts";
import { resolve } from "node:path";
import { EVIDENCE_DIR, joinPath } from "../research/paths.ts";
import { DASHBOARD_ROUTES } from "./dashboard-views.ts";
import { DASHBOARD_PROBE_EVAL, type DashboardPageProbe } from "./verify-dashboard.ts";
import {
  assertAllowlistedScreenshotUrl,
  defaultDashboardScreenshotUrl,
  DashboardScreenshotUrlError,
} from "./dashboard-screenshot-url.ts";

export { DashboardScreenshotUrlError, assertAllowlistedScreenshotUrl } from "./dashboard-screenshot-url.ts";

/** Dashboard evidence thumbs default to 320×240 (audit card width). */
export const DASHBOARD_THUMB_MAX_WIDTH = 320;
export const DASHBOARD_THUMB_MAX_HEIGHT = 240;

export type DashboardImageMeta = {
  width: number;
  height: number;
  format: string;
  size?: number;
  digest?: string;
};

export type DashboardScreenshotWire = {
  ok: true;
  full: string;
  thumbnail: string;
  bytes: number;
  sha256: string;
  image: DashboardImageMeta;
  capturedAt: string;
  /** TEST-003 Bun.Image metadata gate (thumbnail bounds/format). */
  test003?: Pick<Test003Response, "code" | "title" | "status" | "ok" | "checks" | "remediation">;
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
  /** Override evidence output dir (tests only — production uses EVIDENCE_DIR). */
  outDir?: string;
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

/** Bun.Image.metadata + sha256 digest via monorepo SSOT. */
export async function readPngImageMeta(png: Uint8Array): Promise<DashboardImageMeta> {
  const meta = await extractImageEvidenceMeta(png, { algorithm: "sha256" });
  return {
    width: meta.width,
    height: meta.height,
    format: meta.format,
    size: meta.size,
    digest: meta.digest,
  };
}

export async function buildDashboardThumbnail(
  png: Uint8Array,
  maxWidth = DASHBOARD_THUMB_MAX_WIDTH,
  maxHeight = DASHBOARD_THUMB_MAX_HEIGHT,
): Promise<Uint8Array> {
  const { bytes } = await resizeScreenshotPng(png, { width: maxWidth, height: maxHeight });
  return bytes;
}

function toDashboardTest003Wire(
  result: Test003Response,
): NonNullable<DashboardScreenshotWire["test003"]> {
  return {
    code: result.code,
    title: result.title,
    status: result.status,
    ok: result.ok,
    checks: result.checks,
    remediation: result.remediation,
  };
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
  const thumbMaxWidth = options.thumbMaxWidth ?? DASHBOARD_THUMB_MAX_WIDTH;
  const thumbMaxHeight = options.thumbMaxHeight ?? DASHBOARD_THUMB_MAX_HEIGHT;

  const remediated = await remediateScreenshotCapture(png, {
    subject: "dashboard",
    algorithm: "sha256",
    thumbMaxWidth,
    thumbMaxHeight,
  });
  const image: DashboardImageMeta = {
    width: remediated.evidence.source.width,
    height: remediated.evidence.source.height,
    format: remediated.evidence.source.format,
    size: remediated.evidence.source.size,
    digest: remediated.evidence.source.digest,
  };
  const sha256 = image.digest ?? sha256HexBytes(png);
  const capturedAt = remediated.evidence.capturedAt;

  await Bun.write(fullPath, png);
  await Bun.write(thumbnailPath, remediated.thumbnailBytes);

  const wire: DashboardScreenshotManifest = {
    kind: "DashboardScreenshot",
    ok: true,
    full: evidenceUrlPath(fullName),
    thumbnail: evidenceUrlPath(thumbName),
    bytes: png.byteLength,
    sha256,
    image,
    capturedAt,
    test003: toDashboardTest003Wire(remediated),
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
  // Brief settle after probe so layout/fonts finish before capture.
  await Bun.sleep(150);
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
  return processDashboardScreenshotBytes(png, {
    outDir: options.outDir ?? deps.outDir,
  });
}

const MIN_EVIDENCE_BYTES = 500;

function minEvidenceBytes(outDir: string): number {
  return resolve(outDir) === resolve(EVIDENCE_DIR) ? MIN_EVIDENCE_BYTES : 0;
}

async function manifestFilesExist(
  manifest: DashboardScreenshotManifest,
  outDir: string,
): Promise<boolean> {
  const basename = (urlPath: string) => urlPath.replace(/^\/evidence\//, "");
  const fullPath = manifest.fullPath ?? joinPath(outDir, basename(manifest.full));
  const thumbPath = manifest.thumbnailPath ?? joinPath(outDir, basename(manifest.thumbnail));
  return (await Bun.file(fullPath).exists()) && (await Bun.file(thumbPath).exists());
}

/** Newest on-disk `dashboard-*.png` pair when manifest is missing or stale (e.g. after tests). */
async function findLatestDashboardScreenshotOnDisk(
  outDir: string,
): Promise<DashboardScreenshotManifest | null> {
  const glob = new Bun.Glob("dashboard-*.png");
  const candidates: Array<{ name: string; mtime: number }> = [];
  for await (const name of glob.scan({ cwd: outDir, onlyFiles: true })) {
    if (name.endsWith("-thumb.png")) continue;
    const path = joinPath(outDir, name);
    const stat = await Bun.file(path).stat();
    if ((stat.size ?? 0) < minEvidenceBytes(outDir)) continue;
    candidates.push({ name, mtime: stat.mtime?.getTime() ?? 0 });
  }
  candidates.sort((a, b) => b.mtime - a.mtime);

  for (const { name } of candidates) {
    const slug = name.replace(/\.png$/, "");
    const thumbName = `${slug}-thumb.png`;
    const fullPath = joinPath(outDir, name);
    const thumbnailPath = joinPath(outDir, thumbName);
    if (!(await Bun.file(thumbnailPath).exists())) continue;

    const png = Buffer.from(await Bun.file(fullPath).arrayBuffer());
    const thumbBytes = new Uint8Array(await Bun.file(thumbnailPath).arrayBuffer());
    const [source, thumbnail] = await Promise.all([
      extractImageEvidenceMeta(png, { algorithm: "sha256" }),
      extractImageEvidenceMeta(thumbBytes, { algorithm: "sha256" }),
    ]);
    const image: DashboardImageMeta = {
      width: source.width,
      height: source.height,
      format: source.format,
      size: source.size,
      digest: source.digest,
    };
    const sha256 = source.digest;
    const stat = await Bun.file(fullPath).stat();
    const capturedAt = stat.mtime?.toISOString() ?? new Date().toISOString();
    const test003 = runTest003(
      {
        kind: "ScreenshotEvidence",
        testId: TEST_003,
        capturedAt,
        subject: "dashboard",
        source,
        thumbnail,
      },
      {
        formats: ["png"],
        maxWidth: DASHBOARD_THUMB_MAX_WIDTH,
        maxHeight: DASHBOARD_THUMB_MAX_HEIGHT,
        minSize: 32,
      },
    );
    return {
      kind: "DashboardScreenshot",
      ok: true,
      full: evidenceUrlPath(name),
      thumbnail: evidenceUrlPath(thumbName),
      bytes: png.byteLength,
      sha256,
      image,
      capturedAt,
      test003: toDashboardTest003Wire(test003),
      fullPath,
      thumbnailPath,
    };
  }
  return null;
}

export async function loadLatestDashboardScreenshot(
  outDir: string = EVIDENCE_DIR,
): Promise<DashboardScreenshotManifest | null> {
  const manifestPath = joinPath(outDir, LATEST_DASHBOARD_SCREENSHOT_MANIFEST);
  const file = Bun.file(manifestPath);
  if (await file.exists()) {
    try {
      const raw = (await file.json()) as DashboardScreenshotManifest;
      if (
        raw.kind === "DashboardScreenshot" &&
        raw.ok &&
        (raw.bytes ?? 0) >= minEvidenceBytes(outDir) &&
        (await manifestFilesExist(raw, outDir))
      ) {
        return raw;
      }
    } catch {
      // fall through to disk scan
    }
  }
  return findLatestDashboardScreenshotOnDisk(outDir);
}

export function formatBytes(n: number): string {
  return n.toLocaleString("en-US");
}

export function renderAuditEvidenceSection(evidence: DashboardScreenshotManifest | null): string {
  if (!evidence) {
    return `<h2>Audit evidence</h2>
<div class="audit-evidence-card">
  <p><em>No dashboard screenshot yet.</em> Use <strong>Screenshot</strong> in the toolbar or <code>POST ${DASHBOARD_ROUTES.screenshot}</code>.</p>
  <div class="audit-badges">
    <span class="audit-badge">visual</span>
    <span class="audit-badge">cryptographic</span>
    <span class="audit-badge">structural</span>
  </div>
  <p class="audit-hint">Evidence chain: visual (thumbnail), cryptographic (SHA-256), structural (dimensions/format).</p>
</div>`;
  }

  const { image } = evidence;
  const test003Ok = evidence.test003?.ok === true;
  const test003Badge = evidence.test003
    ? `<span class="audit-badge ${test003Ok ? "ok" : ""}">TEST-003 · ${evidence.test003.status}</span>`
    : "";
  return `<h2>Audit evidence</h2>
<div class="audit-evidence-card">
  <div class="audit-evidence">
    <div class="audit-visual">
      <a href="${evidence.full}" target="_blank" rel="noopener">
        <img src="${evidence.thumbnail}" alt="Dashboard screenshot thumbnail" width="320" />
      </a>
      <p><button class="action secondary" type="button" data-capture-screenshot>Recapture</button></p>
    </div>
    <dl class="audit-meta">
      <dt>Captured</dt><dd><code>${evidence.capturedAt}</code></dd>
      <dt>SHA-256</dt>
      <dd class="audit-sha-row">
        <code id="audit-sha-value">${evidence.sha256}</code>
        <button type="button" class="copy-sha" data-copy-sha="${evidence.sha256}">Copy</button>
      </dd>
      <dt>Size</dt><dd>${formatBytes(evidence.bytes)} bytes</dd>
      <dt>Dimensions</dt><dd>${image.width}×${image.height} ${image.format}</dd>
      <dt>Full image</dt><dd><a href="${evidence.full}">${evidence.full}</a></dd>
    </dl>
  </div>
  <div class="audit-badges">
    <span class="audit-badge ok">visual · thumbnail</span>
    <span class="audit-badge ok">crypto · sha256</span>
    <span class="audit-badge ok">structural · ${image.width}×${image.height}</span>
    ${test003Badge}
  </div>
  <p class="audit-hint">Three verification dimensions: visual (thumbnail), cryptographic (SHA-256), structural (${image.width}×${image.height} ${image.format}). Thumbnail is derived from the hashed full PNG${
    evidence.test003 ? `; TEST-003 ${evidence.test003.status}` : ""
  }.</p>
</div>`;
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
