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

/** Compact resting depth: underdog ask / favorite ask (contracts). */
export function formatDepthColumn(row: ItfCalendarRow): string {
  const und = row.legs.find((l) => l.label === row.underdogLabel) ?? row.legs[row.legs.length - 1];
  const fav = row.legs.find((l) => l.label === row.favoriteLabel) ?? row.legs[0];
  const undAsk =
    und?.askDepthTop3 != null ? und.askDepthTop3 : (und?.yesAskSize ?? row.underdogAskSize);
  const favAsk =
    fav?.askDepthTop3 != null ? fav.askDepthTop3 : (fav?.yesAskSize ?? row.favoriteAskSize);
  const suffix = und?.askDepthTop3 != null || fav?.askDepthTop3 != null ? "Σ3" : "t1";
  return `${formatVolumeFp(undAsk)}/${formatVolumeFp(favAsk)} ${suffix}`;
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
    `Open: ${stats.openLegs} legs · ${stats.openEvents} events · vol24h ${formatVolumeFp(stats.totalVolume24hFp)} · lifetime ${formatVolumeFp(stats.totalVolumeFp)}`,
    `Series: ${series}`,
    `Dates: ${dates}`,
  ].join("\n");
}

export function formatItfCalendarTable(rows: ItfCalendarRow[]): string {
  const lines = [
    "Start (UTC)          Tour    Vol24h   Depth        Und   Fav   Matchup",
    "-------------------  ------  -------  -----------  ----  ----  -------",
  ];
  for (const row of rows) {
    const start = row.startTs.slice(0, 16).replace("T", " ");
    const vol = formatVolumeFp(row.totalVolume24hFp).padStart(7);
    const depth = formatDepthColumn(row).padEnd(11);
    const und = formatCents(row.underdogMidCents).padStart(4);
    const fav = formatCents(row.favoriteMidCents).padStart(4);
    const matchup =
      row.matchup.length > 48 ? `${row.matchup.slice(0, 45)}…` : row.matchup;
    lines.push(
      `${start.padEnd(19)}  ${row.tour.padEnd(6)}  ${vol}  ${depth}  ${und}  ${fav}  ${matchup}`,
    );
  }
  return lines.join("\n");
}

export function formatItfEventDetail(row: ItfCalendarRow): string {
  const lines = [
    row.eventTicker,
    `${row.matchup} · ${row.tour} · ${row.series}`,
    `Start: ${row.startTs} · Status: ${row.status}`,
    `Flow: vol24h ${formatVolumeFp(row.totalVolume24hFp)} · lifetime ${formatVolumeFp(row.totalVolumeFp)} · tradableScore ${row.tradableScore.toFixed(1)}`,
    `Watch: und ${formatCents(row.underdogMidCents)} (${row.underdogLabel ?? "—"}) · fav ${formatCents(row.favoriteMidCents)} spread ${formatCents(row.favoriteSpreadCents)}`,
    `Depth (und/fav ask): ${formatDepthColumn(row)}`,
    "",
    "Legs:",
  ];
  for (const leg of row.legs) {
    const depth =
      leg.askDepthTop3 != null
        ? `bidΣ3=${formatVolumeFp(leg.bidDepthTop3 ?? 0)} askΣ3=${formatVolumeFp(leg.askDepthTop3)}`
        : `bid=${formatVolumeFp(leg.yesBidSize)} ask=${formatVolumeFp(leg.yesAskSize)}`;
    lines.push(
      `  ${leg.sideCode.padEnd(8)} ${formatCents(leg.yesBidCents)}/${formatCents(leg.yesAskCents)}  vol24h ${formatVolumeFp(leg.volume24hFp).padStart(6)}  ${depth}  ${leg.label}`,
    );
    lines.push(`           ${leg.ticker}`);
    if (leg.competitorId) lines.push(`           competitor ${leg.competitorId}`);
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
