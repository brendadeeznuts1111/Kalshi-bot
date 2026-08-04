import { describe, expect, test } from "bun:test";
import {
  parseSportsSourceMetadataCli,
  syncSportsSourceMetadata,
} from "../../scripts/sync-sports-source-metadata.ts";
import { openEventStore } from "../../src/institutions/event-store/open-db.ts";
import { beginSourceMetadataRun } from "../../src/institutions/event-store/source-metadata-run.ts";
import {
  asSourceMetadataId,
  asSourceMetadataRunId,
  asSourceKey,
  SELECTOR,
  SOURCE,
  unbrand,
} from "../../src/institutions/market-registry/brands.ts";
import { SPORTS_SOURCE_REGISTRY } from "../../src/institutions/market-registry/registry.ts";
import type {
  AdapterDefinition,
  NormalizedSourceMetadata,
  RuntimeMetadataSourceAdapter,
} from "../../src/institutions/market-registry/types.ts";

function adapter(
  definition: AdapterDefinition,
  observedAtMs: number,
  records: readonly NormalizedSourceMetadata[],
): RuntimeMetadataSourceAdapter {
  return {
    definition,
    async acquirePage(request) {
      return {
        request,
        observedAtMs,
        records,
        completeness: "complete",
        exhausted: true,
      };
    },
    health: () => ({ state: "healthy", consecutiveFailures: 0 }),
  };
}

