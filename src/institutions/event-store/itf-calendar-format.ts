import type { ItfCalendarRow, ItfCalendarStats } from "./itf-calendar.ts";

export function formatVolumeFp(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return value.toFixed(0);
}

export function formatCents(cents: number | null): string {
  if (cents == null) return "—";
  return `${cents}¢`;
}

export function formatItfStats(stats: ItfCalendarStats): string {
  const series = Object.entries(stats.bySeries)
    .sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `${s}:${n}`)
    .join("  ");
  const dates = Object.entries(stats.byDate)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([d, n]) => `${d}:${n}`)
    .join("  ");
  return [
    `Open: ${stats.openLegs} legs · ${stats.openEvents} events · $${formatVolumeFp(stats.totalVolumeFp)} total vol`,
    `Series: ${series}`,
    `Dates: ${dates}`,
  ].join("\n");
}

export function formatItfCalendarTable(rows: ItfCalendarRow[]): string {
  const lines = [
    "Start (UTC)          Tour    Vol$     Fav   Matchup",
    "-------------------  ------  -------  ----  -------",
  ];
  for (const row of rows) {
    const start = row.startTs.slice(0, 16).replace("T", " ");
    const vol = formatVolumeFp(row.totalVolumeFp).padStart(7);
    const fav = formatCents(row.favoriteMidCents).padStart(4);
    const matchup =
      row.matchup.length > 52 ? `${row.matchup.slice(0, 49)}…` : row.matchup;
    lines.push(
      `${start.padEnd(19)}  ${row.tour.padEnd(6)}  ${vol}  ${fav}  ${matchup}`,
    );
  }
  return lines.join("\n");
}

export function formatItfEventDetail(row: ItfCalendarRow): string {
  const lines = [
    row.eventTicker,
    `${row.matchup} · ${row.tour} · ${row.series}`,
    `Start: ${row.startTs} · Vol: $${formatVolumeFp(row.totalVolumeFp)} · Status: ${row.status}`,
    "",
    "Legs:",
  ];
  for (const leg of row.legs) {
    lines.push(
      `  ${leg.sideCode.padEnd(8)} ${formatCents(leg.yesBidCents)}/${formatCents(leg.yesAskCents)}  $${formatVolumeFp(leg.volumeFp).padStart(6)}  ${leg.label}`,
    );
    lines.push(`           ${leg.ticker}`);
  }
  lines.push("", "Record:", `  bun run tennis:record -- --event=${row.eventTicker}`);
  return lines.join("\n");
}

export function formatItfCalendarByDate(rows: ItfCalendarRow[]): string {
  const byDate = new Map<string, ItfCalendarRow[]>();
  for (const row of rows) {
    const list = byDate.get(row.startDate) ?? [];
    list.push(row);
    byDate.set(row.startDate, list);
  }
  const sections: string[] = [];
  for (const date of [...byDate.keys()].sort()) {
    const dayRows = byDate.get(date)!;
    sections.push(`## ${date} (${dayRows.length} events)`);
    sections.push(formatItfCalendarTable(dayRows));
    sections.push("");
  }
  return sections.join("\n").trimEnd();
}
