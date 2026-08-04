import { describe, expect, test } from "bun:test";
import { openEventStore } from "../../src/institutions/event-store/open-db.ts";
import {
  beginSourceInventoryRun,
  commitSourceInventoryPage,
  failSourceInventoryRun,
  resumeSourceInventoryRun,
} from "../../src/institutions/event-store/source-inventory-run.ts";
import {
  listSourceEvents,
  upsertSourceObservation,
} from "../../src/institutions/event-store/source-market-store.ts";
import {
  asOutcomeKey,
  asSourceEventId,
  asSourceInventoryRunId,
  asSourceMarketId,
  asSourceParticipantId,
  asSourceScopeId,
  SOURCE,
  SPORT,
  type SourceEventId,
  type SourceInventoryRunId,
  type SourceMarketId,
} from "../../src/institutions/market-registry/brands.ts";
import {
  registrationFor,
  SPORTS_SOURCE_REGISTRY,
} from "../../src/institutions/market-registry/registry.ts";
import type {
  CompleteSourceObservation,
  NormalizedSourceObservation,
  SourcePage,
  SourceSelector,
  SportsSourceRegistry,
} from "../../src/institutions/market-registry/types.ts";

const registration = registrationFor(SOURCE.polymarket, SPORT.tableTennis, SPORTS_SOURCE_REGISTRY)!;
const selector = registration.competitions[0]!.selector;

function sourceObservation(input: {
  eventId: SourceEventId;
  marketId: SourceMarketId;
  observedAtMs: number;
  selector?: SourceSelector;
  probability?: number;
}): CompleteSourceObservation {
  return {
    source: SOURCE.polymarket,
    sport: SPORT.tableTennis,
    eventId: input.eventId,
    title: String(input.eventId),
    status: "open",
    closesAtMs: null,
    result: null,
    startsAtMs: null,
    eventType: "match",
    participantFormat: "singles",
    snapshotCompleteness: "complete",
    participants: [
      { id: asSourceParticipantId(`${input.eventId}-a`), ordinal: 0, label: "A" },
      { id: asSourceParticipantId(`${input.eventId}-b`), ordinal: 1, label: "B" },
    ],
    markets: [
      {
        id: input.marketId,
        sourceMarketType: null,
        marketKind: null,
        title: `${input.eventId} winner`,
        status: "open",
        closesAtMs: null,
        result: null,
        subjectParticipantId: null,
        volume: null,
        volume24h: null,
        liquidity: null,
        clobLiquidity: null,
        openInterest: null,
        outcomes: [
          {
            outcome: asOutcomeKey("yes"),
            ordinal: 0,
            label: "Yes",
            participantId: null,
            probability: input.probability ?? 0.5,
            bid: null,
            ask: null,
            last: null,
            lastTradeAtMs: null,
          },
        ],
      },
    ],
    provenance: {
      adapter: registration.adapter,
      selector: input.selector ?? selector,
      observedAtMs: input.observedAtMs,
      sourceUpdatedAtMs: input.observedAtMs,
    },
  };
}

function begin(
  db: ReturnType<typeof openEventStore>,
  runId: SourceInventoryRunId,
  runSelector = selector,
) {
  return beginSourceInventoryRun(db, {
    runId,
    source: SOURCE.polymarket,
    sport: SPORT.tableTennis,
    adapter: registration.adapter,
    selector: runSelector,
    startedAtMs: 200,
  });
}

function inventoryPage(input: {
  runId: SourceInventoryRunId;
  pageIndex: number;
  observedAtMs: number;
  records: readonly NormalizedSourceObservation[];
  selector?: SourceSelector;
  requestCursor?: string;
  nextCursor?: string;
}): SourcePage<NormalizedSourceObservation> {
  return {
    request: {
      selector: input.selector ?? selector,
      inventoryRunId: input.runId,
      pageIndex: input.pageIndex,
      ...(input.requestCursor === undefined ? {} : { cursor: input.requestCursor }),
      limit: 100,
    },
    observedAtMs: input.observedAtMs,
    records: input.records,
    ...(input.nextCursor === undefined ? {} : { nextCursor: input.nextCursor }),
    exhausted: input.nextCursor === undefined,
  };
}

