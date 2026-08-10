// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  PLIVE_STREAM_ENDPOINTS,
  requireDefaultUrlForUltraMapper,
} from "../../src/domain/index.ts";
import {
  CookieJar,
  executionResultFromBetGroups,
  FantasyUltraAdapter,
  getFantasySessionAdapter,
  getPartnerAdapter,
  inspectStreamListCapabilities,
  normalizeClientEventIdCandidates,
  orderIntentFromComponentBet,
  originFromLiveUrl,
  parseBetGroupsResponse,
  parseRenewTokenResponse,
  parseSportsLeagues,
  parseStatscoreBookedEvents,
  parseStreamList,
  parseUltraLiveUrlResponse,
  statscorePayloadHasPrices,
  type PartnerAccountProfile,
} from "../../src/partner/index.ts";

const DOMAIN = requireDefaultUrlForUltraMapper();
const STREAM_ORIGIN = PLIVE_STREAM_ENDPOINTS.streamOrigin;
const STREAM_HOST = new URL(STREAM_ORIGIN).hostname;

/** Captured place/open ticket response (redacted dummy desk). */
const betTicketWire = {
  betGroups: [
    {
      betGroupId: 307200153,
      ticketNumber: 1036636660,
      finalOdds: 1.8928569555282593,
      risk: 68,
      toWin: 60.71,
      toWinTaxAmount: 0,
      result: 0,
      state: 0,
      acceptTime: 1785845383.544,
      betType: 0,
      currency: "USD",
      delay: 5,
      componentBets: [
        {
          betId: 335749942,
          sequenceNumber: 1,
          sportId: 93,
          countryId: 20,
          leagueId: 23367,
          leagueName: "Czech Republic Pro League Men",
          eventId: 196878741,
          periodId: "m",
          marketId: "3",
          key: "2",
          subKey: "",
          team1: "Kyryl Darin",
          team2: "Jiri Plachy",
          finalOdds: 1.8928569555282593,
          canCashout: true,
          state: 0,
        },
      ],
    },
  ],
  e: 0,
  d: "",
};

const ultraWire = {
  URL: {
    DESKTOP: `${STREAM_ORIGIN}/live/?customerId=BB55113&tstamp=2026-08-04T12:00:00.000Z&lang=en&skin=ezlive&hash=abc`,
    MOBILE: `${STREAM_ORIGIN}/live/?customerId=BB55113&tstamp=2026-08-04T12:00:00.000Z&lang=en&skin=ezlive&hash=abc&m=1`,
  },
};

const streamWire = {
  sports: {
    tennis: {
      count: 2,
      events: {
        "39778041": {
          sport: "Tennis",
          league: "ATT. Saransk",
          competitiors: { home: "Player A", away: "Player B" },
          stream_id: 39778041,
          feed_id: 0,
          donbest_id: "0",
          donbest_id_multi: [],
        },
        "39778067": {
          sport: "Tennis",
          league: "Challenger - Grodzisk",
          competitiors: {
            home: "Viktor Durasovic",
            away: "Michael Geerts",
          },
          stream_id: 39778067,
          feed_id: 52010021809,
          donbest_id: "0",
          donbest_id_multi: [],
        },
      },
    },
    football: {
      count: 1,
      events: {
        "1": {
          sport: "Football",
          league: "X",
          competitiors: { home: "H", away: "A" },
          stream_id: 1,
          feed_id: 0,
        },
      },
    },
  },
  error: false,
  error_explain: null,
  modified_time: 1785844114526,
};

const leaguesWire = {
  Leagues: [
    {
      SportType: "TENNIS",
      SportSubType: "ATP",
      SportSubTypeDisplay: "ATP ",
      SequenceNumber: 1001,
      Active: 1,
      PeriodDescription: "Match",
    },
    {
      SportType: "BASEBALL",
      SportSubType: "MLB",
      SportSubTypeDisplay: "MLB ",
      SequenceNumber: 2001,
      Active: 1,
      PeriodDescription: "Game",
    },
  ],
};

const profile: PartnerAccountProfile = {
  id: "dummy",
  partner: "fantasy402",
  url: DOMAIN,
  status: "active",
  meta: {
    customerID: "C",
    agentID: "AGENT1",
    password: "p",
    token: "old-token",
    skin: 2,
    currency: "USD",
  },
};

