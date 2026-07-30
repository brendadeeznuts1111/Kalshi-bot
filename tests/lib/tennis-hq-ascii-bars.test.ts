import { describe, expect, test } from "bun:test";
import {
  bucketMidCents,
  chartLineVisibleWidths,
  chartRowsAligned,
  renderBarChart,
  renderMidDistribution,
} from "../../src/lib/tennis-hq/charts/ascii-bars.ts";

describe("renderBarChart alignment", () => {
  test("volume-by-series rows share visible width", () => {
    const data = [
      { label: "ATP", value: 3_200_000, raw: "3.2M" },
      { label: "WTA", value: 1_800_000, raw: "1.8M" },
      { label: "ITF W", value: 950_000, raw: "950K" },
      { label: "ITF M", value: 420_000, raw: "420K" },
    ];
    const out = renderBarChart(data, { labelWidth: 8, barWidth: 28, valueWidth: 8 });
    const widths = chartLineVisibleWidths(out);
    expect(widths.length).toBe(4);
    expect(chartRowsAligned(out)).toBe(true);
    // label(8) + " │"(2) + bar(28) + "│ "(2) + value(8) = 48
    expect(widths[0]).toBe(48);
    expect(out).toContain("ATP");
    expect(out).toContain("ITF W");
    expect(out).toContain("3.2M");
  });

  test("empty data → empty string", () => {
    expect(renderBarChart([])).toBe("");
  });
});

describe("bucketMidCents", () => {
  test("groups into five ranges with pct sum ~100", () => {
    const mids = [
      ...Array(10).fill(10),
      ...Array(10).fill(30),
      ...Array(10).fill(50),
      ...Array(10).fill(70),
      ...Array(10).fill(90),
    ];
    const b = bucketMidCents(mids);
    expect(b).toHaveLength(5);
    expect(b.every((x) => x.count === 10)).toBe(true);
    expect(b.reduce((s, x) => s + x.pct, 0)).toBe(100);
  });
});

describe("renderMidDistribution", () => {
  test("mid buckets align", () => {
    const buckets = [
      { range: "1–20¢", count: 124, pct: 35 },
      { range: "21–40¢", count: 89, pct: 25 },
      { range: "41–60¢", count: 67, pct: 19 },
      { range: "61–80¢", count: 45, pct: 13 },
      { range: "81–99¢", count: 28, pct: 8 },
    ];
    const out = renderMidDistribution(buckets, 42);
    expect(out).toContain("Mid distribution");
    expect(chartRowsAligned(out)).toBe(true);
    const dataWidths = chartLineVisibleWidths(out);
    expect(dataWidths.length).toBe(5);
    expect(new Set(dataWidths).size).toBe(1);
  });
});
