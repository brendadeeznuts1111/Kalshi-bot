import { describe, expect, test } from "bun:test";
import { openEventStore } from "../../src/institutions/event-store/open-db.ts";
import {
  listSourceEvents,
  upsertSourceObservation,
} from "../../src/institutions/event-store/source-market-store.ts";
import {
  asAdapterId,
  asOutcomeKey,
  asSourceEventId,
  asSourceMarketId,
  asSourceMarketType,
  asSourceParticipantId,
  asSourceScopeId,
  MARKET,
  SELECTOR,
  SOURCE,
  SPORT,
} from "../../src/institutions/market-registry/brands.ts";
import type { NormalizedSourceObservation } from "../../src/institutions/market-registry/types.ts";

function observation(input: {
  eventId?: string;
  source?: typeof SOURCE.polymarket | typeof SOURCE.kalshi;
  sport?: typeof SPORT.tableTennis | typeof SPORT.tennis;
  title?: string;
  observedAtMs?: number;
  sourceUpdatedAtMs?: number;
  selectorScope?: string;
  marketId?: string;
  missingSourceMarketType?: boolean;
  volume?: number | null;
  volume24h?: number | null;
  liquidity?: number | null;
  clobLiquidity?: number | null;
  openInterest?: number | null;
  probability?: number | null;
  bid?: number | null;
  ask?: number | null;
} = {}): NormalizedSourceObservation {
  const source = input.source ?? SOURCE.polymarket;
  const eventId = input.eventId ?? "event-001";
  const polymarketTagId = input.selectorScope?.split(":").at(-1) ?? "103767";
  const kalshiSeries = input.selectorScope?.split(":").at(-1) ?? "KXTABLETENNISMATCH";
  return {
    source,
    sport: input.sport ?? SPORT.tableTennis,
    eventId: asSourceEventId(eventId),
    title: input.title ?? "Alpha vs Beta",
    startsAtMs: 1_785_801_600_000,
    eventType: "match",
    participantFormat: "singles",
    snapshotCompleteness: "complete",
    participants: [
      { id: asSourceParticipantId("alpha"), ordinal: 0, label: "Alpha" },
      { id: asSourceParticipantId("beta"), ordinal: 1, label: "Beta" },
    ],
    markets: [
      {
        id: asSourceMarketId(input.marketId ?? "market-001"),
        sourceMarketType: input.missingSourceMarketType
          ? undefined
          : asSourceMarketType("moneyline"),
        marketKind: input.missingSourceMarketType ? undefined : MARKET.matchWinner,
        title: "Alpha vs Beta winner",
        volume: input.volume === undefined ? null : input.volume,
        volume24h: input.volume24h === undefined ? 0 : input.volume24h,
        liquidity: input.liquidity === undefined ? null : input.liquidity,
        clobLiquidity: input.clobLiquidity === undefined ? null : input.clobLiquidity,
        openInterest: input.openInterest === undefined ? null : input.openInterest,
        outcomes: [
          {
            outcome: asOutcomeKey("no"),
            ordinal: 0,
            label: "No",
            probability: 0.42,
            bid: null,
            ask: null,
            last: null,
          },
          {
            outcome: asOutcomeKey("yes"),
            ordinal: 1,
            label: "Yes",
            probability: input.probability === undefined ? 0.58 : input.probability,
            bid: input.bid === undefined ? 0.57 : input.bid,
            ask: input.ask === undefined ? 0.59 : input.ask,
            last: 0.58,
            lastTradeAtMs: 1_785_801_500_000,
          },
        ],
      },
    ],
    provenance: {
      adapter:
        source === SOURCE.polymarket
          ? asAdapterId("polymarket-gamma-v1")
          : asAdapterId("kalshi-markets-v1"),
      selector: {
        kind:
          source === SOURCE.polymarket
            ? SELECTOR.polymarketTag
            : SELECTOR.kalshiSeries,
        scope: asSourceScopeId(input.selectorScope ?? (
          source === SOURCE.polymarket
            ? "polymarket:tag:103767"
            : "kalshi:series:KXTABLETENNISMATCH"
        )),
        sport: input.sport ?? SPORT.tableTennis,
        parameters:
          source === SOURCE.polymarket
            ? { tagId: polymarketTagId, tagSlug: "table-tennis", sport: "table_tennis" }
            : {
                series: kalshiSeries,
                category: "Sports",
                tag: input.sport === SPORT.tennis ? "Tennis" : "Table Tennis",
                sport: input.sport === SPORT.tennis ? "tennis" : "table_tennis",
              },
      },
      observedAtMs: input.observedAtMs ?? 100,
      sourceUpdatedAtMs: input.sourceUpdatedAtMs ?? 90,
    },
  };
}

