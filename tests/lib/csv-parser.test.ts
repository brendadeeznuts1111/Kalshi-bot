// Production-grade CSV parsing tests (§69) — the streaming state machine
// handles quoted fields, escaped quotes, embedded newlines, CRLF.
import { describe, expect, test } from "bun:test";
import { parseCsvAll, parseTennisDataCsv } from "../../src/institutions/event-store/parse-tennis-data-csv.ts";

describe("parseCsvAll streaming parser (§69)", () => {
  test("basic rows + header", () => {
    expect(parseCsvAll("a,b\n1,2\n3,4")).toEqual([["a", "b"], ["1", "2"], ["3", "4"]]);
  });

  test("quoted field with embedded newline is ONE field", () => {
    const rows = parseCsvAll("a,b,c\n\"x\ny\",2,3\nd,e,f");
    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual(["x\ny", "2", "3"]);
  });

  test("escaped double quotes + commas inside quotes", () => {
    const rows = parseCsvAll("h1,h2\r\n\"a,\"\"b\",v\r\nq,r");
    expect(rows[0]).toEqual(["h1", "h2"]);
    expect(rows[1]).toEqual(["a,\"b", "v"]);
    expect(rows[2]).toEqual(["q", "r"]);
  });

  test("blank lines are skipped", () => {
    expect(parseCsvAll("a,b\n\n\n1,2\n")).toEqual([["a", "b"], ["1", "2"]]);
  });

  test("CRLF handled (\r\n as one row end)", () => {
    expect(parseCsvAll("a,b\r\n1,2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("parseTennisDataCsv with streaming parser (§69)", () => {
  test("real tennis-data shape still parses (regression)", () => {
    const csv = "date,winner,loser,tournament,round,surface,series\n01/01/2024,AAA,BBB,Cup,F,Clay,ATP\n02/01/2024,CCC,DDD,Cup,S,Grass,ATP";
    const matches = parseTennisDataCsv(csv, "atp_2024.csv");
    expect(matches).toHaveLength(2);
    expect(String((matches[0] as unknown as { winner: unknown }).winner)).toBe("AAA");
  });

  test("embedded newline in a quoted field survives the full pipeline", () => {
    // The quoted loser field carries an embedded newline; the date stays clean
    // so the row is valid. The old split-by-line parser would have split this
    // into two rows and dropped both (broken field alignment).
    const csv = "date,winner,loser,tournament,round,surface,series\n01/01/2024,AAA,\"B\nBB\",Cup,F,Clay,ATP";
    const matches = parseTennisDataCsv(csv, "atp_2024.csv");
    expect(matches).toHaveLength(1);
    expect(String((matches[0] as unknown as { winner: unknown }).winner)).toBe("AAA");
    expect(String((matches[0] as unknown as { loser: unknown }).loser)).toBe("B\nBB");
  });
});