/**
 * Automatic Massey edge flags: Massey-implied probability vs live book odds.
 *
 * For each priced book event, crossref against Massey snapshots (reusing
 * crossrefBookEvent), compute the per-side edge (masseyEdge), and emit a
 * flag when the absolute edge meets the configured threshold. Positive
 * edge = the Massey model prices the side stronger than the book does.
 *
 * Odds source: `PricedBookEvent` carries the book's latest decimal odds per
 * side. The store layer (event-store/odds-ticks-store) fills these from the
 * `odds_ticks` table (the live-odds persistence contract: sides 'home' /
 * 'away' under the skin's odds_event_id).
 *
 * @see src/institutions/massey/crossref.ts — team matching
 * @see src/institutions/massey/edge.ts — edge math
 */
import {
  crossrefBookEvent,
  type BookSkinEvent,
  type MatchQuality,
} from "./crossref.ts";
import type { MasseyRatingRow } from "./parse.ts";
import { masseyEdge } from "./edge.ts";

/** A book event with the latest live decimal odds per side (null = no price). */
export type PricedBookEvent = BookSkinEvent & {
  homeDecimal: number | null;
  awayDecimal: number | null;
  /** Millisecond epoch of the odds capture (null when unavailable). */
  asOf: number | null;
};

export type EdgeFlagSide = {
  team: string;
  quality: MatchQuality;
  masseyProb: number;
  lineProb: number;
  /** Signed edge in percentage points (masseyProb - lineProb) * 100. */
  edgePct: number;
  decimal: number;
};

export type EdgeFlag = {
  league: string;
  home: string;
  away: string;
  competitionId: string | null;
  asOf: number | null;
  homeSide: EdgeFlagSide | null;
  awaySide: EdgeFlagSide | null;
  /** Signed max |edge| across both sides, in percentage points. */
  maxEdgePct: number;
  side: "home" | "away";
};

function buildSide(
  masseyProb: number | null,
  match: { team: string; quality: MatchQuality } | null,
  decimal: number | null,
): EdgeFlagSide | null {
  if (match == null || decimal == null) return null;
  const e = masseyEdge(masseyProb, decimal);
  if (e == null) return null;
  return {
    team: match.team,
    quality: match.quality,
    masseyProb: e.implied,
    lineProb: e.lineImplied,
    edgePct: e.edge * 100,
    decimal,
  };
}

export type EdgeFlagsOptions = {
  /** Flag when |edge| >= thresholdPct (fraction; default 0.05 = 5pp). */
  thresholdPct?: number;
};

/**
 * Compute edge flags over priced book events. Only covered events with at
 * least one usable side are considered; results sorted by |edge| desc.
 */
export function computeEdgeFlags(
  events: PricedBookEvent[],
  masseyByTarget: Map<string, MasseyRatingRow[]>,
  opts: EdgeFlagsOptions = {},
): EdgeFlag[] {
  const threshold = (opts.thresholdPct ?? 0.05) * 100;
  const flags: EdgeFlag[] = [];
  for (const ev of events) {
    const row = crossrefBookEvent(ev, masseyByTarget);
    if (!row.covered) continue;
    const homeSide = buildSide(row.homeWinPct, row.homeMatch, ev.homeDecimal);
    const awaySide = buildSide(row.awayWinPct, row.awayMatch, ev.awayDecimal);
    if (homeSide == null && awaySide == null) continue;
    const sides = [homeSide, awaySide].filter((s): s is EdgeFlagSide => s != null);
    const max = sides.reduce((a, b) => (Math.abs(b.edgePct) > Math.abs(a.edgePct) ? b : a));
    if (Math.abs(max.edgePct) < threshold) continue;
    flags.push({
      league: row.bookLeague,
      home: row.bookHome,
      away: row.bookAway,
      competitionId: row.competitionId,
      asOf: ev.asOf,
      homeSide,
      awaySide,
      maxEdgePct: max.edgePct,
      side: homeSide === max ? "home" : "away",
    });
  }
  return flags.sort((a, b) => Math.abs(b.maxEdgePct) - Math.abs(a.maxEdgePct));
}

export type EdgeFlagsArtifactMeta = {
  sport: string;
  thresholdPct: number;
  generatedAt: string;
};

export function formatEdgeFlagsJson(
  flags: EdgeFlag[],
  meta: EdgeFlagsArtifactMeta,
): string {
  return JSON.stringify({
    kind: "massey-edge-flags",
    schemaVersion: 1,
    sport: meta.sport,
    thresholdPct: meta.thresholdPct,
    generatedAt: meta.generatedAt,
    count: flags.length,
    flags,
  }, null, 2) + "\n";
}

function mdCell(v: string | number | null): string {
  const s = v == null ? "-" : String(v);
  return s.replace(/\|/g, "\\|");
}

export function formatEdgeFlagsMarkdown(
  flags: EdgeFlag[],
  meta: EdgeFlagsArtifactMeta,
): string {
  const head = [
    "# Massey edge flags — " + meta.sport,
    "",
    "Generated " + meta.generatedAt + " · threshold |edge| ≥ " +
      (meta.thresholdPct * 100).toFixed(1) + "% · " + flags.length + " flag(s)",
    "",
    "| League | Home | Massey | Line | Away | Massey | Line | Edge% | Side |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  const body = flags.map((f) => {
    const hs = f.homeSide;
    const as = f.awaySide;
    return [
      mdCell(f.league),
      mdCell(f.home),
      mdCell(hs ? hs.masseyProb.toFixed(3) : null),
      mdCell(hs ? hs.decimal.toFixed(2) : null),
      mdCell(f.away),
      mdCell(as ? as.masseyProb.toFixed(3) : null),
      mdCell(as ? as.decimal.toFixed(2) : null),
      mdCell((f.side === "home" ? hs : as)?.edgePct.toFixed(1) + ""),
      f.side,
    ].join("|");
  });
  return head.concat(body, [""]).join("\n");
}
