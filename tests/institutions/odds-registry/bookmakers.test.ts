/**
 * bookmakers store tests — venue -> profile resolution from the registry:
 * declared books carry name/feed/meta url; wire-only venues resolve to an
 * honest unregistered fallback (never dropped, never impersonating a book).
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { bookmakerProfile, booksQuoting, loadOddsRegistryConfig, parseOddsXmlEvents } from "../../../src/institutions/odds-registry/index.ts";

const ROOT = join(import.meta.dir, "..", "..", "..");

describe("bookmaker profile store", () => {
  test("declared book resolves with name, feed, and meta url", async () => {
    const config = await loadOddsRegistryConfig(ROOT);
    const p = bookmakerProfile(config, "bet365");
    expect(p).toMatchObject({
      key: "bet365",
      name: "Bet365",
      feed: "odds-api-v3",
      region: "us",
      url: "https://www.bet365.com",
      registered: true,
    });
  });

  test("unregistered wire venue resolves to an honest fallback", async () => {
    const config = await loadOddsRegistryConfig(ROOT);
    const p = bookmakerProfile(config, "pinnacle", "Pinnacle Wire");
    expect(p.registered).toBe(false);
    expect(p.name).toBe("Pinnacle Wire"); // wire title kept, not a guess
    expect(p.url).toBeUndefined();
    expect(p.logo).toBeUndefined();
    expect(p.feed).toBeUndefined();
  });

  test("booksQuoting maps venues in wire order and dedupes", () => {
    const config = { bookmakers: [{ key: "bet365", name: "Bet365", feed: "odds-api-v3" as const, sports: [], meta: {} }] };
    const events = parseOddsXmlEvents(
      '<odds-heat>'
        + '<cluster venue="bet365" commence="2026-09-01T19:00:00Z"><print name="A" american="-110"/><print name="B" american="+100"/></cluster>'
        + '<cluster venue="mystery-book" commence="2026-09-01T19:00:00Z"><print name="A" american="-105"/><print name="B" american="+105"/></cluster>'
        + '<cluster venue="bet365" commence="2026-09-01T19:00:00Z"><print name="A" american="-115"/><print name="B" american="+95"/></cluster>'
        + '</odds-heat>',
    );
    const books = booksQuoting(config, events);
    expect(books.map((b) => b.key)).toEqual(["bet365", "mystery-book"]);
    expect(books[0]!.registered).toBe(true);
    expect(books[1]!.registered).toBe(false);
  });
});
