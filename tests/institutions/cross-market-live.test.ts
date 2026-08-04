import { beforeEach, describe, expect, test } from "bun:test";
import {
  fetchLiveCrossMarketOdds,
  firstInitial,
  lastName,
  parseKalshiDate,
  parseSlugDate,
  resetLiveOddsCacheForTests,
  slugCodes,
} from "../../src/institutions/event-store/cross-market-live.ts";
import {
  findPolymarketMatch,
  levenshtein,
} from "../../src/institutions/event-store/matcher-v2.ts";
import type { PolymarketEvent } from "../../src/regulatory/integrations/polymarket.ts";

function polyEvent(
  slug: string,
  title: string,
  outcomes: [string, string],
  overrides: Partial<PolymarketEvent> = {},
): PolymarketEvent {
  return {
    id: slug,
    ticker: slug,
    slug,
    title,
    volume: 120,
    volume24hr: 25,
    openInterest: 30,
    liquidity: 40,
    liquidityClob: 40,
    active: true,
    closed: false,
    markets: [
      {
        id: `${slug}-moneyline`,
        slug,
        question: title,
        conditionId: "condition",
        outcomes,
        outcomePrices: [0.62, 0.38],
        volume: 100,
        volume24hr: 20,
        volume1wk: 0,
        volume1mo: 0,
        liquidity: 35,
        liquidityClob: 35,
        openInterest: 12,
        lastTradePrice: 0.62,
        active: true,
        closed: false,
        createdAt: "2026-08-04T00:00:00Z",
        updatedAt: "2026-08-04T00:00:00Z",
      },
    ],
    ...overrides,
  };
}

function eventWire(event: PolymarketEvent): Record<string, unknown> {
  return {
    ...event,
    markets: event.markets.map((market) => ({
      ...market,
      outcomes: JSON.stringify(market.outcomes),
      outcomePrices: JSON.stringify(market.outcomePrices),
      volume: String(market.volume),
      liquidity: String(market.liquidity),
    })),
  };
}

describe("name and slug parsing", () => {
  test("normalizes initials and surnames", () => {
    expect(firstInitial("Benoît Paire")).toBe("b");
    expect(lastName("Novak Djokovic (1)")).toBe("djokovic");
  });

  test("extracts variable-length surname codes", () => {
    expect(slugCodes("atp-tsitsip-atmane-2026-08-04")).toEqual([
      "tsitsip",
      "atmane",
    ]);
    expect(slugCodes("nba-lakers-celtics")).toBeNull();
  });

  test("validates slug calendar dates", () => {
    expect(parseSlugDate("atp-damm-atmane-2026-08-04")).toBe("2026-08-04");
    expect(parseSlugDate("atp-damm-atmane-2026-13-99")).toBeNull();
  });
});

describe("parseKalshiDate", () => {
  test("parses YYMMMDD instead of DDMMMYY", () => {
    expect(parseKalshiDate("KXITFMATCH-26AUG04SANTOSGRIPPO")).toBe(
      "2026-08-04",
    );
    expect(
      new Date(`${parseKalshiDate("KXITFMATCH-26AUG04SANTOSGRIPPO")}T00:00:00Z`)
        .toISOString()
        .startsWith("2026-08-04"),
    ).toBe(true);
  });

  test("rejects invalid calendar dates and formats", () => {
    expect(parseKalshiDate("KXITFMATCH-26FEB30BADDATE")).toBeNull();
    expect(parseKalshiDate("NOTAFORMAT")).toBeNull();
  });
});