describe("source inventory runs", () => {
  test("retires unseen selector memberships only on the exhausted page", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    for (const id of ["event-a", "event-b", "event-c"]) {
      upsertSourceObservation(
        db,
        sourceObservation({
          eventId: asSourceEventId(id),
          marketId: asSourceMarketId(`market-${id}`),
          observedAtMs: 100,
        }),
      );
    }
    begin(db, asSourceInventoryRunId("run-1"));
    expect(
      commitSourceInventoryPage(db, {
        source: SOURCE.polymarket,
        page: inventoryPage({
          runId: asSourceInventoryRunId("run-1"),
          pageIndex: 0,
          nextCursor: "cursor-1",
          observedAtMs: 200,
          records: [
            sourceObservation({
              eventId: asSourceEventId("event-a"),
              marketId: asSourceMarketId("market-event-a"),
              observedAtMs: 200,
            }),
          ],
        }),
      }),
    ).toMatchObject({ state: "running", nextCursor: "cursor-1", pageCount: 1 });
    expect(
      db.query("SELECT COUNT(*) AS count FROM source_event_selectors WHERE active = 1").get(),
    ).toEqual({ count: 3 });

    expect(
      commitSourceInventoryPage(db, {
        source: SOURCE.polymarket,
        page: inventoryPage({
          runId: asSourceInventoryRunId("run-1"),
          pageIndex: 1,
          requestCursor: "cursor-1",
          observedAtMs: 300,
          records: [
            sourceObservation({
              eventId: asSourceEventId("event-b"),
              marketId: asSourceMarketId("market-event-b"),
              observedAtMs: 300,
            }),
          ],
        }),
      }),
    ).toMatchObject({ state: "complete", pageCount: 2, observedEventCount: 2 });
    expect(
      db
        .query("SELECT source_event_id AS id, active FROM source_event_selectors ORDER BY id")
        .all(),
    ).toEqual([
      { id: "event-a", active: 1 },
      { id: "event-b", active: 1 },
      { id: "event-c", active: 0 },
    ]);
    expect(
      listSourceEvents(db, { source: SOURCE.polymarket, sport: SPORT.tableTennis }).map(String),
    ).toHaveLength(2);
    expect(
      listSourceEvents(db, {
        source: SOURCE.polymarket,
        sport: SPORT.tableTennis,
        includeRetired: true,
      }),
    ).toHaveLength(3);
  });

  test("failure fences late pages without retiring prior inventory", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    for (const id of ["event-a", "event-b"]) {
      upsertSourceObservation(
        db,
        sourceObservation({
          eventId: asSourceEventId(id),
          marketId: asSourceMarketId(`market-${id}`),
          observedAtMs: 100,
        }),
      );
    }
    begin(db, asSourceInventoryRunId("run-failed"));
    commitSourceInventoryPage(db, {
      source: SOURCE.polymarket,
      page: inventoryPage({
        runId: asSourceInventoryRunId("run-failed"),
        pageIndex: 0,
        nextCursor: "cursor-1",
        observedAtMs: 200,
        records: [],
      }),
    });
    failSourceInventoryRun(db, {
      source: SOURCE.polymarket,
      runId: asSourceInventoryRunId("run-failed"),
      failedAtMs: 250,
      detail: "429",
    });
    expect(() =>
      commitSourceInventoryPage(db, {
        source: SOURCE.polymarket,
        page: inventoryPage({
          runId: asSourceInventoryRunId("run-failed"),
          pageIndex: 1,
          requestCursor: "cursor-1",
          observedAtMs: 300,
          records: [],
        }),
      }),
    ).toThrow("source inventory run is failed");
    expect(
      db.query("SELECT COUNT(*) AS count FROM source_event_selectors WHERE active = 1").get(),
    ).toEqual({ count: 2 });
  });

  test("cursor CAS and page writes are atomic", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    begin(db, asSourceInventoryRunId("run-atomic"));
    expect(() =>
      commitSourceInventoryPage(db, {
        source: SOURCE.polymarket,
        page: inventoryPage({
          runId: asSourceInventoryRunId("run-atomic"),
          pageIndex: 0,
          requestCursor: "wrong",
          observedAtMs: 200,
          records: [],
        }),
      }),
    ).toThrow("cursor does not match");
    const invalid = sourceObservation({
      eventId: asSourceEventId("invalid-event"),
      marketId: asSourceMarketId("invalid-market"),
      observedAtMs: 200,
      probability: 2,
    });
    expect(() =>
      commitSourceInventoryPage(db, {
        source: SOURCE.polymarket,
        page: inventoryPage({
          runId: asSourceInventoryRunId("run-atomic"),
          pageIndex: 0,
          observedAtMs: 200,
          records: [invalid],
        }),
      }),
    ).toThrow();
    expect(
      resumeSourceInventoryRun(db, SOURCE.polymarket, asSourceInventoryRunId("run-atomic")),
    ).toMatchObject({ pageCount: 0, observedEventCount: 0, state: "running" });
    expect(db.query("SELECT COUNT(*) AS count FROM source_events").get()).toEqual({ count: 0 });
  });

  test("terminal retries are idempotent and one selector cannot retire another", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const secondSelector: SourceSelector = {
      ...selector,
      scope: asSourceScopeId("polymarket:tag:999"),
      parameters: { tagId: "999", tagSlug: "table-tennis-alt", sport: "table_tennis" },
    };
    const registry: SportsSourceRegistry = {
      ...SPORTS_SOURCE_REGISTRY,
      integrations: SPORTS_SOURCE_REGISTRY.integrations.map((integration) =>
        integration === registration
          ? {
              ...integration,
              competitions: [
                ...integration.competitions,
                { ...integration.competitions[0]!, selector: secondSelector },
              ],
            }
          : integration,
      ),
    };
    const shared = sourceObservation({
      eventId: asSourceEventId("shared-event"),
      marketId: asSourceMarketId("shared-market"),
      observedAtMs: 100,
    });
    upsertSourceObservation(db, shared, registry);
    upsertSourceObservation(
      db,
      {
        ...shared,
        provenance: { ...shared.provenance, selector: secondSelector, observedAtMs: 101 },
      },
      registry,
    );
    beginSourceInventoryRun(
      db,
      {
        runId: asSourceInventoryRunId("run-scope-a"),
        source: SOURCE.polymarket,
        sport: SPORT.tableTennis,
        adapter: registration.adapter,
        selector,
        startedAtMs: 200,
      },
      registry,
    );
    const terminal = {
      source: SOURCE.polymarket,
      page: inventoryPage({
        runId: asSourceInventoryRunId("run-scope-a"),
        pageIndex: 0,
        observedAtMs: 200,
        records: [],
      }),
    } as const;
    expect(commitSourceInventoryPage(db, terminal, registry)).toMatchObject({
      state: "complete",
      pageCount: 1,
    });
    expect(commitSourceInventoryPage(db, terminal, registry)).toMatchObject({
      state: "complete",
      pageCount: 1,
    });
    expect(
      db
        .query("SELECT selector_scope AS scope, active FROM source_event_selectors ORDER BY scope")
        .all(),
    ).toEqual([
      { scope: "polymarket:tag:103767", active: 0 },
      { scope: "polymarket:tag:999", active: 1 },
    ]);
    expect(
      listSourceEvents(db, { source: SOURCE.polymarket, sport: SPORT.tableTennis }),
    ).toHaveLength(1);
  });

  test("allows only one running scan per selector", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    begin(db, asSourceInventoryRunId("run-one"));
    expect(() => begin(db, asSourceInventoryRunId("run-two"))).toThrow();
    expect(
      resumeSourceInventoryRun(db, SOURCE.polymarket, asSourceInventoryRunId("run-one")),
    ).toMatchObject({ state: "running", pageCount: 0 });
  });

  test("retries intermediate pages and fences cursor cycles and clock regression", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const runId = asSourceInventoryRunId("run-resume");
    begin(db, runId);
    const first = {
      source: SOURCE.polymarket,
      page: inventoryPage({
        runId,
        pageIndex: 0,
        observedAtMs: 250,
        nextCursor: "cursor-a",
        records: [],
      }),
    } as const;
    expect(commitSourceInventoryPage(db, first)).toMatchObject({ pageCount: 1 });
    expect(commitSourceInventoryPage(db, first)).toMatchObject({ pageCount: 1 });
    commitSourceInventoryPage(db, {
      source: SOURCE.polymarket,
      page: inventoryPage({
        runId,
        pageIndex: 1,
        requestCursor: "cursor-a",
        nextCursor: "cursor-b",
        observedAtMs: 300,
        records: [],
      }),
    });
    expect(() =>
      commitSourceInventoryPage(db, {
        source: SOURCE.polymarket,
        page: inventoryPage({
          runId,
          pageIndex: 2,
          requestCursor: "cursor-b",
          nextCursor: "cursor-a",
          observedAtMs: 350,
          records: [],
        }),
      }),
    ).toThrow();
    expect(() =>
      commitSourceInventoryPage(db, {
        source: SOURCE.polymarket,
        page: inventoryPage({
          runId,
          pageIndex: 2,
          requestCursor: "cursor-b",
          observedAtMs: 275,
          records: [],
        }),
      }),
    ).toThrow("precedes the prior checkpoint");
    expect(() =>
      failSourceInventoryRun(db, {
        source: SOURCE.polymarket,
        runId,
        failedAtMs: 275,
        detail: "late stale failure",
      }),
    ).toThrow("running source inventory run not found");
    expect(resumeSourceInventoryRun(db, SOURCE.polymarket, runId)).toMatchObject({
      state: "running",
      pageCount: 2,
      nextCursor: "cursor-b",
    });
  });

  test("revalidates operational registry policy before begin and terminal retirement", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const disabledRegistry: SportsSourceRegistry = {
      ...SPORTS_SOURCE_REGISTRY,
      integrations: SPORTS_SOURCE_REGISTRY.integrations.map((integration) =>
        integration === registration
          ? {
              ...integration,
              state: "disabled",
              operationalCapabilities: [],
              reason: "test",
            }
          : integration,
      ),
    };
    expect(() =>
      beginSourceInventoryRun(
        db,
        {
          runId: asSourceInventoryRunId("run-disabled"),
          source: SOURCE.polymarket,
          sport: SPORT.tableTennis,
          adapter: registration.adapter,
          selector,
          startedAtMs: 200,
        },
        disabledRegistry,
      ),
    ).toThrow("not operational for inventory");

    const prior = sourceObservation({
      eventId: asSourceEventId("registry-drift-event"),
      marketId: asSourceMarketId("registry-drift-market"),
      observedAtMs: 100,
    });
    upsertSourceObservation(db, prior);
    const runId = asSourceInventoryRunId("run-registry-drift");
    begin(db, runId);
    const driftedRegistry: SportsSourceRegistry = {
      ...SPORTS_SOURCE_REGISTRY,
      integrations: SPORTS_SOURCE_REGISTRY.integrations.map((integration) =>
        integration === registration ? { ...integration, competitions: [] } : integration,
      ),
    };
    expect(() =>
      commitSourceInventoryPage(
        db,
        {
          source: SOURCE.polymarket,
          page: inventoryPage({ runId, pageIndex: 0, observedAtMs: 200, records: [] }),
        },
        driftedRegistry,
      ),
    ).toThrow("not an exact registered binding");
    expect(
      db.query("SELECT active FROM source_event_selectors WHERE source_event_id = $eventId").get({
        $eventId: "registry-drift-event",
      }),
    ).toEqual({ active: 1 });
    expect(resumeSourceInventoryRun(db, SOURCE.polymarket, runId)).toMatchObject({
      state: "running",
      pageCount: 0,
    });
  });

  test("does not retire membership observed at or after a terminal page timestamp", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const current = sourceObservation({
      eventId: asSourceEventId("late-observation"),
      marketId: asSourceMarketId("late-market"),
      observedAtMs: 100,
    });
    upsertSourceObservation(db, current);
    const runId = asSourceInventoryRunId("run-late-observation");
    begin(db, runId);
    const terminal = {
      source: SOURCE.polymarket,
      page: inventoryPage({ runId, pageIndex: 0, observedAtMs: 300, records: [] }),
    } as const;
    upsertSourceObservation(db, {
      ...current,
      provenance: {
        ...current.provenance,
        observedAtMs: 300,
        sourceUpdatedAtMs: 300,
      },
    });
    commitSourceInventoryPage(db, terminal);
    expect(
      db.query("SELECT active, retired_at_ms AS retiredAtMs FROM source_event_selectors").get(),
    ).toEqual({ active: 1, retiredAtMs: null });
  });

  test("validates provenance before accepting an idempotent retry", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const runId = asSourceInventoryRunId("run-retry-provenance");
    begin(db, runId);
    const record = sourceObservation({
      eventId: asSourceEventId("retry-event"),
      marketId: asSourceMarketId("retry-market"),
      observedAtMs: 200,
    });
    const terminal = {
      source: SOURCE.polymarket,
      page: inventoryPage({ runId, pageIndex: 0, observedAtMs: 200, records: [record] }),
    } as const;
    commitSourceInventoryPage(db, terminal);
    expect(() =>
      commitSourceInventoryPage(db, {
        ...terminal,
        page: {
          ...terminal.page,
          records: [
            {
              ...record,
              provenance: {
                ...record.provenance,
                inventoryRunId: asSourceInventoryRunId("different-run"),
              },
            },
          ],
        },
      }),
    ).toThrow("does not match inventory run page");
  });
});