describe("provider-scoped source market store", () => {
  test("persists participants and literal outcomes without index assumptions", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    expect(upsertSourceObservation(db, observation())).toBe("inserted");
    expect(
      db.query(
        `SELECT outcome_key AS outcome, ordinal, probability, bid, ask
         FROM source_market_outcomes ORDER BY ordinal`,
      ).all(),
    ).toEqual([
      { outcome: "no", ordinal: 0, probability: 0.42, bid: null, ask: null },
      { outcome: "yes", ordinal: 1, probability: 0.58, bid: 0.57, ask: 0.59 },
    ]);
    expect(
      db.query(
        `SELECT source_market_type AS sourceMarketType, volume, volume_24h AS volume24h,
                liquidity, clob_liquidity AS clobLiquidity, open_interest AS openInterest
         FROM source_markets`,
      ).get(),
    ).toEqual({
      sourceMarketType: "moneyline",
      volume: null,
      volume24h: 0,
      liquidity: null,
      clobLiquidity: null,
      openInterest: null,
    });
    expect(db.query("SELECT COUNT(*) AS count FROM events").get()).toEqual({ count: 0 });
    expect(db.query("SELECT COUNT(*) AS count FROM markets").get()).toEqual({ count: 0 });
  });

  test("preserves missing source market types and null versus zero metrics", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    upsertSourceObservation(
      db,
      observation({
        missingSourceMarketType: true,
        volume: 0,
        volume24h: null,
        liquidity: 12.5,
        clobLiquidity: 0,
        openInterest: null,
      }),
    );
    expect(
      db.query(
        `SELECT source_market_type AS sourceMarketType, volume, volume_24h AS volume24h,
                liquidity, clob_liquidity AS clobLiquidity, open_interest AS openInterest
         FROM source_markets`,
      ).get(),
    ).toEqual({
      sourceMarketType: null,
      volume: 0,
      volume24h: null,
      liquidity: 12.5,
      clobLiquidity: 0,
      openInterest: null,
    });
  });

  test("is idempotent and scopes identical raw ids by provider", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    upsertSourceObservation(db, observation());
    upsertSourceObservation(db, observation());
    upsertSourceObservation(db, observation({ source: SOURCE.kalshi }));
    expect(db.query("SELECT COUNT(*) AS count FROM source_events").get()).toEqual({ count: 2 });
    expect(db.query("SELECT COUNT(*) AS count FROM source_markets").get()).toEqual({ count: 2 });
  });

  test("rolls back the whole observation when a child violates quote constraints", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    expect(() =>
      upsertSourceObservation(
        db,
        observation({ eventId: "invalid-event", probability: 1.2, bid: 0.8, ask: 0.7 }),
      ),
    ).toThrow();
    expect(db.query("SELECT COUNT(*) AS count FROM source_events").get()).toEqual({ count: 0 });
    expect(db.query("SELECT COUNT(*) AS count FROM source_event_participants").get()).toEqual({
      count: 0,
    });
  });

  test("does not let an older observation regress newer state", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    upsertSourceObservation(db, observation({ title: "Current title", observedAtMs: 200 }));
    expect(
      upsertSourceObservation(db, observation({ title: "Older title", observedAtMs: 100 })),
    ).toBe("ignored_older");
    expect(db.query("SELECT title FROM source_events").get()).toEqual({ title: "Current title" });
  });

  test("keeps source identity immutable and retains every selector scope", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    upsertSourceObservation(
      db,
      observation({ source: SOURCE.kalshi, observedAtMs: 100, sourceUpdatedAtMs: 500 }),
    );
    upsertSourceObservation(
      db,
      observation({
        source: SOURCE.kalshi,
        observedAtMs: 200,
        sourceUpdatedAtMs: 600,
        selectorScope: "kalshi:series:KXTABLETENNIS",
      }),
    );
    expect(
      db.query("SELECT source_updated_at_ms AS sourceUpdatedAtMs FROM source_events").get(),
    ).toEqual({ sourceUpdatedAtMs: 600 });
    expect(
      db.query("SELECT selector_scope AS scope FROM source_event_selectors ORDER BY scope").all(),
    ).toEqual([
      { scope: "kalshi:series:KXTABLETENNIS" },
      { scope: "kalshi:series:KXTABLETENNISMATCH" },
    ]);
    expect(() =>
      upsertSourceObservation(
        db,
        observation({
          source: SOURCE.kalshi,
          observedAtMs: 300,
          sport: SPORT.tennis,
          selectorScope: "kalshi:series:KXATPMATCH",
        }),
      ),
    ).toThrow("source event sport drift");
    expect(() =>
      upsertSourceObservation(
        db,
        observation({ source: SOURCE.kalshi, eventId: "event-002", observedAtMs: 300 }),
      ),
    ).toThrow("source market event drift");
    expect(
      db.query(
        "SELECT COUNT(*) AS count FROM source_events WHERE source_event_id = 'event-002'",
      ).get(),
    ).toEqual({ count: 0 });
  });

  test("does not attach stale payloads to a newer upstream version", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    upsertSourceObservation(
      db,
      observation({
        title: "Current title",
        observedAtMs: 100,
        sourceUpdatedAtMs: 500,
        probability: 0.7,
      }),
    );
    expect(
      upsertSourceObservation(
        db,
        observation({
          title: "Stale title",
          observedAtMs: 200,
          sourceUpdatedAtMs: 400,
          probability: 0.2,
        }),
      ),
    ).toBe("ignored_older");
    expect(
      db.query(
        `SELECT e.title, e.source_updated_at_ms AS sourceUpdatedAtMs, o.probability
         FROM source_events e
         JOIN source_markets m
           ON m.source_key = e.source_key AND m.source_event_id = e.source_event_id
         JOIN source_market_outcomes o
           ON o.source_key = m.source_key AND o.source_market_id = m.source_market_id
         WHERE o.outcome_key = 'yes'`,
      ).get(),
    ).toEqual({ title: "Current title", sourceUpdatedAtMs: 500, probability: 0.7 });
  });

  test("does not regress one market when its event observation is newer", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const current = observation({
      title: "Current event",
      observedAtMs: 100,
      sourceUpdatedAtMs: 500,
      probability: 0.7,
    });
    upsertSourceObservation(db, {
      ...current,
      markets: current.markets.map((market) => ({
        ...market,
        title: "Current market",
        sourceUpdatedAtMs: 500,
      })),
    });

    const mixedVersion = observation({
      title: "Newer event",
      observedAtMs: 200,
      sourceUpdatedAtMs: 600,
      probability: 0.2,
    });
    expect(
      upsertSourceObservation(db, {
        ...mixedVersion,
        markets: mixedVersion.markets.map((market) => ({
          ...market,
          title: "Stale market",
          sourceUpdatedAtMs: 400,
        })),
      }),
    ).toBe("updated");
    expect(db.query("SELECT title FROM source_events").get()).toEqual({ title: "Newer event" });
    expect(
      db.query(
        `SELECT m.title, m.source_updated_at_ms AS sourceUpdatedAtMs, m.active,
                o.probability, o.active AS outcomeActive
         FROM source_markets m
         JOIN source_market_outcomes o
           ON o.source_key = m.source_key AND o.source_market_id = m.source_market_id
         WHERE o.outcome_key = 'yes'`,
      ).get(),
    ).toEqual({
      title: "Current market",
      sourceUpdatedAtMs: 500,
      active: 1,
      probability: 0.7,
      outcomeActive: 1,
    });
  });

  test("does not resurrect outcomes retired by a newer market version", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const version400 = observation({ observedAtMs: 100, sourceUpdatedAtMs: 400 });
    upsertSourceObservation(db, {
      ...version400,
      markets: version400.markets.map((market) => ({
        ...market,
        sourceUpdatedAtMs: 400,
        outcomes: [
          ...market.outcomes,
          {
            outcome: asOutcomeKey("retired"),
            ordinal: 2,
            label: "Retired",
            probability: null,
            bid: null,
            ask: null,
            last: null,
          },
        ],
      })),
    });
    const version500 = observation({ observedAtMs: 200, sourceUpdatedAtMs: 500 });
    upsertSourceObservation(db, {
      ...version500,
      markets: version500.markets.map((market) => ({ ...market, sourceUpdatedAtMs: 500 })),
    });
    const staleMarket = observation({ observedAtMs: 300, sourceUpdatedAtMs: 600 });
    upsertSourceObservation(db, {
      ...staleMarket,
      markets: staleMarket.markets.map((market) => ({
        ...market,
        sourceUpdatedAtMs: 400,
        outcomes: version400.markets[0]!.outcomes,
      })),
    });
    expect(
      db.query(
        `SELECT outcome_key AS outcome, active, retired_at_ms AS retiredAtMs
         FROM source_market_outcomes ORDER BY outcome_key`,
      ).all(),
    ).toEqual([
      { outcome: "no", active: 1, retiredAtMs: null },
      { outcome: "retired", active: 0, retiredAtMs: 200 },
      { outcome: "yes", active: 1, retiredAtMs: null },
    ]);
  });

  test("keeps stale markets inactive when their stored participant leaves a complete event", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const current = observation({ observedAtMs: 100, sourceUpdatedAtMs: 500 });
    upsertSourceObservation(db, {
      ...current,
      markets: current.markets.map((market) => ({
        ...market,
        sourceUpdatedAtMs: 500,
        subjectParticipantId: asSourceParticipantId("beta"),
        outcomes: market.outcomes.map((outcome) => ({
          ...outcome,
          participantId: asSourceParticipantId("beta"),
        })),
      })),
    });
    const refresh = observation({ observedAtMs: 200, sourceUpdatedAtMs: 600 });
    upsertSourceObservation(db, {
      ...refresh,
      participants: [refresh.participants[0]!],
      markets: refresh.markets.map((market) => ({
        ...market,
        sourceUpdatedAtMs: 400,
      })),
    });
    expect(db.query("SELECT active FROM source_markets").get()).toEqual({ active: 0 });
    expect(db.query("SELECT active FROM source_market_outcomes LIMIT 1").get()).toEqual({
      active: 0,
    });
    expect(
      db.query(
        `SELECT source_participant_id AS participantId, active
         FROM source_event_participants ORDER BY participantId`,
      ).all(),
    ).toEqual([
      { participantId: "alpha", active: 1 },
      { participantId: "beta", active: 0 },
    ]);
  });

  test("rejects observations whose branded relationships do not match the registry", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const base = observation();
    expect(() =>
      upsertSourceObservation(db, {
        ...base,
        provenance: { ...base.provenance, adapter: asAdapterId("kalshi-markets-v1") },
      }),
    ).toThrow("adapter must match registered source/sport integration");
    expect(() =>
      upsertSourceObservation(db, {
        ...base,
        provenance: {
          ...base.provenance,
          selector: { ...base.provenance.selector, sport: SPORT.tennis },
        },
      }),
    ).toThrow("selector sport must match observation sport");
    expect(() =>
      upsertSourceObservation(db, {
        ...base,
        provenance: {
          ...base.provenance,
          selector: {
            ...base.provenance.selector,
            scope: asSourceScopeId("kalshi:series:KXTABLETENNISMATCH"),
          },
        },
      }),
    ).toThrow("selector scope must match observation source");
    expect(() =>
      upsertSourceObservation(db, {
        ...base,
        provenance: {
          ...base.provenance,
          selector: {
            ...base.provenance.selector,
            parameters: { ...base.provenance.selector.parameters, tagSlug: "wrong-slug" },
          },
        },
      }),
    ).toThrow("selector must exactly match the registered binding");
    const kalshi = observation({ source: SOURCE.kalshi });
    expect(() =>
      upsertSourceObservation(db, {
        ...kalshi,
        provenance: {
          ...kalshi.provenance,
          selector: {
            ...kalshi.provenance.selector,
            parameters: { ...kalshi.provenance.selector.parameters, tag: "Tennis" },
          },
        },
      }),
    ).toThrow("selector must exactly match the registered binding");
    expect(() =>
      upsertSourceObservation(db, {
        ...base,
        markets: base.markets.map((market) => ({ ...market, marketKind: MARKET.other })),
      }),
    ).toThrow("source market type must use its registered market kind");
    expect(() =>
      upsertSourceObservation(db, {
        ...base,
        markets: base.markets.map((market) => ({
          ...market,
          sourceMarketType: asSourceMarketType("unknown-market"),
        })),
      }),
    ).toThrow("unmapped source market type must remain quarantined");
    expect(db.query("SELECT COUNT(*) AS count FROM source_events").get()).toEqual({ count: 0 });
  });

  test("makes equal-version writes deterministic while retaining selector membership", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    upsertSourceObservation(
      db,
      observation({
        source: SOURCE.kalshi,
        title: "First",
        observedAtMs: 100,
        sourceUpdatedAtMs: 90,
      }),
    );
    expect(
      upsertSourceObservation(
        db,
        observation({
          source: SOURCE.kalshi,
          title: "Conflicting equal version",
          observedAtMs: 100,
          sourceUpdatedAtMs: 90,
          selectorScope: "kalshi:series:KXTABLETENNIS",
        }),
      ),
    ).toBe("ignored_older");
    expect(db.query("SELECT title FROM source_events").get()).toEqual({ title: "First" });
    expect(db.query("SELECT COUNT(*) AS count FROM source_event_selectors").get()).toEqual({
      count: 2,
    });
  });

  test("retires missing children only for complete event snapshots", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const initial = observation({ observedAtMs: 100, sourceUpdatedAtMs: 90 });
    upsertSourceObservation(db, initial);
    upsertSourceObservation(db, {
      ...initial,
      title: "Partial refresh",
      snapshotCompleteness: "partial",
      participants: [],
      markets: [],
      provenance: { ...initial.provenance, observedAtMs: 200, sourceUpdatedAtMs: 190 },
    });
    expect(db.query("SELECT active FROM source_markets").get()).toEqual({ active: 1 });

    upsertSourceObservation(db, {
      ...initial,
      title: "Complete refresh",
      participants: [],
      markets: [],
      provenance: { ...initial.provenance, observedAtMs: 300, sourceUpdatedAtMs: 290 },
    });
    expect(db.query("SELECT active, retired_at_ms FROM source_markets").get()).toEqual({
      active: 0,
      retired_at_ms: 300,
    });
    expect(db.query("SELECT active, retired_at_ms FROM source_market_outcomes LIMIT 1").get()).toEqual({
      active: 0,
      retired_at_ms: 300,
    });
    expect(db.query("SELECT active, retired_at_ms FROM source_event_participants LIMIT 1").get()).toEqual({
      active: 0,
      retired_at_ms: 300,
    });
  });

  test("rejects duplicate stable identities and non-finite source numbers", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const base = observation();
    const duplicateParticipants: NormalizedSourceObservation = {
      ...base,
      participants: [base.participants[0]!, { ...base.participants[0]!, ordinal: 1 }],
    };
    expect(() => upsertSourceObservation(db, duplicateParticipants)).toThrow(
      "duplicate participant id",
    );
    const duplicateOutcomes: NormalizedSourceObservation = {
      ...base,
      markets: base.markets.map((market) => ({
        ...market,
        outcomes: [market.outcomes[0]!, { ...market.outcomes[0]!, ordinal: 1 }],
      })),
    };
    expect(() => upsertSourceObservation(db, duplicateOutcomes)).toThrow(
      "duplicate outcome market-001 key",
    );
    expect(() =>
      upsertSourceObservation(db, observation({ probability: Number.NaN })),
    ).toThrow("must be finite or null");
    const infiniteTimestamp: NormalizedSourceObservation = {
      ...base,
      provenance: { ...base.provenance, observedAtMs: Number.POSITIVE_INFINITY },
    };
    expect(() => upsertSourceObservation(db, infiniteTimestamp)).toThrow(
      "observedAtMs must be a non-negative safe integer",
    );
    expect(db.query("SELECT COUNT(*) AS count FROM source_events").get()).toEqual({ count: 0 });
  });

  test("rejects market participant references outside the event", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const base = observation();
    expect(() =>
      upsertSourceObservation(db, {
        ...base,
        markets: base.markets.map((market) => ({
          ...market,
          subjectParticipantId: asSourceParticipantId("outsider"),
        })),
      }),
    ).toThrow("subject participant is absent from complete snapshot");
    expect(() =>
      upsertSourceObservation(db, {
        ...base,
        markets: base.markets.map((market) => ({
          ...market,
          outcomes: market.outcomes.map((outcome, index) =>
            index === 0
              ? { ...outcome, participantId: asSourceParticipantId("outsider") }
              : outcome,
          ),
        })),
      }),
    ).toThrow("participant is absent from complete snapshot");
    expect(db.query("SELECT COUNT(*) AS count FROM source_events").get()).toEqual({ count: 0 });
  });

  test("keeps outcome identity stable when the provider reverses array order", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const initial = observation({ observedAtMs: 100 });
    upsertSourceObservation(db, initial);
    const reversed: NormalizedSourceObservation = {
      ...initial,
      provenance: { ...initial.provenance, observedAtMs: 200 },
      markets: initial.markets.map((market) => ({
        ...market,
        outcomes: [...market.outcomes]
          .reverse()
          .map((outcome, ordinal) => ({ ...outcome, ordinal })),
      })),
    };
    upsertSourceObservation(db, reversed);
    expect(
      db.query(
        `SELECT outcome_key AS outcome, ordinal
         FROM source_market_outcomes ORDER BY ordinal`,
      ).all(),
    ).toEqual([
      { outcome: "yes", ordinal: 0 },
      { outcome: "no", ordinal: 1 },
    ]);
  });

  test("preserves nullable quotes and rejects orphan markets", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    upsertSourceObservation(
      db,
      observation({ probability: null, bid: null, ask: null }),
    );
    expect(
      db.query(
        `SELECT probability, bid, ask
         FROM source_market_outcomes WHERE outcome_key = 'yes'`,
      ).get(),
    ).toEqual({ probability: null, bid: null, ask: null });
    expect(() =>
      db.query(
        `INSERT INTO source_markets (
           source_key, source_market_id, source_event_id, source_market_type,
           title, first_observed_at_ms, last_observed_at_ms
         ) VALUES ('polymarket', 'orphan', 'missing', 'moneyline', 'Orphan', 1, 1)`,
      ).run(),
    ).toThrow();
  });

  test("stores tournament fields without forcing a two-participant match", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const base = observation({
      eventId: "field-event",
      marketId: "field-market",
      source: SOURCE.kalshi,
      selectorScope: "kalshi:series:KXITTFMEN",
    });
    const field: NormalizedSourceObservation = {
      ...base,
      title: "ITTF tournament winner",
      eventType: "tournament",
      participantFormat: "field",
      participants: [
        ...base.participants,
        { id: asSourceParticipantId("gamma"), ordinal: 2, label: "Gamma" },
      ],
      markets: base.markets.map((market) => ({
        ...market,
        sourceMarketType: asSourceMarketType("tournament_winner"),
        marketKind: MARKET.tournamentWinner,
        outcomes: [
          ...market.outcomes,
          {
            outcome: asOutcomeKey("gamma"),
            ordinal: 2,
            label: "Gamma",
            probability: null,
            bid: null,
            ask: null,
            last: null,
          },
        ],
      })),
    };
    expect(upsertSourceObservation(db, field)).toBe("inserted");
    expect(db.query("SELECT COUNT(*) AS count FROM source_event_participants").get()).toEqual({
      count: 3,
    });
    expect(db.query("SELECT COUNT(*) AS count FROM source_market_outcomes").get()).toEqual({
      count: 3,
    });
    expect(
      db.query("SELECT event_type AS eventType, participant_format AS format FROM source_events").get(),
    ).toEqual({ eventType: "tournament", format: "field" });
  });

  test("accepts provider reordering while rejecting duplicate ordinals", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const initial = observation();
    upsertSourceObservation(db, initial);
    const reordered: NormalizedSourceObservation = {
      ...observation({ observedAtMs: 200 }),
      participants: initial.participants.map((participant) => ({
        ...participant,
        ordinal: participant.ordinal === 0 ? 1 : 0,
      })),
      markets: initial.markets.map((market) => ({
        ...market,
        outcomes: market.outcomes.map((outcome) => ({
          ...outcome,
          ordinal: outcome.ordinal === 0 ? 1 : 0,
        })),
      })),
    };
    expect(upsertSourceObservation(db, reordered)).toBe("updated");
    expect(
      db.query(
        "SELECT source_participant_id AS id, ordinal FROM source_event_participants ORDER BY id",
      ).all(),
    ).toEqual([
      { id: "alpha", ordinal: 1 },
      { id: "beta", ordinal: 0 },
    ]);
    expect(
      db.query(
        "SELECT outcome_key AS outcome, ordinal FROM source_market_outcomes ORDER BY outcome",
      ).all(),
    ).toEqual([
      { outcome: "no", ordinal: 1 },
      { outcome: "yes", ordinal: 0 },
    ]);

    const duplicate: NormalizedSourceObservation = {
      ...observation({ eventId: "duplicate-ordinal" }),
      participants: initial.participants.map((participant) => ({ ...participant, ordinal: 0 })),
    };
    expect(() => upsertSourceObservation(db, duplicate)).toThrow(
      "duplicate participant ordinal",
    );
    expect(
      db.query(
        "SELECT COUNT(*) AS count FROM source_events WHERE source_event_id = 'duplicate-ordinal'",
      ).get(),
    ).toEqual({ count: 0 });
  });

  test("uses source event ids as keyset cursors", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    for (const eventId of ["event-001", "event-002", "event-003"]) {
      upsertSourceObservation(
        db,
        observation({ eventId, marketId: `market-${eventId}`, title: eventId }),
      );
    }
    const first = listSourceEvents(db, {
      source: SOURCE.polymarket,
      sport: SPORT.tableTennis,
      limit: 2,
    });
    expect(first.map((row) => String(row.eventId))).toEqual(["event-001", "event-002"]);
    const second = listSourceEvents(db, {
      source: SOURCE.polymarket,
      sport: SPORT.tableTennis,
      afterEventId: asSourceEventId("event-002"),
      limit: 2,
    });
    expect(second.map((row) => String(row.eventId))).toEqual(["event-003"]);
    expect(() =>
      listSourceEvents(db, {
        source: SOURCE.polymarket,
        sport: SPORT.tableTennis,
        limit: Number.NaN,
      }),
    ).toThrow("positive safe integer");
    expect(() =>
      listSourceEvents(db, {
        source: SOURCE.polymarket,
        sport: SPORT.tableTennis,
        limit: 0.5,
      }),
    ).toThrow("positive safe integer");
  });
});
