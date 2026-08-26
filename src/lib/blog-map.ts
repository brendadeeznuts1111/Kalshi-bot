/**
 * blog-map.ts — blog → repo mapping TRACKER core v2 (all sections, full depth).
 *
 * v2 rethink (AGENT-PITFALLS §184): the bun-v1.4 release post has 286 id'd
 * headings (13 h2 / 150 h3 / 123 h4) across 13 sections — the v1 tracker only
 * covered the 55 h3s under 5 anchors and discarded everything else (code, links,
 * version provenance, sub-subsections). v2 registers the FULL tree with per-
 * entry context: hierarchy (section/parent/level), version provenance parsed
 * from the title tags, code-block + link counts and a text excerpt per section.
 *
 * Contract (diffBlogMap): every h3/h4 id in the blog must be REGISTERED in the
 * registry — a heading the blog adds that we have not seen is a CONTRACT
 * VIOLATION (exit 1). Registered-but-not-curated entries carry status
 * "unmapped" (mappedTo="NOT mapped"); curation = share of entries with a real
 * mapping status. The signal pipeline's mapping channel reads the state file
 * (AGENT-PITFALLS §31) — state shape is additive (curation added).
 */
export const TRACKED_SECTIONS = [
  "node-js-compatibility",
  "production",
  "we-rewrote-bun-in-rust",
  "what-s-new",
  "bun-install",
  "bun-test",
  "bun-build",
  "faster",
  "security",
  "platforms",
  "upgrading-to-1-4",
  "changelog",
  "thank-you",
] as const;

export type BlogHeaderLevel = "h2" | "h3" | "h4";

export type BlogHeader = {
  id: string;
  level: BlogHeaderLevel;
  title: string; // clean title (version tags + trailing '#' stripped)
  versions: string[]; // provenance tags parsed from the title (e.g. ["1.3.10","1.4.0"])
  section: string; // nearest h2 id
  parent: string | null; // nearest h3 id for h4 entries, else null
  codeBlocks: number; // <pre> blocks in the section slice
  links: number; // href= occurrences in the section slice
  excerpt: string; // first ~140 chars of the section text
};

export type MappingStatus = "verified" | "note" | "marketing" | "unmapped";

export type BlogMapEntry = BlogHeader & {
  mappedTo: string; // repo file/script or "NOT mapped"
  layer: string; // integration layer or "—"
  status: MappingStatus;
};

export type BlogMapRegistry = {
  version: string;
  blogUrl: string;
  entries: BlogMapEntry[];
};

