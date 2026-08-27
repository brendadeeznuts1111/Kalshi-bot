/**
 * report tests — Odds Heat markdown report: consensus aggregation, escape
 * contract for feed-derived strings, and Bun.markdown render safety.
 */
import { describe, expect, test } from "bun:test";
import { asFeedEventId, type OddsEvent } from "../../../src/alpha/odds-types.ts";
import {
  buildOddsReportHtml,
  buildOddsReportMarkdown,
  escapeMarkdownCell,
  parseOddsXmlEvents,
} from "../../../src/institutions/odds-registry/index.ts";
import { detectValuePatterns } from "../../../src/institutions/odds-registry/value-patterns.ts";
import { markdownToHtml } from "../../../src/lib/markdown.ts";

/** Four venues quoting the same match — consensus pocket on side "Alpha". */
const FIXTURE = `<odds-heat>`
  + `<cluster venue="bet365" commence="2026-03-01T19:00:00Z"><home team="Alpha"/><away team="Beta"/>`
  + `<print name="Alpha" american="-200"/><print name="Beta" american="+150"/></cluster>`
  + `<cluster venue="pinnacle" commence="2026-03-01T19:00:00Z"><home team="Alpha"/><away team="Beta"/>`
  + `<print name="Alpha" american="-190"/><print name="Beta" american="+160"/></cluster>`
  + `<cluster venue="draftkings" commence="2026-03-01T19:00:00Z"><home team="Alpha"/><away team="Beta"/>`
  + `<print name="Alpha" american="-210"/><print name="Beta" american="+145"/></cluster>`
  + `<cluster venue="williamhill" commence="2026-03-01T19:00:00Z"><home team="Alpha"/><away team="Beta"/>`
  + `<print name="Alpha" american="-205"/><print name="Beta" american="+150"/></cluster>`
  + `</odds-heat>`;

describe("escapeMarkdownCell", () => {
  test("neutralizes HTML-significant characters", () => {
    expect(escapeMarkdownCell('<script>alert("x")</script>')).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
  });

  test("escaped pipe cannot break out of a table cell", () => {
    const cell = escapeMarkdownCell("a|b");
    expect(cell).toBe("a\\|b");
    const row = `| ${cell} |`;
    expect(row.split("|").filter((c) => c.trim() !== "")).toHaveLength(2);
  });

  test("newlines collapse (no row injection)", () => {
    expect(escapeMarkdownCell("bad\nrow")).toBe("bad row");
    expect(escapeMarkdownCell("bad\r\n| injected |")).not.toContain("\n");
  });
});

