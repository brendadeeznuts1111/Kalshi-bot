// @see https://bun.com/docs/test
import { describe, expect, test } from "bun:test";
import {
  formatSummaryCsv,
  parseWarehouseSummaryArgv,
  printWarehouseHelp,
} from "../scripts/warehouse-summary.ts";
import type { EventStoreSummaryRow } from "../src/institutions/event-store/types.ts";

describe("tennis-warehouse CLI", () => {
  test("parseWarehouseSummaryArgv defaults", () => {
    const opts = parseWarehouseSummaryArgv([]);
    expect(opts.format).toBe("table");
    expect(opts.dbPath).toBeUndefined();
    expect(opts.help).toBe(false);
  });

  test("parseWarehouseSummaryArgv --db --format --json", () => {
    expect(parseWarehouseSummaryArgv(["--db", "./x.db"]).dbPath).toBe("./x.db");
    expect(parseWarehouseSummaryArgv(["--format", "csv"]).format).toBe("csv");
    expect(parseWarehouseSummaryArgv(["--json"]).format).toBe("json");
    expect(parseWarehouseSummaryArgv(["--help"]).help).toBe(true);
    expect(parseWarehouseSummaryArgv(["-h"]).help).toBe(true);
  });

  test("formatSummaryCsv headers and rows", () => {
    const rows: EventStoreSummaryRow[] = [
      { tour: "ATP", surface: "hard", year: "2024", count: 12 },
      { tour: "WTA", surface: "clay", year: "2023", count: 3 },
    ];
    const csv = formatSummaryCsv(rows);
    expect(csv.startsWith("tour,surface,year,count\n")).toBe(true);
    expect(csv).toContain("ATP,hard,2024,12");
    expect(csv).toContain("WTA,clay,2023,3");
  });

  test("printWarehouseHelp is non-throwing", () => {
    printWarehouseHelp();
  });
});
