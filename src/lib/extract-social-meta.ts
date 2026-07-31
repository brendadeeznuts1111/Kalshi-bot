/**
 * Social metadata extraction via HTMLRewriter (Open Graph, Twitter, fallbacks).
 *
 * Offline: extractSocialMetadataFromHtml / FromResponse
 * Live:    extractSocialMetadata(url) → fetch + rewrite
 *
 * @see https://bun.com/docs/guides/html-rewriter/extract-social-meta#extract-social-share-images-and-open-graph-tags
 * @see https://bun.com/docs/runtime/html-rewriter
 * @see https://bun.com/docs/runtime/networking/fetch#sending-an-http-request
 */

/** Guide `SocialMetadata` — Open Graph (+ Twitter / title fallbacks). */
export type SocialMetadata = {
  title?: string;
  description?: string;
  image?: string;
  url?: string;
  siteName?: string;
  type?: string;
};

const SOCIAL_KEYS = new Set<keyof SocialMetadata>([
  "title",
  "description",
  "image",
  "url",
  "siteName",
  "type",
]);

/**
 * Map wire OG/Twitter property tails onto `SocialMetadata` fields.
 * Guide does `replace("og:", "")` which leaves `site_name` — normalize to `siteName`.
 */
export function normalizeSocialKey(raw: string): keyof SocialMetadata | undefined {
  const camel = raw.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  return SOCIAL_KEYS.has(camel as keyof SocialMetadata)
    ? (camel as keyof SocialMetadata)
    : undefined;
}

/**
 * Extract social metadata from an already-fetched Response.
 * When `baseUrl` is set, relative `image` values are resolved against it.
 */
export async function extractSocialMetadataFromResponse(
  response: Response,
  baseUrl?: string,
): Promise<SocialMetadata> {
  const metadata: SocialMetadata = {};
  let titleFallback = "";

  const applyOg = (attr: string | null, content: string | null, prefer = true) => {
    if (!attr?.startsWith("og:") || !content) return;
    const key = normalizeSocialKey(attr.replace(/^og:/, ""));
    if (!key) return;
    if (prefer || !metadata[key]) metadata[key] = content;
  };

  const rewriter = new HTMLRewriter()
    .on('meta[property^="og:"]', {
      element(el) {
        applyOg(el.getAttribute("property"), el.getAttribute("content"));
      },
    })
    // Some sites ship name="og:…" (not property=)
    .on('meta[name^="og:"]', {
      element(el) {
        applyOg(el.getAttribute("name"), el.getAttribute("content"));
      },
    })
    .on('meta[name^="twitter:"]', {
      element(el) {
        const name = el.getAttribute("name");
        const content = el.getAttribute("content");
        if (!name || !content) return;
        const key = normalizeSocialKey(name.replace(/^twitter:/, ""));
        if (key && !metadata[key]) metadata[key] = content;
      },
    })
    .on('meta[name="description"]', {
      element(el) {
        const content = el.getAttribute("content");
        if (content && !metadata.description) metadata.description = content;
      },
    })
    .on("title", {
      text(chunk) {
        titleFallback += chunk.text;
      },
    });

  await rewriter.transform(response).blob();

  if (!metadata.title && titleFallback.trim()) {
    metadata.title = titleFallback.trim();
  }

  if (metadata.image && baseUrl && !metadata.image.startsWith("http")) {
    try {
      metadata.image = new URL(metadata.image, baseUrl).href;
    } catch {
      // keep relative
    }
  }

  return metadata;
}

/** Offline / fixtures — accepts raw HTML. */
export async function extractSocialMetadataFromHtml(
  html: string,
  baseUrl?: string,
): Promise<SocialMetadata> {
  return extractSocialMetadataFromResponse(new Response(html), baseUrl);
}

/** Live convenience: fetch → extract. */
export async function extractSocialMetadata(url: string): Promise<SocialMetadata> {
  const cleaned = url.split("#")[0]!;
  const response = await fetch(cleaned, {
    headers: { "user-agent": "Kalshi-bot-social-meta/1.0" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`fetch ${cleaned}: HTTP ${response.status}`);
  }
  return extractSocialMetadataFromResponse(response, cleaned);
}
