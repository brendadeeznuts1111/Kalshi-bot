/**
 * report.ts — Odds Heat Markdown report (Bun.markdown-renderable, wire-safe).
 *
 * Pure module: OddsEvent[] (+ optional ValuePattern[]/ConvergencePattern[])
 * → a Markdown report string. The route layer renders it with
 * `markdownToHtml(md, "strict")` (src/lib/markdown.ts) for `?format=html`.
 *
 * ## Untrusted-input contract
 *
 * Every feed-derived string (venue, side, event id, bookmaker key, notes) is
 * escaped by {@link escapeMarkdownCell} BEFORE interpolation. Bun.markdown is
 * NOT sanitized — raw HTML passes through — so escaping at the source (plus
 * the `strict` preset's tagFilter/noHtmlBlocks/noHtmlSpans at render time) is
 * the defense-in-depth that keeps `<script>` in a venue name from executing
 * in the report page.
 */
import type { OddsEvent } from "../../alpha/odds-types.ts";
import { markdownToHtml } from "../../lib/markdown.ts";
import type { BookmakerProfile } from "./bookmakers.ts";
import type { ConvergencePattern, ValuePattern } from "./value-patterns.ts";

/** Cell placeholder for a profile field the registry does not declare. */
const NO_META = "—";

function booksTable(books: BookmakerProfile[]): string {
  const lines = [
    "| Venue | Name | Feed | Book URL | Logo | Registered |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const b of books) {
    const feed = b.feed ?? NO_META;
    const url = b.url ? `[link](${escapeMarkdownCell(b.url)})` : NO_META;
    const logo = b.logo ? `![](${escapeMarkdownCell(b.logo)})` : NO_META;
    lines.push(
      `| ${escapeMarkdownCell(b.key)} | ${escapeMarkdownCell(b.name)} | ${escapeMarkdownCell(feed)} | ${url} | ${logo} | ${b.registered ? "yes" : "NO — wire-only venue"} |`,
    );
  }
  return lines.join("\n");
}

export type OddsReportInput = {
  /** Normalized events (any adapter: xml/json/ws). */
  events: OddsEvent[];
  /** Value-pattern hits (already detected — report does not re-detect). */
  patterns?: ValuePattern[];
  /** Convergence classifications for the optional movement section. */
  convergence?: ConvergencePattern[];
  /** Bookmaker profiles (with book URL / logo meta) for venues in `events`. */
  books?: BookmakerProfile[];
  /** Report title. Defaults to "Odds Heat Report". */
  title?: string;
  /** Report timestamp; defaults to now. */
  generatedAt?: Date | string;
  /** Data-state label, e.g. "declarations_only" | "live". */
  dataState?: string;
};

export type OddsReportConsensusRow = {
  eventId: string;
  side: string;
  bookmakers: number;
  consensus: number;
  spread: number;
};

/**
 * Escape a feed-derived string for safe interpolation into a Markdown table
 * cell: HTML-significant characters become entities, pipes are escaped so a
 * hostile name cannot break out of the cell, control newlines collapse.
 */
export function escapeMarkdownCell(raw: string): string {
  return raw
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("`", "&#96;")
    .replaceAll("|", "\\|")
    .replace(/[\r\n\t]+/g, " ");
}

/** American -> implied probability (mirrors value-patterns.ts, import-light). */
function americanToImplied(price: number): number {
  if (!Number.isFinite(price) || price === 0) return 0;
  return price > 0 ? 100 / (100 + price) : -price / (100 - price);
}

function pct(x: number): string {
  return (x * 100).toFixed(1) + "%";
}

function pp(x: number): string {
  return (x * 100).toFixed(1) + "pp";
}

/**
 * Per event×side bookmaker consensus from OddsEvent[] — same normalized
 * shape the detector consumes (h2h first market, one implied per bookmaker).
 * Rows with no valid implieds are dropped. Sorted by bookmaker count desc,
 * then event id / side for stable output.
 */
export function oddsReportConsensus(events: OddsEvent[]): OddsReportConsensusRow[] {
  const implieds = new Map<string, { side: string; values: number[] }>();
  for (const ev of events) {
    for (const bk of ev.bookmakers) {
      const outcomes = bk.markets[0]?.outcomes;
      if (!outcomes) continue;
      for (const o of outcomes) {
        const implied = americanToImplied(o.price);
        if (implied <= 0 || implied >= 1) continue;
        const key = ev.id + "\u0000" + o.name;
        const entry = implieds.get(key) ?? { side: o.name, values: [] };
        entry.values.push(implied);
        implieds.set(key, entry);
      }
    }
  }
  const rows: OddsReportConsensusRow[] = [];
  for (const [key, { side, values }] of implieds) {
    if (values.length === 0) continue;
    rows.push({
      eventId: key.split("\u0000")[0] ?? "",
      side,
      bookmakers: values.length,
      consensus: values.reduce((a, b) => a + b, 0) / values.length,
      spread: Math.max(...values) - Math.min(...values),
    });
  }
  return rows.sort((a, b) =>
    b.bookmakers - a.bookmakers
    || a.eventId.localeCompare(b.eventId)
    || a.side.localeCompare(b.side),
  );
}