describe("buildOddsReportMarkdown", () => {
  const events = parseOddsXmlEvents(FIXTURE, { sportKey: "soccer_epl", market: "h2h", commenceTime: "2026-03-01T19:00:00Z" });
  const eventId = events[0]!.id;

  test("aggregates consensus across venues into one row per side", () => {
    const md = buildOddsReportMarkdown({ events });
    expect(md).toContain("## Consensus");
    // home implieds: -200,-190,-210,-205 -> ~67% consensus across 4 bookmakers
    expect(md).toMatch(/\| 4 \| 6[0-9]\.\d% \|/);
    // exactly two consensus rows: Alpha + Beta (scope to the Consensus
    // section — Matches rows share the event-id prefix)
    const consensusSection = md.split("## Consensus")[1]!.split("## ")[0]!;
    const rows = consensusSection.split("\n").filter((l) => l.startsWith(`| ${eventId}`));
    expect(rows).toHaveLength(2);
  });

  test("matches section carries the event's lat/long venue", () => {
    const located = parseOddsXmlEvents(
      '<odds-heat><cluster venue="51.5074,-0.1278" book="bet365" commence="2026-09-01T19:00:00Z">'
        + '<home team="Alpha FC"/><away team="Beta FC"/>'
        + '<print name="Alpha FC" american="-110"/><print name="Beta FC" american="+100"/></cluster></odds-heat>',
    );
    const md = buildOddsReportMarkdown({ events: located });
    expect(md).toContain("## Matches");
    expect(md).toContain("| 51.5074, -0.1278 | 2026-09-01T19:00:00Z |");
    // Malformed venue -> em-dash placeholder, never a broken row.
    const bad = parseOddsXmlEvents(
      '<odds-heat><cluster venue="not-coords" book="bet365" commence="2026-09-01T19:00:00Z">'
        + '<print name="Alpha FC" american="-110"/><print name="Beta FC" american="+100"/></cluster></odds-heat>',
    );
    expect(buildOddsReportMarkdown({ events: bad })).toContain("| — | 2026-09-01T19:00:00Z |");
  });

  test("includes value patterns when provided", () => {
    const patterns = detectValuePatterns(events, [
      { eventId, venue: "kalshi", side: "Alpha", implied: 0.45 },
    ]);
    const md = buildOddsReportMarkdown({ events, patterns });
    expect(md).toContain("## Value patterns");
    expect(md).toContain("venue_undervalued");
    expect(md).toContain("kalshi");
  });

  test("prints section placeholders for empty input", () => {
    const md = buildOddsReportMarkdown({ events: [] });
    expect(md).toContain("_No consensus sides (no valid prints)._");
    expect(md).toContain("Events: 0");
  });

  test("books quoting table renders profiles with meta and honest fallback", () => {
    const md = buildOddsReportMarkdown({
      events,
      books: [
        { key: "bet365", name: "Bet365", feed: "odds-api-v3", url: "https://www.bet365.com", registered: true },
        { key: "mystery", name: "Mystery", registered: false },
      ],
    });
    expect(md).toContain("## Books quoting");
    expect(md).toContain("| bet365 | Bet365 | odds-api-v3 | [link](https://www.bet365.com) | — | yes |");
    expect(md).toContain("| mystery | Mystery | — | — | — | NO — wire-only venue |");
  });

  test("feed-derived strings are escaped before markdown assembly", () => {
    // Hand-built event (bypasses the XML parser's own angle-strip) so the
    // report layer's escape contract is exercised directly.
    const hostile: OddsEvent[] = [{
      id: asFeedEventId("<script>alert(1)</script>"),
      sportKey: "soccer_epl",
      commenceTime: "2026-03-01T19:00:00Z",
      homeTeam: "Alpha",
      awayTeam: "Beta",
      bookmakers: [{
        key: "evil<bk>",
        title: "evil<bk>",
        lastUpdate: "2026-03-01T18:00:00Z",
        markets: [{ key: "h2h", outcomes: [{ name: "Alpha|evil\ninjected", price: -110 }] }],
      }],
    }];
    const md = buildOddsReportMarkdown({ events: hostile });
    expect(md).not.toContain("<script>");
    expect(md).toContain("&lt;script&gt;");
    expect(md).toContain("Alpha\\|evil injected");
  });
});

describe("buildOddsReportHtml", () => {  test("hostile venue name survives rendering inert", () => {
    const hostile: OddsEvent[] = [{
      id: asFeedEventId("<img src=x onerror=alert(1)>"),
      sportKey: "soccer_epl",
      commenceTime: "2026-03-01T19:00:00Z",
      homeTeam: "Alpha",
      awayTeam: "Beta",
      bookmakers: [{
        key: "kb",
        title: "kb",
        lastUpdate: "2026-03-01T18:00:00Z",
        markets: [{ key: "h2h", outcomes: [{ name: "Alpha", price: -110 }] }],
      }],
    }];
    const html = buildOddsReportHtml({ events: hostile });
    expect(html).toContain("<table>");
    expect(html).not.toContain("<img src=x");
    // The hostile payload renders as inert entity text, not an element.
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  test("renders the same markdown the text route serves", () => {
    const md = buildOddsReportMarkdown({ events: parseOddsXmlEvents(FIXTURE) });
    expect(markdownToHtml(md, "strict")).toBe(buildOddsReportHtml({ events: parseOddsXmlEvents(FIXTURE) }));
  });
});
