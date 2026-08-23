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
};

/** Parse an RSS 2.0 feed into entries (title/link/pubDate). */
export function parseRssEntries(xml: string): RssEntry[] {
  const out: RssEntry[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  const grab = (block: string, tag: string): string => {
    const m = block.match(new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)</" + tag + ">"));
    return m ? m[1]!.replace(/<!\[CDATA\[|\]\]>|\n|\s+/g, " ").trim() : "";
  };
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1]!;
    const title = grab(block, "title");
    const link = grab(block, "link");
    const pubDate = grab(block, "pubDate");
    if (title) out.push({ title, link, pubDate });
  }
  return out;
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