describe("fantasy ultra parse", () => {
  test("parseUltraLiveUrlResponse reads URL.DESKTOP/MOBILE", () => {
    const urls = parseUltraLiveUrlResponse(ultraWire);
    expect(urls.desktop).toContain(STREAM_HOST);
    expect(urls.mobile).toContain(STREAM_HOST);
  });

  test("parseStreamList filters tennis and fixes competitiors typo", () => {
    const events = parseStreamList(streamWire, { sport: "tennis" });
    expect(events.length).toBe(2);
    expect(events[0]!.home).toBe("Player A");
    expect(events[0]!.away).toBe("Player B");
    expect(events[0]!.partner).toBe("fantasy402");
    expect(events[1]!.league).toContain("Grodzisk");
  });

  test("parseSportsLeagues", () => {
    const rows = parseSportsLeagues(leaguesWire);
    expect(rows.length).toBe(2);
    expect(rows[0]!.sportType).toBe("TENNIS");
    expect(rows[0]!.active).toBe(true);
    expect(rows[1]!.sportSubType).toBe("MLB");
  });

  test("parseRenewTokenResponse reads code field", () => {
    expect(parseRenewTokenResponse({ code: "jwt.abc.def" })).toBe("jwt.abc.def");
    expect(parseRenewTokenResponse({ token: "Bearer x.y.z" })).toBe("x.y.z");
  });

  test("originFromLiveUrl", () => {
    expect(originFromLiveUrl(ultraWire.URL.DESKTOP)).toBe(STREAM_ORIGIN);
  });

  test("CookieJar absorbs Set-Cookie", () => {
    const jar = new CookieJar();
    jar.absorb(["a=1; Path=/", "b=2; HttpOnly"]);
    expect(jar.headerValue()).toBe("a=1; b=2");
  });

  test("inspectStreamListCapabilities reports coverage-only (no invented markets)", () => {
    const cap = inspectStreamListCapabilities(streamWire);
    expect(cap.hasRootEventsArray).toBe(false);
    expect(cap.hasPricingKeys).toBe(false);
    expect(cap.sampleEventKeys).toContain("competitiors");
    expect(cap.sampleEventKeys).not.toContain("markets");
    expect(cap.note).toContain("Coverage-only");
  });

  test("parseStatscoreBookedEvents maps livescorepro metadata (no prices)", () => {
    const wire = {
      api: {
        method: { total_items: 1 },
        data: {
          booked_events: [
            {
              id: 6679023,
              client_event_id: "19690946",
              name: "Player A - Player B",
              sport_id: 4,
              sport_name: "Tennis",
              competition_short_name: "ITF",
              start_date: "2026-08-04 11:40",
              status_name: "Live",
              status_type: "live",
              bet_status: "suspended",
              relation_status: "in_progress",
            },
          ],
        },
      },
    };
    const rows = parseStatscoreBookedEvents(wire);
    expect(rows.length).toBe(1);
    expect(rows[0]!.oddsEventId).toBe("19690946");
    expect(rows[0]!.statscoreId).toBe(6679023);
    expect(rows[0]!.betStatus).toBe("suspended");
    expect(statscorePayloadHasPrices(wire)).toBe(false);
    expect(normalizeClientEventIdCandidates("196907981")).toEqual([
      "196907981",
      "19690798",
    ]);
  });
});

