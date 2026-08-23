/**
 * Aligned horizontal bar charts for terminal output (tennis HQ).
 * Labels left-padded, values right-padded; bar segment fixed visual width
 * so │ rails line up across rows.
 *
 * @see https://bun.com/docs/runtime/utils#bun-stringwidth
 * @see https://bun.com/docs/runtime/utils#bun-stripansi
 */

import { c, pad } from "../utils/terminal.ts";

export interface BarDatum {
  label: string;
  value: number;
  /** Optional display override (e.g. "3.2M"). */
  raw?: string;
}

export interface BarChartOptions {
  /** Reserved for future full-width layout; barWidth drives bar segment. */
  width?: number;
  /** Max filled+empty bar segment width (visible chars). */
  barWidth?: number;
  unit?: string;
  /** ANSI open code for filled bars (default green). */
  color?: string;
  /** Fixed label column width (visible). */
  labelWidth?: number;
  /** Fixed value column width (visible). */
  valueWidth?: number;
}

/**
 * Render a horizontal bar chart with aligned columns:
 *   `LABEL │████░░░░│  VALUE`
 */
export function renderBarChart(
  data: BarDatum[],
  options: BarChartOptions = {},
): string {
  const {
    barWidth = 30,
    unit = "",
    color = c.green,
    labelWidth = 10,
    valueWidth = 8,
  } = options;

  if (!data.length) return "";

  const maxVal = Math.max(...data.map((d) => d.value), 0);
  const lines: string[] = [];

  for (const d of data) {
    const pct = maxVal > 0 ? d.value / maxVal : 0;
    const filled = Math.min(barWidth, Math.max(0, Math.round(pct * barWidth)));
    const empty = barWidth - filled;

    const bar =
      `${color}${"█".repeat(filled)}${c.dim}${"░".repeat(empty)}${c.reset}`;
    const valStr = d.raw ?? `${d.value.toLocaleString()}${unit}`;
    const label = pad(d.label, labelWidth, "left");
    const value = pad(valStr, valueWidth, "right");

    lines.push(`${label} │${bar}│ ${value}`);
  }

  return lines.join("\n");
}

/** Bucket mid prices (cents 1–99) into fixed ranges for charts / CLI. */
export function bucketMidCents(
  mids: readonly number[],
): Array<{ range: string; count: number; pct: number }> {
  const ranges: Array<{ range: string; lo: number; hi: number }> = [
    { range: "1–20¢", lo: 1, hi: 20 },
    { range: "21–40¢", lo: 21, hi: 40 },
    { range: "41–60¢", lo: 41, hi: 60 },
    { range: "61–80¢", lo: 61, hi: 80 },
    { range: "81–99¢", lo: 81, hi: 99 },
  ];
  const counts = ranges.map(() => 0);
  let n = 0;
  for (const m of mids) {
    if (!Number.isFinite(m)) continue;
    const c = Math.round(m);
    if (c < 1 || c > 99) continue;
    n++;
    const i = ranges.findIndex((r) => c >= r.lo && c <= r.hi);
    if (i >= 0) counts[i]!++;
  }
  return ranges.map((r, i) => ({
    range: r.range,
    count: counts[i]!,
    pct: n > 0 ? Math.round((counts[i]! / n) * 100) : 0,
  }));
}

export function renderMidDistribution(
  buckets: Array<{ range: string; count: number; pct: number }>,
  width = 40,
): string {
  const labelW = 10;
  // width ≈ label + " │" + bar + "│ " + value(6) — keep bar as remaining
  const valueW = 6;
  const chrome = 2 + 1 + 2; // " │" + "│ "
  const barW = Math.max(8, width - labelW - chrome - valueW);

  const lines: string[] = [];
  lines.push(
    `${c.bold}Mid distribution${c.reset}  ${c.dim}(latest book_ticks mid cents)${c.reset}`,
  );
  lines.push("");

  for (const b of buckets) {
    const filled = Math.min(
      barW,
      Math.max(0, Math.round((b.pct / 100) * barW)),
    );
    const bar =
      `${c.cyan}${"█".repeat(filled)}${c.dim}${"░".repeat(barW - filled)}${c.reset}`;
    const label = pad(b.range, labelW, "left");
    const count = pad(String(b.count), valueW, "right");
    lines.push(`${label} │${bar}│ ${count}`);
  }

  return lines.join("\n");
}

/** Visible widths of non-empty lines — for tests / alignment checks. */
export function chartLineVisibleWidths(chart: string): number[] {
  return chart
    .split("\n")
    .filter((l) => l.length > 0 && !l.includes("Mid distribution"))
    .map((l) => Bun.stringWidth(l));
}

/** True when all data rows share the same visible width. */
export function chartRowsAligned(chart: string): boolean {
  const widths = chartLineVisibleWidths(chart);
  if (!widths.length) return true;
  return widths.every((w) => w === widths[0]);
}
