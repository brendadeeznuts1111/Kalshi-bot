import { describe, expect, test } from "bun:test";
import {
  asAdapterId,
  asIntegrationId,
  asSelectorKind,
  asSourceKey,
  asSourceScopeId,
  asSportFamilyKey,
  asSportKey,
  MARKET,
  IDENTITY,
  parseSportKey,
  SELECTOR,
  SOURCE,
  SPORT,
  unbrand,
} from "../../src/institutions/market-registry/brands.ts";
import {
  buildSportsSourceRegistryArtifact,
  classifyKalshiSeriesDrift,
  kalshiBindingForSeries,
  kalshiDeclaredReconciliationSeriesForSport,
  kalshiIdentityFieldForSeries,
  kalshiInventorySeriesForSport,
  kalshiReconciliationSeriesForSport,
  kalshiSeriesForSport,
  kalshiSportForSeries,
  kalshiTradeSeriesForSport,
  polymarketTagsForSport,
  sourceSelectorCacheKey,
  SPORTS_SOURCE_REGISTRY,
} from "../../src/institutions/market-registry/registry.ts";
import { validateSportsSourceRegistry } from "../../src/institutions/market-registry/validate.ts";
import { asSeriesTicker, unbrand as unbrandSeries } from "../../src/institutions/event-store/brands.ts";
import type { SportsSourceRegistry } from "../../src/institutions/market-registry/types.ts";