describe("FantasyUltraAdapter session blueprint", () => {
  test("login warm + sports + events + renew with mock fetch", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url}`);
      if (url.includes("getUltraLiveURL")) {
        return new Response(JSON.stringify(ultraWire), {
          status: 200,
          headers: { "set-cookie": "sess=abc; Path=/" },
        });
      }
      if (url.includes(STREAM_HOST)) {
        return new Response("<html>widget</html>", {
          status: 200,
          headers: { "set-cookie": "widget=1; Path=/" },
        });
      }
      if (url.includes("Get_SportsLeagues")) {
        // ensure form body contains operation
        const body = String(init?.body ?? "");
        expect(body).toContain("Get_SportsLeagues");
        expect(body).toContain("agentID=AGENT1");
        return new Response(JSON.stringify(leaguesWire), { status: 200 });
      }
      if (url.includes("stream-list")) {
        return new Response(JSON.stringify(streamWire), { status: 200 });
      }
      if (url.includes("renewToken")) {
        return new Response(JSON.stringify({ code: "new.jwt.token" }), {
          status: 200,
        });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const adapter = new FantasyUltraAdapter({
      credentials: {
        customerID: "BB55113",
        agentID: "AGENT1",
        password: "x",
        bearerToken: "old-token",
        domain: DOMAIN,
        skin: 2,
        currency: "USD",
      },
      fetchImpl,
      warmSession: true,
    });

    const urls = await adapter.login();
    expect(urls.desktop).toContain(STREAM_HOST);
    expect(adapter.isWarmed()).toBe(true);
    expect(adapter.cookieCount()).toBeGreaterThanOrEqual(1);

    const sports = await adapter.fetchSports();
    expect(sports.some((s) => s.sportType === "TENNIS")).toBe(true);

    const events = await adapter.fetchInventory({ sport: "tennis" });
    expect(events.length).toBe(2);

    const next = await adapter.renewToken();
    expect(next).toBe("new.jwt.token");
    expect(adapter.getBearerToken()).toBe("new.jwt.token");

    expect(calls.some((c) => c.startsWith("POST ") && c.includes("getUltraLiveURL"))).toBe(
      true,
    );
    expect(calls.some((c) => c.includes("Get_SportsLeagues"))).toBe(true);
    expect(calls.some((c) => c.includes("stream-list"))).toBe(true);
    expect(calls.some((c) => c.includes("renewToken"))).toBe(true);

    const dry = await adapter.placeOrder({
      // place-bet uses odds/ticket eventId — not inventoryId
      eventId: "196878741",
      side: "home",
      stake: 5,
      dryRun: true,
    });
    expect(dry.success).toBe(false);
    expect(dry.dryRun).toBe(true);

    await expect(adapter.fetchMarkets()).rejects.toThrow(/coverage-only|fetchMarkets unavailable/i);
  });

  test("fetchMarkets / fetchOdds from coefficient store after ingest", async () => {
    const adapter = new FantasyUltraAdapter({
      credentials: {
        customerID: "C",
        agentID: "A",
        password: "p",
        bearerToken: "t",
        domain: DOMAIN,
        skin: 2,
        currency: "USD",
      },
      warmSession: false,
      fetchImpl: (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch,
    });
    const payload = {
      id: 42,
      c: { m: { "3": { o: { "1": 1.9, "2": 1.95 } } } },
    };
    adapter.getCoefficientStore().ingest({
      room: "live.main.TOK.eventCoefficients.42",
      eventId: 42,
      envelope: { isDiff: false, payload },
      lines: [],
    });
    const markets = await adapter.fetchMarkets();
    expect(markets).toHaveLength(1);
    expect(markets[0]!.oddsEventId).toBe("42");
    expect(adapter.pricedEventCount()).toBe(1);
    const odds = await adapter.fetchOdds("42");
    expect(odds[0]!.homePrice).toBeTypeOf("number");
  });

  test("fetchBookedEvent + fetchOdds diagnostic with mock Statscore", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("getUltraLiveURL")) {
        return new Response(JSON.stringify(ultraWire), { status: 200 });
      }
      if (url.includes("plive")) {
        return new Response("ok", { status: 200 });
      }
      if (url.includes("booked-events")) {
        return new Response(
          JSON.stringify({
            api: {
              data: {
                booked_events: [
                  {
                    id: 1,
                    client_event_id: "19690946",
                    name: "A - B",
                    sport_name: "Tennis",
                    bet_status: "active",
                    status_name: "Live",
                  },
                ],
              },
            },
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    const adapter = new FantasyUltraAdapter({
      credentials: {
        customerID: "C",
        agentID: "A",
        password: "p",
        bearerToken: "t",
        domain: DOMAIN,
        skin: 2,
        currency: "USD",
      },
      fetchImpl,
      warmSession: false,
    });

    const booked = await adapter.fetchBookedEvent("19690946");
    expect(booked?.name).toBe("A - B");
    await expect(adapter.fetchOdds("19690946")).rejects.toThrow(/no prices/i);
  });

  test("parseBetGroupsResponse + executionResultFromBetGroups (captured ticket)", () => {
    const { groups, errorCode } = parseBetGroupsResponse(betTicketWire);
    expect(errorCode).toBe(0);
    expect(groups.length).toBe(1);
    expect(groups[0]!.ticketNumber).toBe("1036636660");
    expect(groups[0]!.risk).toBe(68);
    expect(groups[0]!.toWin).toBe(60.71);
    expect(groups[0]!.finalOdds).toBeCloseTo(1.8928, 3);
    const leg = groups[0]!.legs[0]!;
    expect(leg.eventId).toBe("196878741");
    expect(leg.marketId).toBe("3");
    expect(leg.key).toBe("2");
    expect(leg.periodId).toBe("m");
    expect(leg.team1).toBe("Kyryl Darin");

    const exec = executionResultFromBetGroups(betTicketWire);
    expect(exec.success).toBe(true);
    expect(exec.ticketNumber).toBe("1036636660");
    expect(exec.transactionId).toBe("1036636660");
    expect(exec.betId).toBe(335749942);
    expect(exec.risk).toBe(68);

    const intent = orderIntentFromComponentBet(leg, 68);
    expect(intent.eventId).toBe("196878741");
    expect(intent.marketId).toBe("3");
    expect(intent.stake).toBe(68);
  });

  test("interpretBetTicketResponse on adapter", () => {
    const adapter = new FantasyUltraAdapter({
      credentials: {
        customerID: "C",
        agentID: "A",
        password: "p",
        bearerToken: "t",
        domain: DOMAIN,
        skin: 2,
        currency: "USD",
      },
      warmSession: false,
    });
    const exec = adapter.interpretBetTicketResponse(betTicketWire);
    expect(exec.success).toBe(true);
    expect(exec.finalOdds).toBeCloseTo(1.89, 2);
  });

  test("getPartnerAdapter / getFantasySessionAdapter route fantasy402", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("getUltraLiveURL")) {
        return new Response(JSON.stringify(ultraWire), { status: 200 });
      }
      if (url.includes("plive")) {
        return new Response("ok", { status: 200 });
      }
      if (url.includes("Get_SportsLeagues")) {
        return new Response(JSON.stringify(leaguesWire), { status: 200 });
      }
      return new Response(JSON.stringify(streamWire), { status: 200 });
    }) as typeof fetch;

    const base = getPartnerAdapter(profile, { fetchImpl, warmSession: false });
    expect(base.partnerId).toBe("fantasy402");
    await base.login();

    const session = getFantasySessionAdapter(profile, {
      fetchImpl,
      warmSession: false,
    });
    const sports = await session.fetchSports();
    expect(sports.length).toBe(2);
  });
});
