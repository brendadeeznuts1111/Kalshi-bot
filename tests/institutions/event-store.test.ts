// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { joinPath } from "../../src/research/paths.ts";
import { mintCanonicalEventId, sortPlayerPair, winnerOutcomeBit } from "../../src/institutions/event-store/event-id.ts";
import { ingestTennisHistoryFiles, ingestTennisHistoryMatches } from "../../src/institutions/event-store/ingest-tennis-history.ts";
import { openEventStore } from "../../src/institutions/event-store/open-db.ts";
import {
  parseTennisDataCsv,
  parseTennisDataDate,
} from "../../src/institutions/event-store/parse-tennis-data-csv.ts";
import {
  countEvents,
  countOddsTicks,
  summarizeEventsByTourSurfaceYear,
} from "../../src/institutions/event-store/summary.ts";

const FIXTURE_ATP = joinPath(import.meta.dir, "../fixtures/tennis-data/sample-atp.csv");
const FIXTURE_WTA = joinPath(import.meta.dir, "../fixtures/tennis-data/sample-wta.csv");

describe("event-store tennis history", () => {
  test("parseTennisDataDate accepts DD/MM/YYYY", () => {
    expect(parseTennisDataDate("01/07/2019")).toBe("2019-07-01T12:00:00.000Z");
  });

  test("mintCanonicalEventId is stable for player order", () => {
    const [a, b] = sortPlayerPair("Roger Federer", "John Isner");
    const left = mintCanonicalEventId({
      tour: "ATP",
      startTs: "2019-07-01T12:00:00.000Z",
      tournament: "Wimbledon",
      round: "R32",
      playerA: a,
      playerB: b,
    });
    const [c, d] = sortPlayerPair("John Isner", "Roger Federer");
    const right = mintCanonicalEventId({
      tour: "ATP",
      startTs: "2019-07-01T12:00:00.000Z",
      tournament: "Wimbledon",
      round: "R32",
      playerA: c,
      playerB: d,
    });
    expect(left).toBe(right);
  });

  test("parse sample ATP CSV yields three matches with pinnacle odds", async () => {
    const text = await Bun.file(FIXTURE_ATP).text();
    const rows = parseTennisDataCsv(text, "sample-atp.csv");
    expect(rows.length).toBe(3);
    expect(rows.every((r) => r.pinnacle.winner != null && r.pinnacle.loser != null)).toBe(true);
    expect(rows.map((r) => r.surface).sort()).toEqual(["Clay", "Grass", "Hard"]);
  });

  test("ingest enforces match-level uniqueness and loads odds + resolutions", async () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const atp = parseTennisDataCsv(await Bun.file(FIXTURE_ATP).text(), "sample-atp.csv");
    const wta = parseTennisDataCsv(await Bun.file(FIXTURE_WTA).text(), "sample-wta.csv");
    const all = [...atp, ...wta];

    const first = ingestTennisHistoryMatches(db, all);
    expect(first.eventsInserted).toBe(4);
    expect(first.oddsInserted).toBe(16);
    expect(first.resolutionsInserted).toBe(4);
    expect(countEvents(db)).toBe(4);
    expect(countOddsTicks(db)).toBe(16);

    const dup = ingestTennisHistoryMatches(db, all);
    expect(dup.eventsInserted).toBe(0);
    expect(dup.eventsSkipped).toBe(4);

    const summary = summarizeEventsByTourSurfaceYear(db);
    expect(summary.some((r) => r.tour === "ATP" && r.surface === "Grass" && r.year === "2019")).toBe(true);
    expect(summary.some((r) => r.tour === "WTA" && r.surface === "Grass")).toBe(true);
  });

  test("winnerOutcomeBit maps to player_a/player_b", () => {
    const [a, b] = sortPlayerPair("Roger Federer", "John Isner");
    expect(a).toBe("John Isner");
    expect(b).toBe("Roger Federer");
    expect(winnerOutcomeBit("Roger Federer", a, b)).toBe(0);
    expect(winnerOutcomeBit("John Isner", a, b)).toBe(1);
  });

  test("ingestTennisHistoryFiles reads fixture paths", async () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const summary = await ingestTennisHistoryFiles(db, [FIXTURE_ATP, FIXTURE_WTA]);
    expect(summary.filesRead).toBe(2);
    expect(summary.eventsInserted).toBe(4);
  });
});
