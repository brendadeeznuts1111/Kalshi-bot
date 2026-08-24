/**
 * blog-map.ts — the blog → repo mapping TRACKER core (pure functions).
 *
 * Keeps the anchor/sub-header tree of the Bun release blog mapped to this
 * repo (file/script + integration layer + status) as a REGISTRY
 * (.data/blog-map.json). The tracker CLI (tools/bun-blog-map.ts) diffs the
 * LIVE blog against the registry every run:
 *   - newUnmapped: sub-headers under the tracked anchors NOT in the
 *     registry (the blog added something we have not mapped) — CONTRACT
 *     VIOLATION (exit 1)
 *   - missing: registry entries whose sub-header id is no longer in the
 *     blog (blog removed/renamed it) — needs registry cleanup
 *   - mapped/note/marketing counts — the coverage summary
 *
 * The signal pipeline's "mapping" channel reads the state file the CLI
 * writes (.data/blog-map-state.json) so the dashboard shows coverage +
 * staleness without fetching the blog per request; a daily Bun.cron keeps
 * the state fresh (AGENT-PITFALLS §31).
 */
export const TRACKED_ANCHORS = ["faster", "bun-build", "bun-test", "bun-install", "what-s-new"] as const;

export type BlogHeader = { id: string; level: "h2" | "h3"; title: string };

export type MappingStatus = "verified" | "note" | "marketing";

export type BlogMapEntry = {
  anchor: string;
  subId: string;      // the blog sub-header id
  title: string;      // display title
  mappedTo: string;   // repo file / script / "NOT mapped"
  layer: string;      // channels | branding | pipeline | data | —
  status: MappingStatus;
};

export type BlogMapRegistry = {
  version: string;
  blogUrl: string;
  entries: BlogMapEntry[];
};

/** Parse the blog HTML into headers (h2/h3 with id), in document order. */
export function extractAnchors(html: string): BlogHeader[] {
  const out: BlogHeader[] = [];
  const re = /<(h2|h3)[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const title = (m[3] as string)
      .replace(/<[^>]+>/g, " ")
      .replace(/&quot;/g, "\"")
      .replace(/&amp;/g, "&")
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
    out.push({ id: m[2]!, level: m[1] as "h2" | "h3", title });
  }
  return out;
}

export type BlogMapDiff = {
  /** Sub-headers under tracked anchors present in the blog but NOT in the registry. */
  newUnmapped: Array<{ id: string; title: string; anchor: string }>;
  /** Registry sub-ids no longer present in the blog at all. */
  missing: string[];
  /** Sub-headers under tracked anchors present in BOTH (mapped or noted). */
  matched: string[];
  coverage: number; // matched / (matched + newUnmapped) — 1 when complete
};

/** Diff the live blog's tracked sub-headers against the registry. */
export function diffBlogMap(html: string, registry: BlogMapEntry[]): BlogMapDiff {
  const headers = extractAnchors(html);
  const registered = new Set(registry.map((e) => e.subId));
  const allBlogSubIds = new Set(headers.filter((h) => h.level === "h3").map((h) => h.id));

  const newUnmapped: BlogMapDiff["newUnmapped"] = [];
  let matched = 0;
  for (const anchor of TRACKED_ANCHORS) {
    let inAnchor = false;
    for (const h of headers) {
      if (h.level === "h2") { inAnchor = h.id === anchor; continue; }
      if (!inAnchor) continue;
      if (registered.has(h.id)) matched += 1;
      else newUnmapped.push({ id: h.id, title: h.title, anchor });
    }
  }

  const missing = [...registered].filter((id) => !allBlogSubIds.has(id));
  const total = matched + newUnmapped.length;
  return {
    newUnmapped,
    missing,
    matched: [...registered].filter((id) => allBlogSubIds.has(id)),
    coverage: total === 0 ? 1 : matched / total,
  };
}

/** Markdown summary of a diff (written to the state file + report). */
export function mappingReport(diff: BlogMapDiff, lastChecked: string): string {
  const lines = [
    "# Bun blog → repo mapping tracker",
    "",
    "Checked " + lastChecked + " — sub-headers under " + TRACKED_ANCHORS.join(", "),
    "",
    "## Coverage: " + (diff.coverage * 100).toFixed(0) + "% (" + diff.matched.length + " mapped, " + diff.newUnmapped.length + " unmapped)",
    "",
  ];
  if (diff.newUnmapped.length) {
    lines.push("## NEW UNMAPPED (contract violation — add registry entries)", "");
    for (const u of diff.newUnmapped) lines.push("- [" + u.anchor + "] " + u.id + " — " + u.title);
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
};