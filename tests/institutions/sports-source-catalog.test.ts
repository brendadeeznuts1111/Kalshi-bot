import { join } from "node:path";
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { openEventStore } from "../../src/institutions/event-store/open-db.ts";
import { buildSportsSourceCatalogPayload } from "../../src/research/sports-source-catalog.ts";

const NOW_MS = Date.parse("2026-08-04T12:00:00.000Z");

describe("sports/source project catalog", () => {
  test("keeps every declared sport/source cell visible without an event store", () => {
    const payload = buildSportsSourceCatalogPayload({
      nowMs: NOW_MS,
      dbPath: join(import.meta.dir, "missing-sports-source-catalog.db"),
    });

    expect(payload.schema).toBe("sports-source-catalog/v1");
    expect(payload.generatedAt).toBe("2026-08-04T12:00:00.000Z");
    expect(payload.store).toEqual({ state: "unavailable", reason: "event_store_missing" });
    expect(payload.discovery).toBeNull();
    expect(
      payload.registry.integrations.map((row) => `${row.sport}:${row.source}`).sort(),
    ).toEqual(
      [
        "tennis:kalshi",
        "tennis:polymarket",
        "table_tennis:kalshi",
        "table_tennis:polymarket",
      ].sort(),
    );
  });

  test("attaches one coherent discovery snapshot when the store is ready", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const payload = buildSportsSourceCatalogPayload({ db, nowMs: NOW_MS });

    expect(payload.store).toEqual({ state: "ready" });
    expect(payload.discovery?.generatedAt).toBe(payload.generatedAt);
    expect(payload.discovery?.registryFingerprint).toBe(payload.registryFingerprint);
    expect(payload.discovery?.cells.map((row) => row.integration).sort()).toEqual(
      payload.registry.integrations.map((row) => row.integration).sort(),
    );
  });

  test("fails closed when a readable database lacks the registry schema", () => {
    const db = new Database(":memory:");
    const errors: Error[] = [];
    const payload = buildSportsSourceCatalogPayload({
      db,
      nowMs: NOW_MS,
      onError: (error) => errors.push(error),
    });

    expect(payload.store).toEqual({ state: "degraded", reason: "event_store_read_failed" });
    expect(payload.discovery).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
  });
});
