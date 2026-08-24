/**
 * Bun release-blog integration: RSS parsing + code-block extraction.
 *
 * Turns the manual 'probe the release blog' discipline into a pipeline:
 * RSS -> latest release -> blog HTML -> code-block API identifiers, then
 * probe each against the installed runtime (see tools/bun-release-watch).
 *
 * Pure functions only - no network here; fixtures drive the tests.
 */

export type RssEntry = {
  title: string;
  link: string;
  pubDate: string;
  /** Image enclosure URL if present (RSS 2.0 `@url` shapes, probe-verified:
   * item.enclosure["@url"] / item["media:content"]["@url"] /
   * item["media:thumbnail"]["@url"]). */
  imageUrl?: string;
};

/**
 * Parse an RSS 2.0 feed into entries (title/link/pubDate) via Bun.XML.parse
 * (native SIMD parser; verified: 87KB feed in ~1.9ms). Shape for RSS 2.0:
 * rss.channel.item[] with plain-string title/link/pubDate. (Atom feeds use
 * feed.entry and '@'-prefixed attributes instead - shape differs by format.)
 */
type RssItemShape = {
  title?: string;
  link?: string;
  pubDate?: string;
  enclosure?: { "@url"?: string };
  "media:content"?: { "@url"?: string };
  "media:thumbnail"?: { "@url"?: string };
};

/** First image URL from the probe-verified RSS enclosure shapes. */
function imageUrlOf(it: RssItemShape): string | undefined {
  return it.enclosure?.["@url"] ?? it["media:content"]?.["@url"] ?? it["media:thumbnail"]?.["@url"];
}

export function parseRssEntries(xml: string): RssEntry[] {
  const parsed = Bun.XML.parse(xml) as {
    rss?: { channel?: { item?: RssItemShape | RssItemShape[] } };
  };
  const raw = parsed.rss?.channel?.item;
  const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return items
    .map((it) => ({
      title: it.title ?? "",
      link: it.link ?? "",
      pubDate: it.pubDate ?? "",
      ...(imageUrlOf(it) ? { imageUrl: imageUrlOf(it) } : {}),
    }))
    .filter((e) => e.title.length > 0);
}

/**
 * Parse a GitHub releases Atom feed (feed.entry[]) via Bun.XML.parse —
 * the verified parser, second feed shape. Atom uses '@'-prefixed link
 * attributes: feed.entry[].link.@href. Returns the same RssEntry shape so
 * latestRelease() works unchanged.
 */
export function parseAtomEntries(xml: string): RssEntry[] {
  let parsed: { feed?: { entry?: unknown } };
  try {
    parsed = Bun.XML.parse(xml) as { feed?: { entry?: unknown } };
  } catch {
    return []; // malformed/empty feed -> no entries
  }
  const feed = parsed as {
    feed?: {
      entry?:
        | Array<{ title?: string; link?: { "@href"?: string }; updated?: string }>
        | { title?: string; link?: { "@href"?: string }; updated?: string };
    };
  };
  const raw = parsed.feed?.entry;
  const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return items
    .map((it) => ({
      title: it.title ?? "",
      link: it.link?.["@href"] ?? "",
      pubDate: it.updated ?? "",
    }))
    .filter((e) => e.title.length > 0);
}

/**
 * The newest release entry (title matching 'Bun v1.4' / 'Bun 1.4').
 * Version-clean title: 'Bun 1.4' -> '1.4'.
 */
export function latestRelease(entries: RssEntry[]): { title: string; version: string; link: string; pubDate: string } | null {
  // "Bun 1.4" and "Bun v1.3.14" both match; "Rewriting Bun in Rust" does not.
  const rel = entries.filter((e) => /^Bun\s*v?\s*\d/.test(e.title));
  if (rel.length === 0) return null;
  const newest = rel[0]!;
  const version = (newest.title.match(/\d[\d.]*/) ?? [""])[0]!;
  return { title: newest.title, version, link: newest.link, pubDate: newest.pubDate };
}

/**
 * Extract code blocks from a release-blog HTML page (strips tags + entities).
 */
export function extractCodeBlocks(html: string): string[] {
  const out: string[] = [];
  const preRe = /<pre[^>]*>([\s\S]*?)<\/pre>/g;
  let m: RegExpExecArray | null;
  while ((m = preRe.exec(html)) !== null) {
    const block = m[1]!
      .replace(/<[^>]+>/g, "")
      .replace(/&quot;/g, "\"")
      .replace(/&amp;/g, "&")
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
    out.push(block);
  }
  return out;
}

/**
 * Top-level Bun. identifiers mentioned in code blocks (Bun.Foo).
 */
export function identifiersFromCodeBlocks(blocks: string[]): Set<string> {
  const ids = new Set<string>();
  const re = /Bun\.([A-Za-z][A-Za-z0-9]*)/g;
  for (const block of blocks) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(block)) !== null) {
      ids.add(m[1]!);
    }
  }
  return ids;
}