/** Strip HTML entities + tags from heading/section text. */
function cleanText(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, "\"")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parse version-provenance tags out of a heading title. */
export function parseTitle(raw: string): { title: string; versions: string[] } {
  // Clean FIRST (the version tags sit inside anchor tags in the raw HTML,
  // e.g. faster<a href="#...">v 1.4.0</a> — the raw text has no plain ' v ').
  const cleaned = cleanText(raw);
  const versions: string[] = [];
  const t = cleaned
    .replace(/ v (\d+\.\d+\.\d+)/g, (_m: string, v: string) => {
      versions.push(v);
      return "";
    })
    .replace(/\s+#$/, "")
    .trim();
  return { title: t, versions };
}

/**
 * Parse the blog HTML into the full heading tree (h2/h3/h4 with ids), in
 * document order, with per-heading context sliced from the HTML between this
 * heading and the next heading of equal-or-higher level.
 */
export function extractTree(html: string): BlogHeader[] {
  const re = /<(h2|h3|h4)[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g;
  const found: { level: BlogHeaderLevel; id: string; rawTitle: string; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    found.push({
      level: m[1] as BlogHeaderLevel,
      id: m[2]!,
      rawTitle: m[3]!,
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  const out: BlogHeader[] = [];
  let curSection: string | null = null;
  let curParent: string | null = null;
  for (let i = 0; i < found.length; i++) {
    const f = found[i]!;
    if (f.level === "h2") { curSection = f.id; curParent = null; }
    else if (f.level === "h3") curParent = f.id;
    // section slice: this heading's end .. next heading of level <= current
    let sliceEnd = html.length;
    for (let j = i + 1; j < found.length; j++) {
      const g = found[j]!;
      const lvl = g.level === "h2" ? 2 : g.level === "h3" ? 3 : 4;
      const curLvl = f.level === "h2" ? 2 : f.level === "h3" ? 3 : 4;
      if (lvl <= curLvl) { sliceEnd = g.start; break; }
    }
    const slice = html.slice(f.end, sliceEnd);
    const { title, versions } = parseTitle(f.rawTitle);
    out.push({
      id: f.id,
      level: f.level,
      title,
      versions,
      section: curSection ?? "",
      parent: f.level === "h4" ? curParent : null,
      codeBlocks: (slice.match(/<pre[\s>]/g) || []).length,
      links: (slice.match(/href="/g) || []).length,
      excerpt: cleanText(slice).slice(0, 140),
    });
  }
  return out;
}

export type BlogMapDiff = {
  /** Blog h3/h4 ids present in the blog but NOT in the registry (contract violation). */
  newUnmapped: Array<{ id: string; title: string; section: string; level: string }>;
  /** Registry ids no longer present in the blog. */
  missing: string[];
  /** Registered ids present in the blog. */
  matched: string[];
  /** Registration coverage: matched / (matched + newUnmapped). */
  coverage: number;
  /** Curation: share of registered entries with a real mapping status. */
  curation: number;
  /** Registry size (entries). */
  total: number;
};

/** Diff the live blog tree against the registry (h3+h4 across ALL sections). */
export function diffBlogMap(html: string, registry: BlogMapEntry[]): BlogMapDiff {
  const headers = extractTree(html);
  const registered = new Set(registry.map((e) => e.id));
  const tracked = headers.filter((h) => h.level === "h3" || h.level === "h4");
  const trackedIds = new Set(tracked.map((h) => h.id));
  const newUnmapped = tracked.filter((h) => !registered.has(h.id)).map((h) => ({
    id: h.id,
    title: h.title,
    section: h.section,
    level: h.level,
  }));
  const matched = [...registered].filter((id) => trackedIds.has(id));
  const missing = [...registered].filter((id) => !trackedIds.has(id));
  const total = matched.length + newUnmapped.length;
  const curated = registry.filter((e) => e.status !== "unmapped").length;
  return {
    newUnmapped,
    missing,
    matched,
    coverage: total === 0 ? 1 : matched.length / total,
    curation: registry.length === 0 ? 0 : curated / registry.length,
    total: registry.length,
  };
}

/** Markdown summary of a diff (state file + report). */
export function mappingReport(diff: BlogMapDiff, lastChecked: string): string {
  const lines = [
    "# Bun blog → repo mapping tracker (v2)",
    "",
    "Checked " + lastChecked + " — h3/h4 across all 13 sections",
    "",
    "## Registration: " + (diff.coverage * 100).toFixed(0) + "% (" + diff.matched.length + " of " + (diff.matched.length + diff.newUnmapped.length) + " blog headings registered)",
    "",
    "## Curation: " + (diff.curation * 100).toFixed(0) + "% (" + Math.round(diff.curation * diff.total) + " of " + diff.total + " entries mapped)",
    "",
  ];
  if (diff.newUnmapped.length) {
    lines.push("## NEW UNMAPPED (contract violation — run bun:blog-map to register)", "");
    for (const u of diff.newUnmapped) lines.push("- [" + u.section + "/" + u.level + "] " + u.id + " — " + u.title);
    lines.push("");
  }
  if (diff.missing.length) {
    lines.push("## Missing from blog (registry cleanup)", "");
    for (const id of diff.missing) lines.push("- " + id);
    lines.push("");
  }
  return lines.join("\n");
}

export type BlogMapState = {
  lastChecked: string;
  coverage: number;
  matched: number;
  newUnmapped: number;
  missing: string[];
  newUnmappedIds: string[];
  curation: number;
  total: number;
};
