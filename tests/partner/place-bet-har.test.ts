// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { requireDefaultUrlForUltraMapper } from "../../src/domain/index.ts";
import {
  extractBetGroupsWiresFromHar,
  extractPlaceBetMapFromHar,
  looksLikeBetGroupsWire,
} from "../../src/partner/fantasy-ultra/place-bet-har.ts";
import {
  buildPlaceBetBody,
  encodePlaceBetBody,
  resolvePlaceBetUrl,
} from "../../src/partner/fantasy-ultra/place-bet-body.ts";
import { FantasyUltraAdapter } from "../../src/partner/fantasy-ultra/adapter.ts";
import { executionResultFromBetGroups } from "../../src/partner/fantasy-ultra/parse.ts";

/** Adapter/config domain — SKINS-derived, not a source lock. */
const DOMAIN = requireDefaultUrlForUltraMapper();

const FIXTURE = join(
  import.meta.dir,
  "../../research/tickets/sample-placebet.har.json",
);

describe("place-bet HAR → map → placeOrder", () => {
  test("extracts map from fixture HAR without inventing URL", async () => {
    const har = JSON.parse(await Bun.file(FIXTURE).text()) as unknown;
    const { map, candidates } = extractPlaceBetMapFromHar(har, {
      harPath: FIXTURE,
    });
    expect(candidates.length).toBe(1);
    expect(map).not.toBeNull();
    expect(map!.url).toBe(
      "https://fantasy402.com/cloud/api/Bet/PlaceBet",
    );
    expect(map!.method).toBe("POST");
    expect(map!.encoding).toBe("json");
    expect(map!.requestKeys).toContain("eventId");
    expect(map!.requestKeys).toContain("risk");
    expect(map!.responseOk).toBe(true);
    expect(map!.sampleTicketNumbers).toContain("1036636660");
    // secrets redacted in sample
    const sample = JSON.stringify(map!.requestBodySample);
    expect(sample).not.toContain("supersecret.jwt");
  });

  test("extractBetGroupsWiresFromHar for offline ingest", async () => {
    const har = JSON.parse(await Bun.file(FIXTURE).text()) as unknown;
    const wires = extractBetGroupsWiresFromHar(har);
    expect(wires).toHaveLength(1);
    expect(looksLikeBetGroupsWire(wires[0])).toBe(true);
    const result = executionResultFromBetGroups(wires[0]);
    expect(result.success).toBe(true);
    expect(result.ticketNumber).toBe("1036636660");
    expect(result.risk).toBe(68);
  });

  test("buildPlaceBetBody uses HAR keys", async () => {
    const har = JSON.parse(await Bun.file(FIXTURE).text()) as unknown;
    const { map } = extractPlaceBetMapFromHar(har);
    const { body, encoding } = buildPlaceBetBody(
      {
        eventId: "196878741",
        marketId: "3",
        key: "2",
        periodId: "m",
        side: "away",
        stake: 10,
        price: 1.9,
      },
      {
        customerID: "C",
        agentID: "A",
        password: "p",
        bearerToken: "t".repeat(20),
        domain: DOMAIN,
        skin: 2,
        currency: "USD",
      },
      map,
    );
    expect(body.eventId).toBe("196878741");
    expect(body.risk).toBe(10);
    expect(body.customerID).toBe("C");
    expect(encoding).toBe("json");
    expect(encodePlaceBetBody(body, "json")).toContain("eventId");
  });

  test("resolvePlaceBetUrl never invents path", () => {
    expect(resolvePlaceBetUrl({ envMap: {} })).toBeNull();
    expect(
      resolvePlaceBetUrl({
        envMap: {
          FANTASY402_PLACE_BET_URL:
            "https://fantasy402.com/cloud/api/Bet/PlaceBet",
        },
      }),
    ).toBe("https://fantasy402.com/cloud/api/Bet/PlaceBet");
  });

  test("placeOrder dry-run reports mapped URL; live POST with mock fetch", async () => {
    const har = JSON.parse(await Bun.file(FIXTURE).text()) as unknown;
    const { map } = extractPlaceBetMapFromHar(har);
    expect(map).not.toBeNull();

    const adapter = new FantasyUltraAdapter({
      credentials: {
        customerID: "C",
        agentID: "A",
        password: "p",
        bearerToken: "t".repeat(24),
        domain: DOMAIN,
        skin: 2,
        currency: "USD",
      },
      placeBetMap: map,
      warmSession: false,
      fetchImpl: (async () => {
        throw new Error("should not fetch on dry-run");
      }) as unknown as typeof fetch,
    });

    expect(adapter.getPlaceOrderUrl()).toBe(map!.url);

    const dry = await adapter.placeOrder({
      eventId: "196878741",
      marketId: "3",
      key: "2",
      periodId: "m",
      side: "away",
      stake: 68,
      price: 1.89,
    });
    expect(dry.dryRun).toBe(true);
    expect(dry.raw).toMatchObject({
      intent: { url: map!.url },
    });

    let postedUrl = "";
    let postedBody = "";
    const live = new FantasyUltraAdapter({
      credentials: {
        customerID: "C",
        agentID: "A",
        password: "p",
        bearerToken: "t".repeat(24),
        domain: DOMAIN,
        skin: 2,
        currency: "USD",
      },
      placeBetMap: map,
      warmSession: false,
      ultraLiveUrl: `${DOMAIN}/cloud/api/Provider/getUltraLiveURL`,
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const u = String(input);
        if (u.includes("getUltraLiveURL")) {
          return new Response(
            JSON.stringify({
              URL: {
                DESKTOP: "https://plive.example/desktop",
                MOBILE: "https://plive.example/mobile",
              },
            }),
            { status: 200 },
          );
        }
        if (u.includes("PlaceBet")) {
          postedUrl = u;
          postedBody = String(init?.body ?? "");
          return new Response(
            JSON.stringify({
              betGroups: [
                {
                  betGroupId: 1,
                  ticketNumber: 999,
                  finalOdds: 1.9,
                  risk: 68,
                  toWin: 60,
                  currency: "USD",
                  componentBets: [],
                },
              ],
              e: 0,
              d: "",
            }),
            { status: 200 },
          );
        }
        return new Response("not found", { status: 404 });
      }) as unknown as typeof fetch,
    });

    const result = await live.placeOrder({
      eventId: "196878741",
      marketId: "3",
      key: "2",
      periodId: "m",
      side: "away",
      stake: 68,
      price: 1.89,
      dryRun: false,
    });
    expect(result.success).toBe(true);
    expect(result.ticketNumber).toBe("999");
    expect(postedUrl).toContain("PlaceBet");
    expect(postedBody).toContain("196878741");
  });

  test("placeOrder blocked without URL when dryRun false", async () => {
    const adapter = new FantasyUltraAdapter({
      credentials: {
        customerID: "C",
        agentID: "A",
        password: "p",
        bearerToken: "t".repeat(24),
        domain: DOMAIN,
        skin: 2,
        currency: "USD",
      },
      warmSession: false,
    });
    const r = await adapter.placeOrder({
      eventId: "1",
      side: "home",
      stake: 1,
      dryRun: false,
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/no PlaceBet URL|blocked/i);
  });
});
