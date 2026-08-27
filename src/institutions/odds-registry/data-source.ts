/**
 * data-source.ts — Odds Heat event source resolver.
 *
 * Priority: live bookmaker feeds (opt-in via ODDS_LIVE_FEED=1 or opts.live)
 * → the local reference XML feed. Live results arrive per book (each
 * `connectBookmaker` result quotes one book) and are MERGED into shared
 * events by match identity — commence + home/away — so multi-book consensus
 * forms across separate feeds. Identity-less events stay standalone.
 *
 * Every failure mode degrades down the ladder: live error/empty → reference
 * feed → declarations_only. The route never fails on a dead feed.
 */
import type { OddsEvent } from "../../alpha/odds-types.ts";
import { connectAllBookmakers, type FeedClientResult } from "./feed-client.ts";
import { parseOddsXmlEvents } from "./xml-feed.ts";
import type { OddsRegistryConfig } from "./types.ts";

export type ReportDataState = "live" | "reference_feed" | "declarations_only";

export type ReportEvents = {
  events: OddsEvent[];
  dataState: ReportDataState;
  /** Human-readable provenance line for the report header. */
  sourceDetail: string;
};

export type LoadReportEventsOptions = {
  /** Enable the live ladder (default: ODDS_LIVE_FEED=1 env). */
  live?: boolean;
  /** Injectable live fetch (tests). Defaults to connectAllBookmakers. */
  fetchLive?: typeof connectAllBookmakers;
  sportKey?: string;
  market?: string;
};

const PLACEHOLDER_TEAMS = new Set(["Home", "Away"]);

const hasMatchIdentity = (ev: OddsEvent) =>
  ev.commenceTime !== "0" && (!PLACEHOLDER_TEAMS.has(ev.homeTeam) || !PLACEHOLDER_TEAMS.has(ev.awayTeam));

/**
 * Merge per-book event lists into shared events by match identity
 * (commence + home + away). Bookmaker entries are concatenated; the first
 * occurrence supplies the event-level fields (location/weather/source).
 */
export function mergeFeedEvents(lists: OddsEvent[][]): OddsEvent[] {
  const byMatch = new Map<string, OddsEvent>();
  const standalone: OddsEvent[] = [];
  for (const list of lists) {
    for (const ev of list) {
      if (!hasMatchIdentity(ev)) {
        standalone.push(ev);
        continue;
      }
      const matchKey = `${ev.commenceTime}|${ev.homeTeam}|${ev.awayTeam}`;
      const existing = byMatch.get(matchKey);
      if (existing) {
        existing.bookmakers.push(...ev.bookmakers);
      } else {
        byMatch.set(matchKey, { ...ev, bookmakers: [...ev.bookmakers] });
      }
    }
  }
  return [...byMatch.values(), ...standalone];
}

const liveEnabled = (opts: LoadReportEventsOptions) => opts.live ?? Bun.env.ODDS_LIVE_FEED === "1";

/**
 * Resolve the report's event source. Live ladder first (when enabled), then
 * the reference feed, else declarations_only — the caller renders whatever
 * comes back without branching.
 */
export async function loadReportEvents(
  root: string,
  cfg: OddsRegistryConfig,
  opts: LoadReportEventsOptions = {},
): Promise<ReportEvents> {
  const sportKey = opts.sportKey ?? "soccer_epl";
  const market = opts.market ?? "h2h";

  if (liveEnabled(opts)) {
    try {
      const fetchLive = opts.fetchLive ?? connectAllBookmakers;
      const results = await fetchLive(cfg, sportKey, { market });
      const lists = results.filter((r) => r.events.length > 0).map((r) => r.events);
      const events = mergeFeedEvents(lists);
      if (events.length > 0) {
        const books = results.filter((r) => r.events.length > 0).length;
        return {
          events,
          dataState: "live",
          sourceDetail: `${books} book feed(s) live`,
        };
      }
    } catch {
      // live ladder failed — fall through to the reference feed
    }
  }

  const feedFile = Bun.file(root + "/public/registry/odds-reference.xml");
  if (await feedFile.exists()) {
    const events = parseOddsXmlEvents(await feedFile.text(), { sportKey, market });
    if (events.length > 0) {
      return { events, dataState: "reference_feed", sourceDetail: "reference feed" };
    }
  }
  return { events: [], dataState: "declarations_only", sourceDetail: "" };
}

/** Re-exported for callers that want the wire type without importing the client. */
export type { FeedClientResult };
