// @see https://bun.com/docs/runtime/webview#new-bun-webview-options
// @see https://bun.com/blog/bun-v1.3.12#bun-webview-headless-browser-automation
// @see https://bun.com/docs/runtime/hashing#bun-cryptohasher
// @see https://bun.com/docs/runtime/image#metadata — Bun.Image.metadata
import { extractImageEvidenceMeta } from "../../../lib/image-metadata.ts";
import { joinPath } from "../research/paths.ts";

export type WebCaptureManifest = {
  kind: "WebCapture";
  capturedAt: string;
  url: string;
  title: string | null;
  imagePath: string;
  algorithm: "sha3-256";
  digest: string;
  mediaType: "image/png";
  /** Pixel dimensions from Bun.Image.metadata (not viewport opts). */
  width: number;
  height: number;
  format: string;
  /** Encoded PNG byte length. */
  size: number;
};

export type CaptureEvidenceOptions = {
  url: string;
  outDir: string;
  width?: number;
  height?: number;
  waitMs?: number;
  slug?: string;
};

export type CaptureEvidenceDeps = {
  navigateAndCapture?: (opts: CaptureEvidenceOptions) => Promise<{ png: Buffer; title: string | null }>;
};

export function sha3HexBytes(data: Uint8Array): string {
  const hasher = new Bun.CryptoHasher("sha3-256");
  hasher.update(data);
  return hasher.digest("hex");
}

/** Normalize Kalshi market input to a full https URL. */
export function normalizeCaptureUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("URL or market id required");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const slug = trimmed.replace(/^\/+/, "").replace(/^markets\//i, "");
  return `https://kalshi.com/markets/${slug}`;
}

export function captureSlugFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const tail = parts.slice(-2).join("__") || "page";
    return tail.replace(/[^a-zA-Z0-9._-]+/g, "-").toLowerCase();
  } catch {
    return "capture";
  }
}

async function defaultNavigateAndCapture(
  opts: CaptureEvidenceOptions,
): Promise<{ png: Buffer; title: string | null }> {
  const backend = process.platform === "darwin" ? "webkit" : "chrome";
  await using view = new Bun.WebView({
    width: opts.width ?? 1280,
    height: opts.height ?? 800,
    backend,
  });
  await view.navigate(opts.url);
  if ((opts.waitMs ?? 1500) > 0) {
    await Bun.sleep(opts.waitMs ?? 1500);
  }
  const png = await view.screenshot({ format: "png", encoding: "buffer" });
  const title = await view.evaluate<string | null>("document.title || null");
  return { png, title };
}

export async function captureEvidence(
  opts: CaptureEvidenceOptions,
  deps: CaptureEvidenceDeps = {},
): Promise<WebCaptureManifest> {
  const url = normalizeCaptureUrl(opts.url);
  const capture = deps.navigateAndCapture ?? defaultNavigateAndCapture;
  const { png, title } = await capture({ ...opts, url });
  const slug = opts.slug ?? `${captureSlugFromUrl(url)}-${Date.now()}`;
  const imagePath = joinPath(opts.outDir, `${slug}.png`);
  const manifestPath = joinPath(opts.outDir, `${slug}.manifest.json`);

  await Bun.write(imagePath, png);
  // Pixel dims from Bun.Image — viewport opts are capture chrome, not image size
  const imageMeta = await extractImageEvidenceMeta(png, { algorithm: "sha3-256" });
  const manifest: WebCaptureManifest = {
    kind: "WebCapture",
    capturedAt: new Date().toISOString(),
    url,
    title,
    imagePath,
    algorithm: "sha3-256",
    digest: imageMeta.digest,
    mediaType: "image/png",
    width: imageMeta.width,
    height: imageMeta.height,
    format: imageMeta.format,
    size: imageMeta.size,
  };
  await Bun.write(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

export const DEFAULT_CAPTURE_DIR = joinPath(import.meta.dir, "../../research/evidence-captures");
