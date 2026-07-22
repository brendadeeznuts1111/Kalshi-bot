// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  asCompetitorId,
  asKalshiEventTicker,
  asSeriesTicker,
} from "../../src/institutions/event-store/brands.ts";
import {
  mintKalshiCompetitorEventId,
  mintKalshiEventId,
  normalizeKalshiStartTs,
  tryMintKalshiEventIdFromMarkets,
} from "../../src/institutions/event-store/kalshi-event-id.ts";

const competitor1Id = asCompetitorId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
const competitor2Id = asCompetitorId("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
const eventTicker = asKalshiEventTicker("KXITFMATCH-26JUL22SANALV");
const series = asSeriesTicker("KXITFMATCH");

describe("kalshi-event-id", () => {
  test("competitor+start keys differ from ticker-blob keys", () => {
    const byTicker = mintKalshiEventId(asKalshiEventTicker("KXITFMATCH-26JUL22ZAKBAK"));
    const byComp = mintKalshiCompetitorEventId({
      series,
      competitorA: competitor1Id,
      competitorB: competitor2Id,
      startTs: "2026-07-22T10:00:00Z",
    });
    expect(byTicker).not.toBe(byComp);
  });

  test("competitor order is normalized", () => {
    const a = mintKalshiCompetitorEventId({
      series,
      competitorA: competitor2Id,
      competitorB: competitor1Id,
      startTs: "2026-07-22T10:00:00Z",
    });
    const b = mintKalshiCompetitorEventId({
      series,
      competitorA: competitor1Id,
      competitorB: competitor2Id,
      startTs: "2026-07-22T10:00:00Z",
    });
    expect(a).toBe(b);
  });

  test("tryMint prefers competitor pair when both present", () => {
    const r = tryMintKalshiEventIdFromMarkets({
      eventTicker,
      series,
      startTs: "2026-07-22T10:00:00Z",
      competitorIds: [competitor1Id, competitor2Id],
    });
    expect(r.keyedBy).toBe("competitors");
    const fallback = tryMintKalshiEventIdFromMarkets({
      eventTicker,
      series,
      startTs: "2026-07-22T10:00:00Z",
      competitorIds: [competitor1Id],
    });
    expect(fallback.keyedBy).toBe("ticker");
  });

  test("normalizeKalshiStartTs canonicalizes ISO format drift", () => {
    expect(normalizeKalshiStartTs("2026-07-22T10:00:00Z")).toBe(
      "2026-07-22T10:00:00.000Z",
    );
    expect(normalizeKalshiStartTs("2026-07-22T10:00:00.000Z")).toBe(
      "2026-07-22T10:00:00.000Z",
    );
    expect(normalizeKalshiStartTs("2026-07-22T10:00:00+00:00")).toBe(
      "2026-07-22T10:00:00.000Z",
    );
    expect(normalizeKalshiStartTs("2026-07-22T10:00:34.567Z")).toBe(
      "2026-07-22T10:00:00.000Z",
    );
  });

  test("ISO startTs format variants mint the same competitor event id", () => {
    const base = {
      series,
      competitorA: competitor1Id,
      competitorB: competitor2Id,
    };
    const z = mintKalshiCompetitorEventId({ ...base, startTs: "2026-07-22T10:00:00Z" });
    const ms = mintKalshiCompetitorEventId({
      ...base,
      startTs: "2026-07-22T10:00:00.000Z",
    });
    const offset = mintKalshiCompetitorEventId({
      ...base,
      startTs: "2026-07-22T10:00:00+00:00",
    });
    expect(z).toBe(ms);
    expect(z).toBe(offset);
  });

  test("second-level difference within the same minute mints the same id", () => {
    const base = {
      series,
      competitorA: competitor1Id,
      competitorB: competitor2Id,
    };
    const a = mintKalshiCompetitorEventId({
      ...base,
      startTs: "2026-07-22T10:00:00Z",
    });
    const b = mintKalshiCompetitorEventId({
      ...base,
      startTs: "2026-07-22T10:00:34Z",
    });
    expect(a).toBe(b);
  });

  test("different minutes mint different competitor event ids", () => {
    const base = {
      series,
      competitorA: competitor1Id,
      competitorB: competitor2Id,
    };
    const a = mintKalshiCompetitorEventId({
      ...base,
      startTs: "2026-07-22T08:30:00Z",
    });
    const b = mintKalshiCompetitorEventId({
      ...base,
      startTs: "2026-07-22T10:34:26Z",
    });
    expect(a).not.toBe(b);
  });
});
