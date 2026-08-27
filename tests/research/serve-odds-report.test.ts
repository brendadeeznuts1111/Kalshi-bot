/**
 * /api/odds-report route tests — Bun.XML feed wired into the report surface:
 * odds-reference.xml -> parseOddsXmlEvents (Bun.XML.parse) -> consensus +
 * value-pattern tables, ETag/304 lifecycle.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { createResearchServer } from "../../src/research/serve.ts";

const server = createResearchServer({ port: 0 });

afterAll(() => {
  server.stop(true);
});

describe("/api/odds-report (Bun.XML feed wired)", () => {
  test("markdown serves consensus + value patterns from the reference feed", async () => {
    const res = await fetch(server.url + "api/odds-report");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    const md = await res.text();
    expect(md).toContain("Data state: reference_feed");
    // Event id is the MATCH (teams + commence date), never the venue/book.
    expect(md).toContain("| alpha-fc-vs-beta-fc-2026-09-01 | Alpha FC | 4 |");
    // Venue is the match location; books are separate.
    expect(md).toContain("## Matches");
    expect(md).toContain("| 51.5074, -0.1278 | 2026-09-01T19:00:00Z |");
    expect(md).toContain("venue_undervalued");
  });

  test("books quoting section separates registered books from wire-only venues", async () => {
    const res = await fetch(server.url + "api/odds-report");
    const md = await res.text();
    expect(md).toContain("## Books quoting");
    // bet365 is declared in the registry -> profile with meta url.
    expect(md).toContain("| bet365 | Bet365 | odds-api-v3 | [link](https://www.bet365.com) |");
    // pinnacle/draftkings/williamhill quote the wire undeclared -> honest fallback.
    expect(md).toContain("| pinnacle | pinnacle | — | — | — | NO — wire-only venue |");
  });

  test("html variant renders the same feed through the widget page", async () => {
    const res = await fetch(server.url + "api/odds-report?format=html");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Odds Heat Report");
    expect(html).toContain("venue_undervalued");
  });

  test("second request revalidates via If-None-Match -> 304", async () => {
    const first = await fetch(server.url + "api/odds-report");
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();
    const second = await fetch(server.url + "api/odds-report", {
      headers: { "if-none-match": etag! },
    });
    expect(second.status).toBe(304);
  });
});
