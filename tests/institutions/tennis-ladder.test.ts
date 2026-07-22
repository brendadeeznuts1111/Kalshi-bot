// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import {
  extractMatchupDateBlob,
  formatLadderCoverage,
  ladderFamilyFromTicker,
  marketKindFromTicker,
  summarizeLadderCoverage,
  TENNIS_LADDER_SERIES,
} from "../../src/institutions/event-store/tennis-ladder.ts";
import { migrateEventStoreColumns, openEventStore } from "../../src/institutions/event-store/open-db.ts";

describe("tennis-ladder", () => {
  test("extracts shared matchup blob across sibling series", () => {
    expect(extractMatchupDateBlob("KXATPMATCH-26JUL22BORBUR")).toBe("26JUL22BORBUR");
    expect(extractMatchupDateBlob("KXATPSETWINNER-26JUL22BORBUR-2-BOR")).toBe("26JUL22BORBUR");
    expect(extractMatchupDateBlob("KXATPEXACTMATCH-26JUL22BORBUR-BOR21")).toBe("26JUL22BORBUR");
  });

  test("classifies market kinds and families", () => {
    expect(marketKindFromTicker("KXATPS1GWINNER-26JUL22BORBUR-1-3-BOR")).toBe("s1_game");
    expect(marketKindFromTicker("KXITFMATCH-26JUL22SANALV-SAN")).toBe("match_winner");
    expect(ladderFamilyFromTicker("KXITFMATCH-26JUL22SANALV-SAN")).toBe("itf");
    expect(ladderFamilyFromTicker("KXATPMATCH-26JUL22BORBUR-BOR")).toBe("atp");
    expect(TENNIS_LADDER_SERIES.itf.every((s) => marketKindFromTicker(`${s}-X`) === "match_winner")).toBe(
      true,
    );
  });

  test("coverage flags ITF ladder-empty and ATP WS cue", () => {
    const itf = summarizeLadderCoverage("itf", "26JUL22SANALV", [
      "KXITFMATCH-26JUL22SANALV-SAN",
      "KXITFMATCH-26JUL22SANALV-ALV",
    ]);
    // ITF family has no non-winner series in the catalog → ladderEmpty false (nothing missing)
    expect(itf.ladderEmpty).toBe(false);
    expect(itf.perPointOpen).toBe(false);

    const atpWinnersOnly = summarizeLadderCoverage("atp", "26JUL22BORBUR", [
      "KXATPMATCH-26JUL22BORBUR-BOR",
      "KXATPMATCH-26JUL22BORBUR-BUR",
    ]);
    expect(atpWinnersOnly.ladderEmpty).toBe(true);

    const atpLive = summarizeLadderCoverage("atp", "26JUL22BORBUR", [
      "KXATPMATCH-26JUL22BORBUR-BOR",
      "KXATPS1GWINNER-26JUL22BORBUR-1-3-BOR",
    ]);
    expect(atpLive.perPointOpen).toBe(true);
    expect(formatLadderCoverage(atpLive)).toContain("WS_CUE");
  });
});

describe("event-store provenance schema", () => {
  test("new databases expose provenance columns", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const eventCols = (db.query("PRAGMA table_info(events)").all() as Array<{ name: string }>).map(
      (r) => r.name,
    );
    expect(eventCols).toContain("source_url");
    expect(eventCols).toContain("fetched_ts");
    expect(eventCols).toContain("corpus");
    const marketCols = (db.query("PRAGMA table_info(markets)").all() as Array<{ name: string }>).map(
      (r) => r.name,
    );
    expect(marketCols).toContain("market_kind");
    expect(marketCols).toContain("source_url");
  });

  test("migrateEventStoreColumns is idempotent", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    migrateEventStoreColumns(db);
    migrateEventStoreColumns(db);
    const cols = (db.query("PRAGMA table_info(book_ticks)").all() as Array<{ name: string }>).map(
      (r) => r.name,
    );
    expect(cols).toContain("market_kind");
    expect(cols).toContain("source_url");
  });
});
