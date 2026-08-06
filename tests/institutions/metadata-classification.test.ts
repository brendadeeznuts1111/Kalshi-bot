import { describe, expect, test } from "bun:test";
import {
  asSourceMetadataId,
  SELECTOR,
  SOURCE,
  unbrand,
} from "../../src/institutions/market-registry/brands.ts";
import { classifySourceMetadata } from "../../src/institutions/market-registry/metadata-classification.ts";
import type { NormalizedSourceMetadata } from "../../src/institutions/market-registry/types.ts";

function kalshiSeries(
  ticker: string,
  tags: readonly string[],
  category = "Sports",
): NormalizedSourceMetadata {
  return {
    source: SOURCE.kalshi,
    metadataId: asSourceMetadataId(ticker),
    metadataKind: SELECTOR.kalshiSeriesMetadata,
    label: ticker,
    attributes: { category },
    facets: { tags },
  };
}

function polymarketSport(code: string, tagIds: readonly string[]): NormalizedSourceMetadata {
  return {
    source: SOURCE.polymarket,
    metadataId: asSourceMetadataId(code),
    metadataKind: SELECTOR.polymarketSportsMetadata,
    label: code,
    attributes: {},
    facets: { tag_ids: tagIds },
  };
}

function summary(entity: NormalizedSourceMetadata) {
  return classifySourceMetadata(entity).map((row) => ({
    sport: unbrand(row.sport),
    disposition: row.disposition,
    reason: unbrand(row.reasonCode),
    scope: row.matchedSelectorScope ? unbrand(row.matchedSelectorScope) : null,
  }));
}

describe("source metadata classification", () => {
  test("registers an exact Kalshi series and ignores the unrelated sport", () => {
    expect(summary(kalshiSeries("KXATPSETWINNER", ["Tennis"]))).toEqual([
      {
        sport: "tennis",
        disposition: "registered",
        reason: "exact_registry_match",
        scope: "kalshi:series:KXATPSETWINNER",
      },
      {
        sport: "table_tennis",
        disposition: "ignored",
        reason: "sport_facet_absent",
        scope: null,
      },
    ]);
  });

  test("quarantines unknown candidates and registered metadata drift", () => {
    expect(summary(kalshiSeries("KXPICKLEBALLMATCH", ["Tennis"]))[0]).toEqual({
      sport: "tennis",
      disposition: "quarantined",
      reason: "unregistered_candidate",
      scope: null,
    });
    expect(summary(kalshiSeries("KXATPSETWINNER", []))[0]).toEqual({
      sport: "tennis",
      disposition: "quarantined",
      reason: "registered_metadata_drift",
      scope: null,
    });
    expect(summary(kalshiSeries("KXATPSETWINNER", ["Tennis"], "Entertainment"))[0]).toEqual({
      sport: "tennis",
      disposition: "quarantined",
      reason: "registered_metadata_drift",
      scope: null,
    });
    expect(summary(kalshiSeries("KXATPSETWINNER", ["Table Tennis"]))).toEqual([
      {
        sport: "tennis",
        disposition: "quarantined",
        reason: "registered_metadata_drift",
        scope: null,
      },
      {
        sport: "table_tennis",
        disposition: "quarantined",
        reason: "registered_metadata_drift",
        scope: null,
      },
    ]);
  });

  test("quarantines cross-sport ambiguity without choosing the first match", () => {
    expect(summary(kalshiSeries("KXNEW", ["Tennis", "Table Tennis"]))).toEqual([
      {
        sport: "tennis",
        disposition: "quarantined",
        reason: "ambiguous_sport",
        scope: null,
      },
      {
        sport: "table_tennis",
        disposition: "quarantined",
        reason: "ambiguous_sport",
        scope: null,
      },
    ]);
  });

  test("uses exact Polymarket tag ids as broad registered coverage", () => {
    expect(summary(polymarketSport("atp", ["1", "864", "100639"]))).toEqual([
      {
        sport: "tennis",
        disposition: "registered",
        reason: "covered_by_registered_facet",
        scope: "polymarket:tag:864",
      },
      {
        sport: "table_tennis",
        disposition: "ignored",
        reason: "sport_facet_absent",
        scope: null,
      },
    ]);
    expect(summary(polymarketSport("wttmen", ["1", "103767"]))[1]).toEqual({
      sport: "table_tennis",
      disposition: "registered",
      reason: "covered_by_registered_facet",
      scope: "polymarket:tag:103767",
    });
  });

  test("keeps unrelated metadata explicitly ignored and rejects malformed facets", () => {
    expect(summary(kalshiSeries("KXNBA", ["Basketball"])).every(
      (row) => row.disposition === "ignored" && row.reason === "sport_facet_absent",
    )).toBe(true);
    expect(() =>
      classifySourceMetadata({
        ...kalshiSeries("KXBAD", ["Tennis"]),
        facets: { tags: ["Tennis", "Tennis"] },
      }),
    ).toThrow("duplicate metadata facet value");
    expect(() =>
      classifySourceMetadata({
        ...kalshiSeries("KXBAD", ["Tennis"]),
        facets: {},
      }),
    ).toThrow("metadata candidate facet missing: tags");
    expect(() =>
      classifySourceMetadata({
        ...kalshiSeries("KXBAD", ["Tennis"]),
        metadataKind: SELECTOR.kalshiSeries,
      }),
    ).toThrow("metadata kind is not configured for source");
  });

  test("quarantines a candidate facet when required source attributes drift", () => {
    expect(summary(kalshiSeries("KXUNKNOWN", ["Tennis"], "Entertainment"))[0]).toEqual({
      sport: "tennis",
      disposition: "quarantined",
      reason: "unregistered_candidate",
      scope: null,
    });
  });
});