describe("sports/source metadata sync owner", () => {
  test("migrates, acquires both venues, and emits the project catalog", async () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const kalshi = SPORTS_SOURCE_REGISTRY.adapters.find((row) => row.source === SOURCE.kalshi)!;
    const polymarket = SPORTS_SOURCE_REGISTRY.adapters.find(
      (row) => row.source === SOURCE.polymarket,
    )!;
    let nowMs = 100;
    const result = await syncSportsSourceMetadata({
      db,
      adapters: [
        adapter(kalshi, 350, [
          {
            source: SOURCE.kalshi,
            metadataId: asSourceMetadataId("KXATPSETWINNER"),
            metadataKind: SELECTOR.kalshiSeriesMetadata,
            label: "ATP set winner",
            attributes: { category: "Sports" },
            facets: { tags: ["Tennis"] },
          },
        ]),
        adapter(polymarket, 450, [
          {
            source: SOURCE.polymarket,
            metadataId: asSourceMetadataId("atp"),
            metadataKind: SELECTOR.polymarketSportsMetadata,
            label: "ATP",
            attributes: {},
            facets: { tag_ids: ["864"] },
          },
        ]),
      ],
      now: () => (nowMs += 100),
    });

    expect(result.completed).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.abandoned).toBe(0);
    expect(result.runs.map((run) => [unbrand(run.source), run.state])).toEqual([
      ["kalshi", "complete"],
      ["polymarket", "complete"],
    ]);
    expect(result.catalog.store).toEqual({ state: "ready" });
    expect(result.catalog.discovery?.cells).toHaveLength(4);
    expect(
      db.query("SELECT COUNT(*) AS count FROM source_metadata_entities WHERE active = 1").get(),
    ).toEqual({ count: 2 });
  });

  test("parses repeatable and comma-separated registry filters", () => {
    const options = parseSportsSourceMetadataCli([
      "--source=kalshi,polymarket",
      "--source=kalshi",
      "--sport=tennis,table_tennis",
      "--max-pages=2",
      "--json",
    ]);
    expect(options.sources?.map(unbrand)).toEqual(["kalshi", "polymarket"]);
    expect(options.sports?.map(unbrand)).toEqual(["tennis", "table_tennis"]);
    expect(options.maxPagesPerSource).toBe(2);
    expect(options.json).toBe(true);
    expect(options.help).toBe(false);
    expect(parseSportsSourceMetadataCli(["--help"]).help).toBe(true);
    expect(() => parseSportsSourceMetadataCli(["--max-pages=0"])).toThrow(
      "--max-pages must be a positive integer",
    );
  });

  test("abandons a crashed authority run after the freshness window", async () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const kalshi = SPORTS_SOURCE_REGISTRY.adapters.find((row) => row.source === SOURCE.kalshi)!;
    const crashedRun = asSourceMetadataRunId("crashed-kalshi-metadata-run");
    beginSourceMetadataRun(db, {
      runId: crashedRun,
      source: SOURCE.kalshi,
      adapter: kalshi.id,
      selector: kalshi.metadataDiscovery!,
      startedAtMs: 0,
    });
    let nowMs = 5 * 60_000;
    const result = await syncSportsSourceMetadata({
      db,
      adapters: [
        adapter(kalshi, nowMs + 10, [
          {
            source: SOURCE.kalshi,
            metadataId: asSourceMetadataId("KXATPSETWINNER"),
            metadataKind: SELECTOR.kalshiSeriesMetadata,
            label: "ATP set winner",
            attributes: { category: "Sports" },
            facets: { tags: ["Tennis"] },
          },
        ]),
      ],
      sources: [SOURCE.kalshi],
      now: () => (nowMs += 1),
    });

    expect(result.abandoned).toBe(1);
    expect(result.completed).toBe(1);
    expect(
      db
        .query("SELECT state FROM source_metadata_runs WHERE metadata_run_id = $runId")
        .get({ $runId: unbrand(crashedRun) }),
    ).toEqual({ state: "abandoned" });
  });

  test("validates targeting before recovery and never abandons another authority", async () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const kalshi = SPORTS_SOURCE_REGISTRY.adapters.find((row) => row.source === SOURCE.kalshi)!;
    const polymarket = SPORTS_SOURCE_REGISTRY.adapters.find(
      (row) => row.source === SOURCE.polymarket,
    )!;
    const crashedRun = asSourceMetadataRunId("unrelated-kalshi-metadata-run");
    beginSourceMetadataRun(db, {
      runId: crashedRun,
      source: SOURCE.kalshi,
      adapter: kalshi.id,
      selector: kalshi.metadataDiscovery!,
      startedAtMs: 0,
    });
    let nowMs = 5 * 60_000;
    const result = await syncSportsSourceMetadata({
      db,
      adapters: [
        adapter(polymarket, nowMs + 10, [
          {
            source: SOURCE.polymarket,
            metadataId: asSourceMetadataId("atp"),
            metadataKind: SELECTOR.polymarketSportsMetadata,
            label: "ATP",
            attributes: {},
            facets: { tag_ids: ["864"] },
          },
        ]),
      ],
      sources: [SOURCE.polymarket],
      now: () => (nowMs += 1),
    });
    expect(result.abandoned).toBe(0);
    expect(
      db
        .query("SELECT state FROM source_metadata_runs WHERE metadata_run_id = $runId")
        .get({ $runId: unbrand(crashedRun) }),
    ).toEqual({ state: "running" });

    await expect(
      syncSportsSourceMetadata({
        db,
        adapters: [adapter(kalshi, nowMs + 20, [])],
        sources: [asSourceKey("typo")],
        now: () => (nowMs += 1),
      }),
    ).rejects.toThrow("unknown metadata source filter: typo");
    expect(
      db
        .query("SELECT state FROM source_metadata_runs WHERE metadata_run_id = $runId")
        .get({ $runId: unbrand(crashedRun) }),
    ).toEqual({ state: "running" });
  });

  test("does not recover a long run with a recent checkpoint heartbeat", async () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const kalshi = SPORTS_SOURCE_REGISTRY.adapters.find((row) => row.source === SOURCE.kalshi)!;
    const liveRun = asSourceMetadataRunId("live-cursor-metadata-run");
    beginSourceMetadataRun(db, {
      runId: liveRun,
      source: SOURCE.kalshi,
      adapter: kalshi.id,
      selector: kalshi.metadataDiscovery!,
      startedAtMs: 0,
    });
    const nowMs = 5 * 60_000 + 1;
    db.query(
      `UPDATE source_metadata_runs SET checkpoint_at_ms = $checkpointAtMs
       WHERE source_key = 'kalshi' AND metadata_run_id = $runId`,
    ).run({ $checkpointAtMs: nowMs - 1, $runId: unbrand(liveRun) });

    const result = await syncSportsSourceMetadata({
      db,
      adapters: [adapter(kalshi, nowMs + 10, [])],
      sources: [SOURCE.kalshi],
      now: () => nowMs,
    });
    expect(result.abandoned).toBe(0);
    expect(result.failed).toBe(1);
    expect(
      db
        .query("SELECT state FROM source_metadata_runs WHERE metadata_run_id = $runId")
        .get({ $runId: unbrand(liveRun) }),
    ).toEqual({ state: "running" });
  });
});
