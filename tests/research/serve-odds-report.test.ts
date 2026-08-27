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
    // Venue identity: store name/city + map link + venue-local kickoff
    // (19:00Z == 20:00 Europe/London).
    expect(md).toContain("## Matches");
    expect(md).toContain("| Alpha Park, London | [map](https://www.google.com/maps?q=51.5074,-0.1278) | 1 Sep 2026 at 20:00 |");
    // Two matches share Alpha Park -> collision badge fires.
    expect(md).toContain("| 2 events |");
    // Second match at Gamma Fields (second venue store entry).
    expect(md).toContain("Gamma Fields, Liverpool");
    expect(md).toContain("venue_undervalued");
  });

  test("books quoting section separates registered books from wire-only venues", async () => {
    const res = await fetch(server.url + "api/odds-report");
    const md = await res.text();
    expect(md).toContain("## Books quoting");
    // bet365 is declared in the registry -> profile with meta url.
    expect(md).toContain("| bet365 | Bet365 | odds-api-v3 | [www.bet365.com](https://www.bet365.com) |");
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

  test("gzip negotiation: Accept-Encoding gzip -> content-encoding gzip; plain otherwise (§240)", async () => {
    // Bun's fetch sends accept-encoding: gzip by default — force identity for the plain case.
    const plain = await fetch(server.url + "api/odds-report", { headers: { "accept-encoding": "identity" } });
    expect(plain.headers.get("content-encoding")).toBeNull();
    const gz = await fetch(server.url + "api/odds-report", { headers: { "accept-encoding": "gzip" } });
    expect(gz.headers.get("content-encoding")).toBe("gzip");
    // Bun's fetch client auto-decompresses the gzip body — the header is the signal.
    const text = await gz.text();
    expect(text).toContain("Odds Heat Report");
  });
});
