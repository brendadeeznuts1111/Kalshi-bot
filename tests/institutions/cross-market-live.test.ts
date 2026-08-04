import { beforeEach, describe, expect, test } from "bun:test";
import {
  fetchLiveCrossMarketOdds,
  firstInitial,
  lastName,
  liveOddsCacheHealth,
  parseKalshiDate,
  parseSlugDate,
  resetLiveOddsCacheForTests,
  slugCodes,
} from "../../src/institutions/event-store/cross-market-live.ts";
import { SOURCE, SPORT } from "../../src/institutions/market-registry/brands.ts";
import { asSeriesTicker } from "../../src/institutions/event-store/brands.ts";
import { registrationFor } from "../../src/institutions/market-registry/registry.ts";
import {
  diceCoefficient,
  findPolymarketMatch,
  jaroWinkler,
  levenshtein,
  normalizeTennisName,
} from "../../src/institutions/event-store/matcher-v2.ts";
import type { PolymarketEvent } from "../../src/regulatory/integrations/polymarket.ts";

const ATP_SERIES = { series: asSeriesTicker("KXATPMATCH") } as const;
const ITF_SERIES = { series: asSeriesTicker("KXITFMATCH") } as const;
const ITF_WOMEN_SERIES = { series: asSeriesTicker("KXITFWMATCH") } as const;
const ITF_WOMEN_DOUBLES_SERIES = { series: asSeriesTicker("KXITFWDOUBLES") } as const;
const TABLE_TENNIS_SERIES = { series: asSeriesTicker("KXTABLETENNISMATCH") } as const;
const tennisBinding = registrationFor(SOURCE.polymarket, SPORT.tennis)!.competitions[0]!;

function eventSeriesSlug(slug: string): string | undefined {
  if (slug.startsWith("atp-doubles-")) return "atp-doubles";
  if (slug.startsWith("wta-doubles-")) return "wta-doubles";
  if (slug.startsWith("atp-")) return "atp";
  if (slug.startsWith("wta-")) return "wta";
  if (slug.startsWith("itf-")) return "itf";
  if (slug.startsWith("wtt-")) return "ttelite-games";
  return undefined;
}

