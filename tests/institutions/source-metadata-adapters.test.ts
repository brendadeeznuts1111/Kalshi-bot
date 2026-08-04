import { describe, expect, test } from "bun:test";
import {
  parseKalshiSeriesWire,
} from "../../src/bot/kalshi-series-api.ts";
import { createKalshiSeriesMetadataAdapter } from "../../src/institutions/market-registry/adapters/kalshi-series-metadata.ts";
import {
  createPolymarketSportsMetadataAdapter,
  parsePolymarketSportsWire,
} from "../../src/institutions/market-registry/adapters/polymarket-sports-metadata.ts";
import { ADAPTER, SPORT, unbrand } from "../../src/institutions/market-registry/brands.ts";
import { classifySourceMetadata } from "../../src/institutions/market-registry/metadata-classification.ts";
import { ADAPTERS } from "../../src/institutions/market-registry/registry.ts";
import { createSportsSourceRuntime } from "../../src/institutions/market-registry/runtime.ts";
import type { MetadataFetchRequest } from "../../src/institutions/market-registry/types.ts";

function metadataRequest(adapterId: typeof ADAPTER.kalshiEvents | typeof ADAPTER.polymarketGamma): MetadataFetchRequest {
  const definition = ADAPTERS.find((row) => row.id === adapterId)!;
  return { selector: definition.metadataDiscovery!, pageIndex: 0 };
}

function kalshiRow(overrides: Record<string, unknown> = {}) {
  return {
    ticker: "KXATPSETWINNER",
    title: "ATP Set Winner",
    category: "Sports",
    frequency: "custom",
    tags: ["Tennis"],
    contract_url: "https://kalshi.com/contracts/example",
    contract_terms_url: "https://kalshi.com/terms/example",
    fee_type: "quadratic",
    fee_multiplier: 1,
    additional_prohibitions: [],
    settlement_sources: [{ name: null, url: "https://example.com/results" }],
    last_updated_ts: "2026-08-04T12:00:00Z",
    ...overrides,
  };
}

function polymarketRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 45,
    sport: "atp",
    image: "https://example.com/atp.png",
    resolution: "https://example.com/results",
    ordering: "home",
    tags: "1, 864,\t100639",
    series: "10365",
    createdAt: "2025-11-07T21:08:59.561861Z",
    ...overrides,
  };
}

