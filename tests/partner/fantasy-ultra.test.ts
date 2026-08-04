// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  CookieJar,
  FantasyUltraAdapter,
  getFantasySessionAdapter,
  getPartnerAdapter,
  originFromLiveUrl,
  parseRenewTokenResponse,
  parseSportsLeagues,
  parseStreamList,
  parseUltraLiveUrlResponse,
  type PartnerAccountProfile,
} from "../../src/partner/index.ts";

const ultraWire = {
  URL: {
    DESKTOP:
      "https://plive.sportswidgets.pro/live/?customerId=BB55113&tstamp=2026-08-04T12:00:00.000Z&lang=en&skin=ezlive&hash=abc",
    MOBILE:
      "https://plive.sportswidgets.pro/live/?customerId=BB55113&tstamp=2026-08-04T12:00:00.000Z&lang=en&skin=ezlive&hash=abc&m=1",
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
  url: "https://fantasy402.com",
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
    expect(urls.desktop).toContain("plive.sportswidgets.pro");
    expect(urls.mobile).toContain("plive.sportswidgets.pro");
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
    expect(originFromLiveUrl(ultraWire.URL.DESKTOP)).toBe(
      "https://plive.sportswidgets.pro",
    );
  });

  test("CookieJar absorbs Set-Cookie", () => {
    const jar = new CookieJar();
    jar.absorb(["a=1; Path=/", "b=2; HttpOnly"]);
    expect(jar.headerValue()).toBe("a=1; b=2");
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
      if (url.includes("plive.sportswidgets.pro")) {
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
        domain: "https://fantasy402.com",
        skin: 2,
        currency: "USD",
      },
      fetchImpl,
      warmSession: true,
    });

    const urls = await adapter.login();
    expect(urls.desktop).toContain("plive.sportswidgets.pro");
    expect(adapter.isWarmed()).toBe(true);
    expect(adapter.cookieCount()).toBeGreaterThanOrEqual(1);

    const sports = await adapter.fetchSports();
    expect(sports.some((s) => s.sportType === "TENNIS")).toBe(true);

    const events = await adapter.fetchEvents({ sport: "tennis" });
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
      eventId: events[0]!.eventId,
      side: "home",
      stake: 5,
      dryRun: true,
    });
    expect(dry.success).toBe(false);
    expect(dry.dryRun).toBe(true);
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