function polyEvent(
  slug: string,
  title: string,
  outcomes: [string, string],
  overrides: Partial<PolymarketEvent> = {},
): PolymarketEvent {
  const tableTennis = slug.startsWith("wtt-");
  const seriesSlug = eventSeriesSlug(slug);
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
    ...(seriesSlug ? { seriesSlug } : {}),
    tags: [
      {
        id: tableTennis ? "103767" : "864",
        slug: tableTennis ? "table-tennis" : "tennis",
        label: tableTennis ? "Table Tennis" : "Tennis",
      },
    ],
    teams: outcomes.map((name, index) => ({
      id: `${slug}-team-${index}`,
      name,
      abbreviation: null,
      league: seriesSlug ?? null,
      ordering: index === 0 ? "home" : "away",
    })),
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
        sportsMarketType: "moneyline",
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
    expect(normalizeTennisName("Łukasz Kubot / Jan-Lennard Struff")).toBe(
      "lukasz kubot jan lennard struff",
    );
  });

  test("scores prefix typos and n-gram overlap without case sensitivity", () => {
    expect(jaroWinkler("zverev", "zverevv")).toBeGreaterThan(0.95);
    expect(diceCoefficient("tsitsipas", "tsitsip", 2)).toBeGreaterThan(0.8);
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
        ...ATP_SERIES,
      },
      [
        polyEvent(
          "atp-tsitsip-atmane-2026-08-04",
          "ATP Toronto: Stefanos Tsitsipas vs Terence Atmane",
          ["Stefanos Tsitsipas", "Terence Atmane"],
        ),
      ],
      tennisBinding,
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
        ...ATP_SERIES,
      },
      [event],
      tennisBinding,
    );
    expect(levenshtein("alex michelsen", "alex michelson")).toBe(1);
    expect(match?.method).toBe("fuzzy-name");
  });

  test("matches a compound provider name from a stable two-token identity", () => {
    const match = findPolymarketMatch(
      {
        ticker: "KXITFMATCH-26AUG04SOUOLI-SOU",
        playerA: "Andre Souza",
        playerB: "Nicolas Oliveira",
        date: "2026-08-04",
        ...ITF_SERIES,
      },
      [
        polyEvent(
          "itf-andreso-oliveir-2026-08-04",
          "ITF Londrina: Andre Souza Pinto De Camargo E Silva vs Nicolas Oliveira",
          ["Andre Souza Pinto De Camargo E Silva", "Nicolas Oliveira"],
        ),
      ],
      tennisBinding,
    );
    expect(match?.method).toBe("fuzzy-name");
    expect(match?.playerAOutcomeIndex).toBe(0);
  });

  test("matches East-Asian display-order changes and preserves outcome orientation", () => {
    const match = findPolymarketMatch(
      {
        ticker: "KXITFWMATCH-26AUG04SUNZHA-ZHA",
        playerA: "Junhan Zhang",
        playerB: "Tiantian Sun",
        date: "2026-08-04",
        ...ITF_WOMEN_SERIES,
      },
      [
        polyEvent(
          "itf-tiantia-zhan-2026-08-04",
          "ITF Tianjin: Sun Tiantian vs Junhan Zhang",
          ["Sun Tiantian", "Junhan Zhang"],
        ),
      ],
      tennisBinding,
    );
    expect(match?.method).toBe("fuzzy-name");
    expect(match?.playerAOutcomeIndex).toBe(1);
  });

  test("uses a unique date+tournament fallback when names fail", () => {
    const match = findPolymarketMatch(
      {
        ticker: "KXITFMATCH-26AUG04UNKNOWN",
        playerA: "Xavier Dahn",
        playerB: "Yann Receck",
        date: "2026-08-04",
        tournament: "ITF Lexington",
        ...ITF_SERIES,
      },
      [
        polyEvent(
          "itf-damm-recek-2026-08-04",
          "ITF Lexington Men: Martin Damm vs Dalibor Recek",
          ["Martin Damm", "Dalibor Recek"],
        ),
      ],
      tennisBinding,
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
        ...ITF_WOMEN_SERIES,
      },
      [
        polyEvent(
          "itf-selvara-prangle-2026-07-28",
          "ITF W15 Huamantla: Nithesa Selvaraj vs Elizabeth Prangley",
          ["Nithesa Selvaraj", "Elizabeth Prangley"],
        ),
      ],
      tennisBinding,
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
        ...ITF_WOMEN_DOUBLES_SERIES,
      },
      [
        polyEvent(
          "itf-luo-che-2026-08-04",
          "ITF Tianjin: Xi Luo vs Meng-Yi Chen",
          ["Xi Luo", "Meng-Yi Chen"],
        ),
      ],
      tennisBinding,
    );
    expect(match).toBeNull();
  });

  test("reconciles doubles only when series and paired outcomes agree", () => {
    const match = findPolymarketMatch(
      {
        ticker: "KXITFWDOUBLES-26AUG04GUOXUMARYIN",
        playerA: "Guo / Xu",
        playerB: "Marie / Ying",
        date: "2026-08-04",
        ...ITF_WOMEN_DOUBLES_SERIES,
      },
      [
        polyEvent(
          "atp-doubles-guoxu-maryin-2026-08-04",
          "Tianjin (Doubles): Guo/Xu vs Marie/Ying",
          ["Guo / Xu", "Marie / Ying"],
        ),
      ],
      tennisBinding,
    );
    expect(match?.method).toBe("surname");
  });

  test("never treats a two-outcome handicap as a moneyline", () => {
    const event = polyEvent(
      "atp-tsitsip-atmane-2026-08-04",
      "ATP Toronto: Stefanos Tsitsipas vs Terence Atmane",
      ["Stefanos Tsitsipas", "Terence Atmane"],
    );
    event.markets[0]!.sportsMarketType = "tennis_set_handicap";
    expect(
      findPolymarketMatch(
        {
          ticker: "KXATPMATCH-26AUG04TSITSIPATMANE",
          playerA: "Stefanos Tsitsipas",
          playerB: "Terence Atmane",
          date: "2026-08-04",
          ...ATP_SERIES,
        },
        [event],
        tennisBinding,
      ),
    ).toBeNull();
  });

  test("does not treat an undated missing-type proposition as a legacy moneyline", () => {
    const event = polyEvent(
      "will-alcaraz-or-sinner-win-more-grand-slams-in-2026",
      "Will Alcaraz or Sinner win more Grand Slams in 2026?",
      ["Alcaraz", "Sinner"],
    );
    event.markets[0]!.sportsMarketType = undefined;
    expect(
      findPolymarketMatch(
        {
          ticker: "KXATPMATCH-26AUG04ALCSIN",
          playerA: "Carlos Alcaraz",
          playerB: "Jannik Sinner",
          date: "2026-08-04",
          ...ATP_SERIES,
        },
        [event],
        tennisBinding,
      ),
    ).toBeNull();
  });

  test("does not turn an unknown source series into an implicit singles lane", () => {
    const event = polyEvent(
      "mystery-event-2026-08-04",
      "Mystery: Carlos Alcaraz vs Jannik Sinner",
      ["Carlos Alcaraz", "Jannik Sinner"],
    );
    expect(event.markets[0]?.sportsMarketType).toBe("moneyline");
    expect(
      findPolymarketMatch(
        {
          ticker: "KXATPMATCH-26AUG04ALCSIN",
          playerA: "Carlos Alcaraz",
          playerB: "Jannik Sinner",
          date: "2026-08-04",
          ...ATP_SERIES,
        },
        [event],
        tennisBinding,
      ),
    ).toBeNull();
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
    const cursors: Array<string | null> = [];
    const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
      const url = new URL(String(input));
      const cursor = url.searchParams.get("after_cursor");
      const limit = Number(url.searchParams.get("limit") ?? 2);
      cursors.push(cursor);
      expect(url.pathname).toBe("/events/keyset");
      expect(url.searchParams.has("offset")).toBe(false);
      expect(url.searchParams.get("active")).toBe("true");
      expect(url.searchParams.get("closed")).toBe("false");
      const offset = cursor === "page-2" ? 2 : 0;
      const page = rows.slice(offset, offset + limit).map(eventWire);
      return Response.json({
        events: page,
        ...(offset === 0 ? { next_cursor: "page-2" } : {}),
      });
    };
    const target = {
      ticker: "KXATPMATCH-26AUG04TSITSIPATMANE",
      playerA: "Stefanos Tsitsipas",
      playerB: "Terence Atmane",
      tournament: "ATP Toronto",
      ...ATP_SERIES,
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

    expect(cursors).toEqual([null, "page-2"]);
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

  test("keeps non-operational table-tennis reconciliation out of the live path", async () => {
    const tagIds: string[] = [];
    const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
      const url = new URL(String(input));
      const tagId = url.searchParams.get("tag_id") ?? "";
      tagIds.push(tagId);
      const tableTennis = tagId === "103767";
      const event = polyEvent(
        tableTennis ? "wtt-smith-jones-2026-08-04" : "atp-smith-jones-2026-08-04",
        `${tableTennis ? "WTT" : "ATP"}: Alice Smith vs Bob Jones`,
        ["Alice Smith", "Bob Jones"],
      );
      return Response.json({ events: [eventWire(event)] });
    };
    const targets = [
      {
        ticker: "KXATPMATCH-26AUG04SMIJON",
        playerA: "Alice Smith",
        playerB: "Bob Jones",
        ...ATP_SERIES,
      },
      {
        ticker: "KXTABLETENNISMATCH-26AUG04SMIJON",
        playerA: "Alice Smith",
        playerB: "Bob Jones",
        ...TABLE_TENNIS_SERIES,
      },
    ];
    const first = await fetchLiveCrossMarketOdds(targets, { fetchImpl, nowMs: 1_000 });
    const second = await fetchLiveCrossMarketOdds(targets, { fetchImpl, nowMs: 2_000 });
    expect(tagIds).toEqual(["864"]);
    expect(first.get(targets[0]!.ticker)?.polymarketProb).toBe(0.62);
    expect(first.get(targets[1]!.ticker)?.polymarketProb).toBeNull();
    expect(second).toEqual(first);
  });

  test("serves stale immediately while a successful refresh swaps the scoped cache", async () => {
    let calls = 0;
    const fetchImpl = async (): Promise<Response> => {
      calls++;
      const event = polyEvent(
        "atp-smith-jones-2026-08-04",
        "ATP: Alice Smith vs Bob Jones",
        ["Alice Smith", "Bob Jones"],
      );
      event.markets[0]!.outcomePrices = calls === 1 ? [0.62, 0.38] : [0.7, 0.3];
      return Response.json({ events: [eventWire(event)] });
    };
    const target = {
      ticker: "KXATPMATCH-26AUG04SMIJON",
      playerA: "Alice Smith",
      playerB: "Bob Jones",
      ...ATP_SERIES,
    };
    const initial = await fetchLiveCrossMarketOdds([target], { fetchImpl, nowMs: 1_000 });
    const stale = await fetchLiveCrossMarketOdds([target], { fetchImpl, nowMs: 62_000 });
    expect(initial.get(target.ticker)?.polymarketProb).toBe(0.62);
    expect(stale.get(target.ticker)?.polymarketProb).toBe(0.62);
    await Bun.sleep(0);
    const refreshed = await fetchLiveCrossMarketOdds([target], { fetchImpl, nowMs: 62_001 });
    expect(refreshed.get(target.ticker)?.polymarketProb).toBe(0.7);
    expect(calls).toBe(2);
    expect(liveOddsCacheHealth(SPORT.tennis, 62_001).state).toBe("healthy");
  });

  test("opens a circuit after three refresh failures and keeps the last valid snapshot", async () => {
    let calls = 0;
    const fetchImpl = async (): Promise<Response> => {
      calls++;
      if (calls > 1) throw new Error("upstream unavailable");
      return Response.json({
        events: [
          eventWire(
            polyEvent(
              "atp-smith-jones-2026-08-04",
              "ATP: Alice Smith vs Bob Jones",
              ["Alice Smith", "Bob Jones"],
            ),
          ),
        ],
      });
    };
    const target = {
      ticker: "KXATPMATCH-26AUG04SMIJON",
      playerA: "Alice Smith",
      playerB: "Bob Jones",
      ...ATP_SERIES,
    };
    await fetchLiveCrossMarketOdds([target], { fetchImpl, nowMs: 1_000, retries: 0 });
    for (const nowMs of [62_000, 63_000, 64_000]) {
      const fallback = await fetchLiveCrossMarketOdds([target], { fetchImpl, nowMs, retries: 0 });
      expect(fallback.get(target.ticker)?.polymarketProb).toBe(0.62);
      await Bun.sleep(0);
    }
    expect(liveOddsCacheHealth(SPORT.tennis, 64_001)).toMatchObject({
      state: "circuit_open",
      consecutiveFailures: 3,
    });
    await fetchLiveCrossMarketOdds([target], { fetchImpl, nowMs: 65_000, retries: 0 });
    expect(calls).toBe(4);
  });

  test("opens a cold-cache circuit and blocks additional upstream calls", async () => {
    let calls = 0;
    const fetchImpl = async (): Promise<Response> => {
      calls++;
      throw new Error("cold upstream unavailable");
    };
    const target = {
      ticker: "KXATPMATCH-26AUG04SMIJON",
      playerA: "Alice Smith",
      playerB: "Bob Jones",
      ...ATP_SERIES,
    };
    for (const nowMs of [1_000, 2_000, 3_000]) {
      await expect(
        fetchLiveCrossMarketOdds([target], { fetchImpl, nowMs, retries: 0 }),
      ).rejects.toThrow("Every Polymarket sport scope failed");
    }
    expect(liveOddsCacheHealth(SPORT.tennis, 3_001)).toMatchObject({
      state: "circuit_open",
      consecutiveFailures: 3,
    });
    await expect(
      fetchLiveCrossMarketOdds([target], { fetchImpl, nowMs: 4_000, retries: 0 }),
    ).rejects.toThrow("Every Polymarket sport scope failed");
    expect(calls).toBe(3);
  });
});
