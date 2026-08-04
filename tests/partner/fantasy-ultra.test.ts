// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  FantasyUltraAdapter,
  parseStreamList,
  parseUltraLiveUrlResponse,
  originFromLiveUrl,
  getPartnerAdapter,
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

  test("originFromLiveUrl", () => {
    expect(originFromLiveUrl(ultraWire.URL.DESKTOP)).toBe(
      "https://plive.sportswidgets.pro",
    );
  });
});

describe("FantasyUltraAdapter", () => {
  test("login + fetchEvents with mock fetch", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("getUltraLiveURL")) {
        return new Response(JSON.stringify(ultraWire), { status: 200 });
      }
      if (url.includes("stream-list")) {
        return new Response(JSON.stringify(streamWire), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const adapter = new FantasyUltraAdapter({
      credentials: {
        customerID: "BB55113",
        agentID: "AGENT",
        password: "x",
        bearerToken: "tok",
        domain: "https://fantasy402.com",
        skin: 2,
        currency: "USD",
      },
      fetchImpl,
    });

    const urls = await adapter.login();
    expect(urls.desktop).toContain("plive.sportswidgets.pro");

    const events = await adapter.fetchEvents({ sport: "tennis" });
    expect(events.length).toBe(2);
    expect(calls.some((c) => c.startsWith("POST "))).toBe(true);
    expect(calls.some((c) => c.includes("stream-list"))).toBe(true);

    const limits = await adapter.fetchLimits(events[0]!.eventId);
    expect(limits.note).toContain("not mapped");

    const dry = await adapter.placeOrder({
      eventId: events[0]!.eventId,
      side: "home",
      stake: 5,
      dryRun: true,
    });
    expect(dry.success).toBe(false);
    expect(dry.dryRun).toBe(true);
  });

  test("getPartnerAdapter routes fantasy402", async () => {
    const profile: PartnerAccountProfile = {
      id: "dummy",
      partner: "fantasy402",
      url: "https://fantasy402.com",
      status: "active",
      meta: {
        customerID: "C",
        agentID: "A",
        password: "p",
        token: "t",
        skin: 2,
        currency: "USD",
      },
    };
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("getUltraLiveURL")) {
        return new Response(JSON.stringify(ultraWire), { status: 200 });
      }
      return new Response(JSON.stringify(streamWire), { status: 200 });
    }) as typeof fetch;
    const adapter = getPartnerAdapter(profile, { fetchImpl });
    expect(adapter.partnerId).toBe("fantasy402");
    await adapter.login();
    const events = await adapter.fetchEvents({ sport: "tennis" });
    expect(events.length).toBe(2);
  });
});
