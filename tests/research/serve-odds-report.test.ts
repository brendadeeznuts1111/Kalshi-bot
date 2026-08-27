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
    expect(md).toContain("| bet365 | Alpha FC | 4 |");
    expect(md).toContain("venue_undervalued");
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
