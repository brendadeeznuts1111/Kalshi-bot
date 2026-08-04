// @see https://bun.com/docs/test
import { describe, expect, test } from "bun:test";
import { asCanonicalEventId, asKalshiEventTicker } from "../../src/institutions/event-store/brands.ts";
import {
  buildCrossMarketSignals,
  formatDeviationPct,
  midToProb,
  primaryDeviation,
  type WarehouseEventForSignal,
} from "../../src/warehouse/cross-market-signals.ts";

function ev(partial: {
  eventId: string;
  eventTicker?: WarehouseEventForSignal["eventTicker"];
  title?: string;
  playerA?: string;
  playerB?: string;
  kalshiMidCents?: number | null;
}): WarehouseEventForSignal {
  return {
    eventId: asCanonicalEventId(partial.eventId),
    eventTicker: partial.eventTicker ?? asKalshiEventTicker("KXITFMATCH-26JUL22SANALV"),
    title: partial.title ?? "KXITFMATCH-26JUL22SANALV",
    playerA: partial.playerA ?? "San",
    playerB: partial.playerB ?? "Alv",
    kalshiMidCents: partial.kalshiMidCents !== undefined ? partial.kalshiMidCents : 55,
  };
}

describe("cross-market-signals", () => {
  test("midToProb maps cents to 0-1", () => {
    expect(midToProb(50)).toBe(0.5);
    expect(midToProb(null)).toBeNull();
    expect(midToProb(0)).toBeNull();
    expect(midToProb(100)).toBeNull();
  });

  test("buildCrossMarketSignals ranks by absDeviation and filters small gaps", () => {
    const odds = new Map([
      [
        "KXITFMATCH-26JUL22SANALV",
        { polymarketProb: 0.4, pinnacleProb: 0.45 },
      ],
      [
        "KXITFMATCH-26JUL22OTHER",
        { polymarketProb: 0.54, pinnacleProb: null },
      ],
    ]);
    const signals = buildCrossMarketSignals(
      [
        ev({
          eventId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          eventTicker: asKalshiEventTicker("KXITFMATCH-26JUL22SANALV"),
          kalshiMidCents: 62, // 0.62 vs 0.40 → 22pp
        }),
        ev({
          eventId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          eventTicker: asKalshiEventTicker("KXITFMATCH-26JUL22OTHER"),
          title: "KXITFMATCH-26JUL22OTHER",
          kalshiMidCents: 54, // 0.54 vs 0.54 → 0pp → filtered
        }),
      ],
      odds,
    );
    expect(signals.length).toBe(1);
    expect(signals[0]!.absDeviation).toBeCloseTo(0.22, 5);
    expect(primaryDeviation(signals[0]!)).toBeCloseTo(0.22, 5);
    expect(formatDeviationPct(0.173)).toBe("+17.3%");
    expect(formatDeviationPct(-0.129)).toBe("-12.9%");
  });

  test("skips events without kalshi mid", () => {
    const signals = buildCrossMarketSignals(
      [ev({ eventId: "cccccccccccccccccccccccccccccccc", kalshiMidCents: null })],
      new Map([["KXITFMATCH-26JUL22SANALV", { polymarketProb: 0.5, pinnacleProb: 0.5 }]]),
    );
    expect(signals).toEqual([]);
  });
});