describe("source metadata adapters", () => {
  test("fetches and projects one atomic Kalshi Sports catalog", async () => {
    let requestedUrl: URL | undefined;
    const adapter = createKalshiSeriesMetadataAdapter({
      now: () => 1_000,
      fetchImpl: async (input) => {
        requestedUrl = new URL(String(input));
        return Response.json({
          series: [
            kalshiRow(),
            kalshiRow({ ticker: "KXLEAK", category: "Entertainment", tags: ["Football"] }),
            kalshiRow({ ticker: "KXWTASETWINNER", category: "Entertainment" }),
          ],
        });
      },
    });
    const request = metadataRequest(ADAPTER.kalshiEvents);
    const wire = await adapter.fetchPage(request);
    const page = adapter.parsePage(wire, request);
    const records = adapter.project(page);

    expect(requestedUrl?.pathname).toBe("/trade-api/v2/series");
    expect([...requestedUrl!.searchParams.entries()]).toEqual([
      ["category", "Sports"],
      ["include_product_metadata", "true"],
    ]);
    expect(page).toMatchObject({ completeness: "complete", exhausted: true });
    expect(records).toHaveLength(3);
    expect(records[0]).toMatchObject({
      metadataId: "KXATPSETWINNER",
      attributes: { category: "Sports", frequency: "custom" },
      facets: { tags: ["Tennis"] },
    });
    expect(
      classifySourceMetadata(records[0]!).find((row) => unbrand(row.sport) === "tennis"),
    ).toMatchObject({ disposition: "registered", reasonCode: "exact_registry_match" });
    expect(classifySourceMetadata(records[1]!).every((row) => row.disposition === "ignored"))
      .toBe(true);
    expect(
      classifySourceMetadata(records[2]!).find((row) => unbrand(row.sport) === "tennis"),
    ).toMatchObject({ disposition: "quarantined", reasonCode: "registered_metadata_drift" });
  });

  test("parses nullable Kalshi arrays and rejects malformed rows atomically", () => {
    expect(parseKalshiSeriesWire({ series: [kalshiRow({ tags: null, settlement_sources: null })] })[0])
      .toMatchObject({ tags: [], settlementSources: [] });
    expect(parseKalshiSeriesWire({
      series: [kalshiRow({ settlement_sources: [{ url: "https://example.com/results" }] })],
    })[0]?.settlementSources).toEqual([{ name: null, url: "https://example.com/results" }]);
    expect(parseKalshiSeriesWire({
      series: [kalshiRow({
        fee_type: "flat",
        additional_prohibitions: null,
        settlement_sources: [{ name: "Source" }],
      })],
    })[0]).toMatchObject({
      feeType: "flat",
      additionalProhibitions: [],
      settlementSources: [{ name: "Source", url: null }],
    });
    expect(() =>
      parseKalshiSeriesWire({
        series: [kalshiRow(), kalshiRow({ ticker: "KXINVALID", fee_multiplier: -1 })],
      }),
    ).toThrow("non-negative number required");
    expect(() =>
      parseKalshiSeriesWire({ series: [kalshiRow(), kalshiRow()] }),
    ).toThrow("duplicate ticker");
    expect(() => parseKalshiSeriesWire({ series: [] })).toThrow("must not be empty");
  });

  test("rejects pagination on unpaginated Kalshi discovery before fetch", async () => {
    let fetched = false;
    const adapter = createKalshiSeriesMetadataAdapter({
      fetchImpl: async () => {
        fetched = true;
        return Response.json({ series: [] });
      },
    });
    await expect(adapter.fetchPage({
      ...metadataRequest(ADAPTER.kalshiEvents),
      pageIndex: 1,
      cursor: "not-supported",
    })).rejects.toThrow("atomic discovery selector");
    expect(fetched).toBe(false);
  });

  test("fetches, normalizes, and classifies the atomic Polymarket sports catalog", async () => {
    let requestedUrl: URL | undefined;
    let now = 1_000;
    const adapter = createPolymarketSportsMetadataAdapter({
      now: () => now,
      fetchImpl: async (input) => {
        requestedUrl = new URL(String(input));
        return Response.json([polymarketRow()]);
      },
    });
    const request = metadataRequest(ADAPTER.polymarketGamma);
    const page = adapter.parsePage(await adapter.fetchPage(request), request);
    const [record] = adapter.project(page);

    expect(requestedUrl?.pathname).toBe("/sports");
    expect(requestedUrl?.search).toBe("");
    expect(record).toMatchObject({ metadataId: "atp", facets: { tag_ids: ["1", "864", "100639"] } });
    expect(
      classifySourceMetadata(record!).find((row) => unbrand(row.sport) === "tennis"),
    ).toMatchObject({
      disposition: "registered",
      matchedSelectorScope: "polymarket:tag:864",
    });
    expect(adapter.health().state).toBe("healthy");
    now += 1_800_001;
    expect(adapter.health().state).toBe("stale");
  });

  test("rejects malformed or duplicate Polymarket sport metadata atomically", () => {
    expect(parsePolymarketSportsWire([polymarketRow()])[0]).toMatchObject({
      sportCode: "atp",
      tagIds: ["1", "864", "100639"],
      seriesId: "10365",
    });
    expect(() =>
      parsePolymarketSportsWire([polymarketRow({ tags: "1,864,864" })]),
    ).toThrow("duplicate tag id");
    expect(() =>
      parsePolymarketSportsWire([polymarketRow(), polymarketRow({ id: 46 })]),
    ).toThrow("duplicate sport");
    expect(() =>
      parsePolymarketSportsWire([polymarketRow(), polymarketRow({ sport: "wta" })]),
    ).toThrow("duplicate row id");
    expect(() =>
      parsePolymarketSportsWire([polymarketRow({ resolution: "javascript:bad" })]),
    ).toThrow("HTTP(S) URL required");
    expect(() => parsePolymarketSportsWire([])).toThrow("must not be empty");
  });

  test("rejects metadata selector drift and retries after a short circuit reset", async () => {
    let now = 1_000;
    let fetchCount = 0;
    const adapter = createPolymarketSportsMetadataAdapter({
      now: () => now,
      fetchImpl: async () => {
        fetchCount += 1;
        return Response.json(fetchCount <= 3 ? [] : [polymarketRow()]);
      },
    });
    const request = metadataRequest(ADAPTER.polymarketGamma);
    await expect(adapter.fetchPage({
      ...request,
      selector: { ...request.selector, sport: SPORT.tennis },
    })).rejects.toThrow("atomic discovery selector");
    expect(fetchCount).toBe(0);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const wire = await adapter.fetchPage(request);
      expect(() => adapter.parsePage(wire, request)).toThrow("must not be empty");
    }
    expect(adapter.health()).toMatchObject({ state: "circuit_open", consecutiveFailures: 3 });
    await expect(adapter.fetchPage(request)).rejects.toThrow("circuit is open");
    expect(fetchCount).toBe(3);

    now += 60_000;
    const recovered = adapter.parsePage(await adapter.fetchPage(request), request);
    expect(adapter.project(recovered)).toHaveLength(1);
    expect(adapter.health()).toMatchObject({ state: "healthy", consecutiveFailures: 0 });
  });

  test("composes both sources through one project-wide runtime template", () => {
    const runtime = createSportsSourceRuntime();
    expect(runtime.inventoryAdapters.map((adapter) => unbrand(adapter.definition.id))).toEqual([
      "kalshi-events-v1",
      "polymarket-gamma-v1",
    ]);
    expect(runtime.metadataAdapters.map((adapter) => unbrand(adapter.definition.id))).toEqual([
      "kalshi-events-v1",
      "polymarket-gamma-v1",
    ]);
  });
});
