// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import { joinPath } from "../../src/research/paths.ts";
import {
  ingestPrimaryResultMatches,
  repairStadionToursFromLevel,
} from "../../src/institutions/event-store/ingest-primary-results.ts";
import {
  itfStadionDayUrl,
  parseItfStadionDayWire,
  tourFromStadionLevel,
} from "../../src/institutions/event-store/itf-stadion.ts";
import { openEventStore } from "../../src/institutions/event-store/open-db.ts";
import { asCanonicalEventId } from "../../src/institutions/event-store/types.ts";

const FIXTURE = joinPath(import.meta.dir, "../fixtures/itf-stadion-day.json");

describe("itf-stadion primary collector", () => {
  test("day URL uses dashed ISO date", () => {
    expect(itfStadionDayUrl("2026-07-21")).toBe(
      "https://api.itf-production.sports-data.stadion.io/custom/wttCompleteMatchList/2026-07-21",
    );
    expect(() => itfStadionDayUrl("20260721")).toThrow();
  });

  test("tourFromStadionLevel: level-only + tennisId prefix", () => {
    expect(tourFromStadionLevel("itf pro wtt - women's 15")).toBe("ITF-W");
    expect(tourFromStadionLevel("W100")).toBe("ITF-W");
    expect(tourFromStadionLevel("M15")).toBe("ITF-M");
    expect(tourFromStadionLevel("itf pro wtt - men's 15")).toBe("ITF-M");
    // Never classify women via /men/ substring.
    expect(tourFromStadionLevel("women")).toBe("ITF-W");
    expect(tourFromStadionLevel("women's singles")).toBe("ITF-W");
    // tennisId wins over conflicting level text.
    expect(tourFromStadionLevel("men", "W-AUT-01A-2026")).toBe("ITF-W");
    expect(tourFromStadionLevel("women", "M-AUT-01A-2026")).toBe("ITF-M");
    expect(tourFromStadionLevel("unknown")).toBe("ITF");
  });

  test("parse fixture yields completed singles with provenance fields", async () => {
    const wire = await Bun.file(FIXTURE).json();
    const matches = parseItfStadionDayWire(wire, {
      sourceUrl: itfStadionDayUrl("2026-07-21"),
      fetchedTs: 1_700_000_000_000,
    });
    expect(matches.length).toBeGreaterThanOrEqual(2);
    const singles = matches.filter((m) => m.format === "singles");
    expect(singles.length).toBeGreaterThanOrEqual(2);
    for (const m of singles) {
      expect(m.winner).toBeTruthy();
      expect(m.loser).toBeTruthy();
      expect(m.winner).not.toBe(m.loser);
      expect(m.sourceMatchId).toMatch(/^[0-9a-f-]{36}$/i);
      expect(m.sourceUrl).toContain("wttCompleteMatchList");
      expect(m.fetchedTs).toBe(1_700_000_000_000);
      expect(m.tour === "ITF-M" || m.tour === "ITF-W" || m.tour === "ITF").toBe(true);
    }
    // W100 Amstetten must not classify as ITF-M via /men/ matching "women".
    const amstetten = singles.find((m) => /amstetten/i.test(m.tournament));
    expect(amstetten?.tour).toBe("ITF-W");
  });

  test("ingest writes trading corpus + provenance; re-collect upserts tour", async () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const wire = await Bun.file(FIXTURE).json();
    const matches = parseItfStadionDayWire(wire, {
      sourceUrl: itfStadionDayUrl("2026-07-21"),
      fetchedTs: 42,
    });
    const first = ingestPrimaryResultMatches(db, matches, { format: "singles" });
    expect(first.eventsInserted).toBeGreaterThan(0);
    expect(first.eventsUpdated).toBe(0);
    const row = db
      .query(
        `SELECT corpus, source, source_url, fetched_ts, score_text, winner FROM events LIMIT 1`,
      )
      .get() as {
      corpus: string;
      source: string;
      source_url: string;
      fetched_ts: number;
      score_text: string;
      winner: string;
    };
    expect(row.corpus).toBe("trading");
    expect(row.source).toBe("itf-stadion");
    expect(row.source_url).toContain("2026-07-21");
    expect(row.fetched_ts).toBe(42);
    expect(row.winner).toBeTruthy();

    // Poison a women's row to ITF-M, then re-ingest with corrected match.
    const target = matches.find((m) => m.format === "singles" && m.tour === "ITF-W");
    expect(target).toBeTruthy();
    db.query(`UPDATE events SET tour = 'ITF-M' WHERE event_id = $id`).run({
      $id: target!.eventId,
    });
    expect(
      (db.query(`SELECT tour FROM events WHERE event_id = $id`).get({ $id: target!.eventId }) as {
        tour: string;
      }).tour,
    ).toBe("ITF-M");

    const corrected = { ...target!, fetchedTs: 99, scoreText: "6-0 6-1" };
    const second = ingestPrimaryResultMatches(db, [corrected], { format: "singles" });
    expect(second.eventsInserted).toBe(0);
    expect(second.eventsUpdated).toBe(1);
    const fixed = db
      .query(`SELECT tour, score_text, fetched_ts FROM events WHERE event_id = $id`)
      .get({ $id: target!.eventId }) as { tour: string; score_text: string; fetched_ts: number };
    expect(fixed.tour).toBe("ITF-W");
    expect(fixed.score_text).toBe("6-0 6-1");
    expect(fixed.fetched_ts).toBe(99);
  });

  test("repairStadionToursFromLevel fixes poisoned tour from level text", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    const now = Date.now();
    const eventId = asCanonicalEventId("a".repeat(32));
    db.query(
      `INSERT INTO events (
        event_id, tour, level, tournament, location, surface, court, round, best_of,
        player_a, player_b, winner, loser, start_ts, outcome, score_text,
        source, source_url, fetched_ts, source_row_hash, ingested_at, corpus
      ) VALUES (
        $event_id, 'ITF-M', $level, 'WTT Poison', '', 'Clay', '', 'unknown', NULL,
        'A Player', 'B Player', 'A Player', 'B Player', '2026-07-21T12:00:00.000Z',
        'completed', '6-3 6-2', 'itf-stadion', '', $now, $hash, $now, 'trading'
      )`,
    ).run({
      $event_id: eventId,
      $level: "itf pro wtt - women's 15",
      $now: now,
      $hash: "repair-test-hash",
    });

    const summary = repairStadionToursFromLevel(db);
    expect(summary.scanned).toBe(1);
    expect(summary.updated).toBe(1);
    expect(
      (db.query(`SELECT tour FROM events WHERE event_id = $id`).get({ $id: eventId }) as {
        tour: string;
      }).tour,
    ).toBe("ITF-W");
  });
});