describe("sports/source registry", () => {
  test("represents every current Kalshi/Polymarket × tennis/table-tennis cell", () => {
    expect(validateSportsSourceRegistry(SPORTS_SOURCE_REGISTRY)).toEqual([]);
    expect(
      SPORTS_SOURCE_REGISTRY.integrations
        .map((row) => `${unbrand(row.source)}:${unbrand(row.sport)}`)
        .sort(),
    ).toEqual([
      "kalshi:table_tennis",
      "kalshi:tennis",
      "polymarket:table_tennis",
      "polymarket:tennis",
    ]);
  });

  test("keeps table tennis distinct while permitting newly registered keys", () => {
    expect(parseSportKey("tennis")).toBe(SPORT.tennis);
    expect(parseSportKey("table tennis")).toBe(SPORT.tableTennis);
    expect(parseSportKey("ping pong")).toBe(SPORT.tableTennis);
    expect(parseSportKey("table tennis")).not.toBe(parseSportKey("tennis"));
    expect(unbrand(parseSportKey("beach soccer"))).toBe("beach_soccer");
    expect(unbrand(asSourceKey("pinnacle"))).toBe("pinnacle");
    expect(() => asSportKey("---")).toThrow("required after normalization");
  });

  test("classifies exact Kalshi identities without ticker-family guesses", () => {
    expect(kalshiBindingForSeries(asSeriesTicker("KXITFMATCH"))).toMatchObject({
      participantFormats: ["singles"],
      marketKinds: [MARKET.matchWinner],
      declaredUse: "trade",
    });
    expect(kalshiBindingForSeries(asSeriesTicker("KXITFDOUBLES"))).toMatchObject({
      participantFormats: ["doubles"],
      identityFields: ["tennis_competitor"],
    });
    expect(kalshiBindingForSeries(asSeriesTicker("KXATPDOUBLES"))).toMatchObject({
      participantFormats: ["doubles"],
      identityFields: ["tennis_doubles_competitor"],
    });
    expect(kalshiBindingForSeries(asSeriesTicker("KXTABLETENNISMATCH"))).toMatchObject({
      participantFormats: ["singles"],
      identityFields: ["table_tennis_competitor"],
      declaredUse: "match",
    });
    expect(kalshiBindingForSeries(asSeriesTicker("KXITTFMEN"))).toMatchObject({
      eventTypes: ["tournament"],
      participantFormats: ["field"],
      declaredUse: "inventory",
    });
    expect(kalshiBindingForSeries(asSeriesTicker("KXATPSETWINNER"))).toMatchObject({
      declaredUse: "inventory",
      identityFields: [IDENTITY.tennisCompetitor],
      selector: {
        parameters: {
          endpoint: "/events",
          status: "open",
          withNestedMarkets: "true",
        },
      },
    });
    expect(kalshiBindingForSeries(asSeriesTicker("KXWTASETWINNER"))).toMatchObject({
      declaredUse: "inventory",
      identityFields: [IDENTITY.tennisCompetitor],
    });
    expect(unbrand(kalshiIdentityFieldForSeries(asSeriesTicker("KXATPDOUBLES"))!)).toBe(
      "tennis_doubles_competitor",
    );
    expect(kalshiSportForSeries(asSeriesTicker("KXTABLETENNISMATCH"))).toBe(
      SPORT.tableTennis,
    );
    expect(kalshiSportForSeries(asSeriesTicker("KXUNKNOWN"))).toBeUndefined();
  });

  test("acquires all known Kalshi series and narrows explicitly for downstream modes", () => {
    const tennis = kalshiSeriesForSport(SPORT.tennis).map(unbrandSeries);
    const reconciled = kalshiReconciliationSeriesForSport(SPORT.tennis).map(unbrandSeries);
    const traded = kalshiTradeSeriesForSport(SPORT.tennis).map(unbrandSeries);
    expect(tennis).toContain("KXATPSETWINNER");
    expect(tennis).toContain("KXDAVISCUPMATCH");
    expect(reconciled).not.toContain("KXATPSETWINNER");
    expect(reconciled).toContain("KXATPDOUBLES");
    expect(traded).toContain("KXITFDOUBLES");
    expect(traded).not.toContain("KXATPDOUBLES");
  });

  test("registers all eight observed table-tennis series and quarantines drift", () => {
    const expected = [
      "KXITTFMENMATCH",
      "KXITTFMEN",
      "KXWTABLETENNISMATCH",
      "KXITTFWOMENMATCH",
      "KXTTELITEGAME",
      "KXTABLETENNIS",
      "KXTABLETENNISMATCH",
      "KXITTFWOMEN",
    ].sort();
    expect(kalshiSeriesForSport(SPORT.tableTennis).map(unbrandSeries).sort()).toEqual(expected);
    expect(kalshiInventorySeriesForSport(SPORT.tableTennis).map(unbrandSeries).sort()).toEqual(
      expected,
    );
    expect(kalshiReconciliationSeriesForSport(SPORT.tableTennis).map(unbrandSeries)).toEqual([
    ]);
    expect(
      kalshiDeclaredReconciliationSeriesForSport(SPORT.tableTennis).map(unbrandSeries),
    ).toEqual(["KXTABLETENNISMATCH"]);
    const registration = SPORTS_SOURCE_REGISTRY.integrations.find(
      (row) => row.source === SOURCE.kalshi && row.sport === SPORT.tableTennis,
    );
    expect(registration).toMatchObject({
      state: "discovering",
      operationalCapabilities: ["inventory"],
    });
    const drift = classifyKalshiSeriesDrift(SPORT.tableTennis, [
      asSeriesTicker("KXTABLETENNISMATCH"),
      asSeriesTicker("KXWTTNEWGAME"),
    ]);
    expect(drift.registered.map(unbrandSeries)).toEqual(["KXTABLETENNISMATCH"]);
    expect(drift.quarantine.map(unbrandSeries)).toEqual(["KXWTTNEWGAME"]);
  });

  test("keeps broad Polymarket tags as acquisition scopes, not exact event semantics", () => {
    const tennis = polymarketTagsForSport(SPORT.tennis);
    const tableTennis = polymarketTagsForSport(SPORT.tableTennis);
    expect(tennis).toMatchObject([
      { scope: "polymarket:tag:864", tagId: "864", tagSlug: "tennis" },
    ]);
    expect(tableTennis).toMatchObject([
      { scope: "polymarket:tag:103767", tagId: "103767", tagSlug: "table-tennis" },
    ]);
    const registration = SPORTS_SOURCE_REGISTRY.integrations.find(
      (row) => row.source === SOURCE.polymarket && row.sport === SPORT.tableTennis,
    );
    expect(registration).toMatchObject({
      state: "enabled",
      operationalCapabilities: ["inventory", "quotes", "reconciliation"],
      competitions: [
        {
          semanticConfidence: "discovery",
          eventTypes: ["match", "tournament"],
          participantFormats: ["singles", "doubles", "team", "mixed", "field"],
          declaredUse: "match",
        },
      ],
    });
    expect(sourceSelectorCacheKey(SOURCE.polymarket, tennis[0]!).toString()).not.toBe(
      sourceSelectorCacheKey(SOURCE.polymarket, tableTennis[0]!).toString(),
    );
    expect(
      registration?.competitions[0]?.sourceMarketMappings.map((mapping) =>
        unbrand(mapping.sourceMarketType),
      ),
    ).toEqual(["moneyline", "table_tennis_match_totals", "table_tennis_game_handicap"]);
  });

  test("validates injectable registries and rejects cross-field drift", () => {
    const soccer = asSportKey("soccer");
    const pinnacle = asSourceKey("pinnacle");
    const extended: SportsSourceRegistry = {
      sports: [
        ...SPORTS_SOURCE_REGISTRY.sports,
        { key: soccer, label: "Soccer", family: asSportFamilyKey("football"), aliases: [] },
      ],
      sources: [...SPORTS_SOURCE_REGISTRY.sources, { key: pinnacle, label: "Pinnacle" }],
      adapters: [
        ...SPORTS_SOURCE_REGISTRY.adapters,
        {
          id: asAdapterId("pinnacle-v1"),
          source: pinnacle,
          idNamespace: "source_global",
          parserVersion: 1,
          selectorKinds: [asSelectorKind("pinnacle_league")],
          metadataSelectorKinds: [],
          validateSelector: () => [],
          cachePolicy: { freshForMs: 60_000, staleForMs: 300_000, failureThreshold: 3 },
        },
      ],
      integrations: [
        ...SPORTS_SOURCE_REGISTRY.integrations,
        {
          integration: asIntegrationId("pinnacle:soccer"),
          sport: soccer,
          source: pinnacle,
          state: "discovering",
          adapter: asAdapterId("pinnacle-v1"),
          declaredCapabilities: ["inventory"],
          operationalCapabilities: [],
          competitions: [],
          reason: "Adapter template only; no runtime acquisition is wired.",
        },
      ],
    };
    expect(validateSportsSourceRegistry(extended)).toEqual([]);

    const duplicate: SportsSourceRegistry = {
      ...SPORTS_SOURCE_REGISTRY,
      integrations: [
        ...SPORTS_SOURCE_REGISTRY.integrations,
        { ...SPORTS_SOURCE_REGISTRY.integrations[0]!, integration: asIntegrationId("bad:id") },
      ],
    };
    expect(validateSportsSourceRegistry(duplicate)).toContain(
      "duplicate sport/source cell: kalshi:tennis",
    );
    expect(validateSportsSourceRegistry(duplicate)).toContain("bad:id: integration id mismatch");

    const wrongSelector: SportsSourceRegistry = {
      ...SPORTS_SOURCE_REGISTRY,
      integrations: SPORTS_SOURCE_REGISTRY.integrations.map((row, index) =>
        index === 0
          ? {
              ...row,
              competitions: [
                {
                  ...row.competitions[0]!,
                  selector: {
                    kind: SELECTOR.polymarketTag,
                    scope: asSourceScopeId("polymarket:tag:864"),
                    sport: SPORT.tennis,
                    parameters: { tagId: "864", tagSlug: "tennis" },
                  },
                },
              ],
            }
          : row,
      ),
    };
    expect(validateSportsSourceRegistry(wrongSelector)).toContain(
      "kalshi:tennis: selector scope source mismatch",
    );
    expect(validateSportsSourceRegistry(wrongSelector)).toContain(
      "kalshi:tennis: selector kind unsupported by adapter",
    );
    expect(() => buildSportsSourceRegistryArtifact(undefined, wrongSelector)).toThrow(
      "Invalid sports/source registry",
    );

    const enabledWithoutInventory: SportsSourceRegistry = {
      ...SPORTS_SOURCE_REGISTRY,
      integrations: SPORTS_SOURCE_REGISTRY.integrations.map((row, index) =>
        index === 0 ? { ...row, operationalCapabilities: [] } : row,
      ),
    };
    expect(validateSportsSourceRegistry(enabledWithoutInventory)).toContain(
      "kalshi:tennis: enabled integration lacks operational inventory",
    );

    const discoveringWithoutSelectors: SportsSourceRegistry = {
      ...SPORTS_SOURCE_REGISTRY,
      integrations: SPORTS_SOURCE_REGISTRY.integrations.map((row, index) =>
        index === 1 ? { ...row, competitions: [] } : row,
      ),
    };
    expect(validateSportsSourceRegistry(discoveringWithoutSelectors)).toContain(
      "kalshi:table_tennis: operational inventory has no selectors",
    );

    const discoveringTrade: SportsSourceRegistry = {
      ...SPORTS_SOURCE_REGISTRY,
      integrations: SPORTS_SOURCE_REGISTRY.integrations.map((row, index) =>
        index === 1
          ? { ...row, operationalCapabilities: ["inventory", "trade"] }
          : row,
      ),
    };
    expect(validateSportsSourceRegistry(discoveringTrade)).toContain(
      "kalshi:table_tennis: non-enabled integration may operate inventory only",
    );

    const selectorScopedOperational: SportsSourceRegistry = {
      ...SPORTS_SOURCE_REGISTRY,
      adapters: SPORTS_SOURCE_REGISTRY.adapters.map((adapter, index) =>
        index === 0 ? { ...adapter, idNamespace: "selector_scoped" } : adapter,
      ),
    };
    expect(validateSportsSourceRegistry(selectorScopedOperational)).toContain(
      "kalshi:tennis: selector-scoped adapter cannot be operational without canonical ids",
    );

    const literalKalshiIdentity: SportsSourceRegistry = {
      ...SPORTS_SOURCE_REGISTRY,
      integrations: SPORTS_SOURCE_REGISTRY.integrations.map((row, index) =>
        index === 0
          ? {
              ...row,
              competitions: row.competitions.map((binding, bindingIndex) =>
                bindingIndex === 0
                  ? { ...binding, identityFields: [IDENTITY.literalOutcome] }
                  : binding,
              ),
            }
          : row,
      ),
    };
    expect(validateSportsSourceRegistry(literalKalshiIdentity)).toContain(
      "kalshi:tennis: unsupported Kalshi identity field",
    );
  });

  test("builds a deterministic, versioned public artifact", () => {
    const generatedAt = "2026-08-04T00:00:00.000Z";
    const first = buildSportsSourceRegistryArtifact(generatedAt);
    const second = buildSportsSourceRegistryArtifact(generatedAt);
    expect(first).toEqual(second);
    expect(first.schema).toBe("sports-source-registry/v1");
    expect(first.integrations).toHaveLength(4);
    expect(JSON.stringify(first)).toContain("polymarket:metadata:sports");
  });
});