describe("matcher V2", () => {
  test("matches surname-derived Polymarket codes without first initials", () => {
    const match = findPolymarketMatch(
      {
        ticker: "KXATPMATCH-26AUG04TSITSIPATMANE",
        playerA: "Stefanos Tsitsipas",
        playerB: "Terence Atmane",
        date: "2026-08-04",
        tournament: "ATP Toronto",
      },
      [
        polyEvent(
          "atp-tsitsip-atmane-2026-08-04",
          "ATP Toronto: Stefanos Tsitsipas vs Terence Atmane",
          ["Stefanos Tsitsipas", "Terence Atmane"],
        ),
      ],
    );
    expect(match?.method).toBe("surname");
    expect(match?.playerAOutcomeIndex).toBe(0);
  });

  test("uses bounded Levenshtein matching for small full-name typos", () => {
    const event = polyEvent(
      "atp-playerone-playertwo-2026-08-04",
      "ATP Toronto: Alex Michelsen vs Learner Tien",
      ["Alex Michelson", "Learner Tienn"],
    );
    const match = findPolymarketMatch(
      {
        ticker: "KXATPMATCH-26AUG04MICHELSENTIEN",
        playerA: "Alex Michelsen",
        playerB: "Learner Tien",
        date: "2026-08-04",
      },
      [event],
    );
    expect(levenshtein("alex michelsen", "alex michelson")).toBe(1);
    expect(match?.method).toBe("fuzzy-name");
  });

  test("uses a unique date+tournament fallback when names fail", () => {
    const match = findPolymarketMatch(
      {
        ticker: "KXITFMATCH-26AUG04UNKNOWN",
        playerA: "Xavier Dahn",
        playerB: "Yann Receck",
        date: "2026-08-04",
        tournament: "ITF Lexington",
      },
      [
        polyEvent(
          "itf-damm-recek-2026-08-04",
          "ITF Lexington Men: Martin Damm vs Dalibor Recek",
          ["Martin Damm", "Dalibor Recek"],
        ),
      ],
    );
    expect(match?.method).toBe("date-tournament");
  });

  test("does not treat generic ITF tier codes as tournament identity", () => {
    const match = findPolymarketMatch(
      {
        ticker: "KXITFWMATCH-26JUL28FAVSOU",
        playerA: "Alice Soulie",
        playerB: "Manon Favier",
        date: "2026-07-28",
        tournament: "W15 Savitaipale",
      },
      [
        polyEvent(
          "itf-selvara-prangle-2026-07-28",
          "ITF W15 Huamantla: Nithesa Selvaraj vs Elizabeth Prangley",
          ["Nithesa Selvaraj", "Elizabeth Prangley"],
        ),
      ],
    );
    expect(match).toBeNull();
  });

  test("never reconciles a doubles target to a singles event", () => {
    const match = findPolymarketMatch(
      {
        ticker: "KXITFWDOUBLES-26AUG04GUOXUXMARYIN",
        playerA: "Guo / Xu",
        playerB: "Marie Desvignes / Ying Shek",
        date: "2026-08-04",
        tournament: "W15 Tianjin",
      },
      [
        polyEvent(
          "itf-luo-che-2026-08-04",
          "ITF Tianjin: Xi Luo vs Meng-Yi Chen",
          ["Xi Luo", "Meng-Yi Chen"],
        ),
      ],
    );
    expect(match).toBeNull();
  });
});

describe("live feed pagination and cache", () => {
  beforeEach(resetLiveOddsCacheForTests);

  test("paginates the complete feed and shares it for 60 seconds", async () => {
    const rows = [
      polyEvent("atp-other-one-2026-08-04", "ATP A: Other vs One", ["Other", "One"]),
      polyEvent("atp-other-two-2026-08-04", "ATP B: Other vs Two", ["Other", "Two"]),
      polyEvent(
        "atp-tsitsip-atmane-2026-08-04",
        "ATP Toronto: Stefanos Tsitsipas vs Terence Atmane",
        ["Stefanos Tsitsipas", "Terence Atmane"],
      ),
    ];
    const offsets: number[] = [];
    const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
      const url = new URL(String(input));
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 2);
      offsets.push(offset);
      return Response.json(rows.slice(offset, offset + limit).map(eventWire));
    };
    const target = {
      ticker: "KXATPMATCH-26AUG04TSITSIPATMANE",
      playerA: "Stefanos Tsitsipas",
      playerB: "Terence Atmane",
      tournament: "ATP Toronto",
    };

    const first = await fetchLiveCrossMarketOdds([target], {
      fetchImpl,
      pageSize: 2,
      nowMs: 1_000,
    });
    const second = await fetchLiveCrossMarketOdds([target], {
      fetchImpl,
      pageSize: 2,
      nowMs: 31_000,
    });

    expect(offsets).toEqual([0, 2, 3]);
    expect(second).toEqual(first);
    expect(first.get(target.ticker)).toMatchObject({
      polymarketProb: 0.62,
      polymarketVolume24h: 20,
      polymarketVolumeLifetime: 100,
      polymarketLiquidity: 35,
      polymarketOpenInterest: 12,
      polymarketMatchMethod: "surname",
    });
  });
});
