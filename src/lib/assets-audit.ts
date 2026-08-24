/**
 * assets-audit.ts — content-hashed asset verification for markdown.
 *
 * Extends the docs:check/content:check model to IMAGES referenced from
 * markdown (content/posts + docs): every referenced local image must
 * EXIST and its sha256 must match the last-known state (.data/assets-
 * state.json). New/changed images are reported (and --update re-baselines).
 *
 * Reference extraction (probe-verified, AGENT-PITFALLS §46):
 *   - Bun.markdown.render image callback catches ![alt](src) incl. title
 *   - HTML <img src> inside markdown is NOT caught by the callback — a
 *     regex over the raw text covers it (both combined).
 */
import { markdownHeadings } from "./markdown-headings.ts";

export type AssetRef = {
  src: string;
  from: string; // which markdown file references it
  kind: "markdown" | "html";
};

export type AssetAudit = {
  path: string;
  bytes: number;
  hash: string;
  exists: boolean;
};

/** Extract image references from one markdown source (callback + <img> regex). */
export function extractImageRefs(markdown: string, from: string): AssetRef[] {
  const out: AssetRef[] = [];
  // 1) markdown ![alt](src "title") via the render image callback
  try {
    (Bun.markdown as unknown as {
      render(md: string, cbs: Record<string, (c: string, m?: Record<string, unknown>) => string>): string;
    }).render(markdown, {
      image: (_children, meta) => {
        const src = meta?.src;
        if (typeof src === "string" && src.trim()) out.push({ src: src.trim(), from, kind: "markdown" });
        return "";
      },
    });
  } catch { /* fall through to the regex pass */ }
  // 2) HTML <img src> in embedded HTML (callback misses these — probe).
  // Skip fenced code blocks first so code/prose examples of <img src>
  // don't become asset references (false-positive guard, §46).
  const withoutFences = markdown.replace(/```[\s\S]*?```/g, "");
  const re = /<img[^>]*\bsrc=["']([^"']+)["'][^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(withoutFences)) !== null) {
    const src = m[1]!;
    if (!out.some((r) => r.src === src)) out.push({ src, from, kind: "html" });
  }
  return out;
}

/**
 * Audit the images referenced by a markdown file: resolve each local ref
 * against the file's directory, hash the bytes, check existence.
 * Remote refs (http/https) are skipped (can't hash locally).
 */
export async function auditMarkdownAssets(
  markdownPath: string, // absolute
  markdown: string,
): Promise<{ refs: Array<AssetRef & { resolved?: string; audit?: AssetAudit }> }> {
  const { dirname, resolve } = await import("node:path");
  const dir = dirname(markdownPath);
  const refs = extractImageRefs(markdown, markdownPath);
  const out: Array<AssetRef & { resolved?: string; audit?: AssetAudit }> = [];
  for (const ref of refs) {
    if (/^https?:\/\//.test(ref.src)) { out.push({ ...ref }); continue; } // remote — skip
    const resolved = resolve(dir, ref.src);
    let audit: AssetAudit | undefined;
    if (await Bun.file(resolved).exists()) {
      const bytes = await Bun.file(resolved).bytes();
      const h = new Bun.CryptoHasher("sha256");
      h.update(bytes);
      audit = { path: resolved, bytes: bytes.length, hash: h.digest("hex"), exists: true };
    } else {
      audit = { path: resolved, bytes: 0, hash: "", exists: false };
    }
    out.push({ ...ref, resolved, audit });
  }
  return { refs: out };
}

/** Hash a file's bytes (shared by the CLI state). */
export async function hashFileBytes(abs: string): Promise<string> {
  const h = new Bun.CryptoHasher("sha256");
  h.update(await Bun.file(abs).bytes());
  return h.digest("hex");
}