function matchesTable(events: OddsEvent[]): string {
  const lines = [
    "| Event | Match | Venue (lat, long) | Commence |",
    "| --- | --- | --- | --- |",
  ];
  for (const ev of events) {
    const venue = ev.location ? `${ev.location.lat}, ${ev.location.long}` : NO_META;
    lines.push(
      `| ${escapeMarkdownCell(ev.id)} | ${escapeMarkdownCell(ev.homeTeam)} vs ${escapeMarkdownCell(ev.awayTeam)} | ${escapeMarkdownCell(venue)} | ${escapeMarkdownCell(ev.commenceTime)} |`,
    );
  }
  return lines.join("\n");
}

function consensusTable(rows: OddsReportConsensusRow[]): string {
  const lines = [
    "| Event | Side | Bookmakers | Consensus | Spread |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const r of rows) {
    lines.push(
      `| ${escapeMarkdownCell(r.eventId)} | ${escapeMarkdownCell(r.side)} | ${r.bookmakers} | ${pct(r.consensus)} | ${pp(r.spread)} |`,
    );
  }
  return lines.join("\n");
}

function patternsTable(patterns: ValuePattern[]): string {
  const lines = [
    "| Event | Side | Venue | Kind | Severity | Gap | Note |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const p of patterns) {
    const gap = (p.gap >= 0 ? "+" : "") + pp(p.gap);
    lines.push(
      `| ${escapeMarkdownCell(p.eventId)} | ${escapeMarkdownCell(p.side)} | ${escapeMarkdownCell(p.venue)} | ${p.kind} | ${p.severity} | ${gap} | ${escapeMarkdownCell(p.note)} |`,
    );
  }
  return lines.join("\n");
}

function convergenceTable(convergence: ConvergencePattern[]): string {
  const lines = [
    "| Event | Side | Kind | Severity | Consensus | Prior | Note |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const c of convergence) {
    lines.push(
      `| ${escapeMarkdownCell(c.eventId)} | ${escapeMarkdownCell(c.side)} | ${c.kind} | ${c.severity} | ${pct(c.consensus)} | ${pct(c.priorConsensus)} | ${escapeMarkdownCell(c.note)} |`,
    );
  }
  return lines.join("\n");
}

/**
 * Build the Odds Heat report as Markdown. Sections: header summary, consensus
 * table, value patterns (when provided), convergence movement (when provided).
 */
export function buildOddsReportMarkdown(input: OddsReportInput): string {
  const title = input.title ?? "Odds Heat Report";
  const at = input.generatedAt !== undefined
    ? (input.generatedAt instanceof Date ? input.generatedAt : new Date(input.generatedAt))
    : new Date();
  const consensus = oddsReportConsensus(input.events);
  const bookmakers = new Set(input.events.flatMap((e) => e.bookmakers.map((b) => b.key)));

  const lines: string[] = [
    `# ${escapeMarkdownCell(title)}`,
    "",
    `- Generated: ${at.toISOString()}`,
    `- Events: ${input.events.length} · bookmakers seen: ${bookmakers.size} · consensus sides: ${consensus.length}`,
  ];
  if (input.dataState) lines.push(`- Data state: ${escapeMarkdownCell(input.dataState)}`);

  if (input.events.length > 0) {
    lines.push("", "## Matches", "");
    lines.push(matchesTable(input.events));
  }

  lines.push("", "## Consensus", "");
  lines.push(consensus.length > 0 ? consensusTable(consensus) : "_No consensus sides (no valid prints)._");

  if (input.books) {
    lines.push("", "## Books quoting", "");
    lines.push(input.books.length > 0 ? booksTable(input.books) : "_No books resolved for this feed._");
  }

  if (input.patterns) {
    lines.push("", "## Value patterns", "");
    lines.push(
      input.patterns.length > 0 ? patternsTable(input.patterns) : "_No value patterns above threshold._",
    );
  }
  if (input.convergence) {
    lines.push("", "## Convergence", "");
    lines.push(
      input.convergence.length > 0 ? convergenceTable(input.convergence) : "_No convergence movement detected._",
    );
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Markdown -> HTML for the report route. Uses the repo `strict` preset
 * (GFM + tagFilter + noHtmlBlocks + noHtmlSpans): feed-derived cells are
 * escaped at the source AND the renderer strips raw HTML as a second layer.
 */
export function buildOddsReportHtml(input: OddsReportInput): string {
  return markdownToHtml(buildOddsReportMarkdown(input), "strict");
}
