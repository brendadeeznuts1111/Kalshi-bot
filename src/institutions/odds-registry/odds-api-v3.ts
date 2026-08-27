/**
 * odds-api-v3.ts — the Odds API v3 JSON feed adapter (name-based bookmakers).
 *
 * Fills the P2 json-adapter gap: the config declares 36 bookmakers on the
 * `odds-api-v3` feed, but until now the only JSON path was the alpha Pinnacle-
 * only v4 fetch. This adapter:
 *   - fetches /bookmakers (public, no auth — 276 total / 264 active, pinned)
 *   - fetches /odds?sport=<v3-slug>&markets=<key>&bookmakers=<names> with the
 *     apiKey (401 without — pinned)
 *   - normalizes the wire into the existing OddsEvent model
 *   - caches in the shared SQLite WAL odds_cache (alpha odds-feed pattern)
 *
 * Wire shapes (probed live 2026-08-27):
 *   GET /bookmakers -> [{ "name": "10BET", "active": true }, ...]
 *   GET /sports -> [{ "name": "Football", "slug": "football" }, ...]
 *   GET /odds?... -> 401 { "error": "You need to provide a valid apiKey" } without key
 */
import { Database } from "bun:sqlite";
import { asFeedEventId, type OddsEvent } from "../../alpha/odds-types.ts";
import type { OddsRegistryBookmaker } from "./types.ts";

export const ODDS_API_V3_BASE = "https://api.odds-api.io/v3";

/** v3 slug for each registry sport key (v4-style keys -> v3 slugs). */
export const V3_SPORT_MAP: Readonly<Record<string, string>> = {
  soccer_epl: "football",
  basketball_nba: "basketball",
  tennis_atp: "tennis",
  baseball_mlb: "baseball",
  hockey_nhl: "ice-hockey",
};

/** Reverse: v3 slug -> registry sport key (for parse normalization). */
export const V3_SLUG_TO_SPORT: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(V3_SPORT_MAP).map(([k, v]) => [v, k]),
) as Record<string, string>;

export type OddsApiV3Bookmaker = { name: string; active: boolean };

/** Fetch the public bookmaker list (no auth). Throws on failure. */
export async function fetchV3Bookmakers(fetchImpl: typeof fetch = fetch): Promise<OddsApiV3Bookmaker[]> {
  const res = await fetchImpl(ODDS_API_V3_BASE + "/bookmakers", { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error("v3 /bookmakers HTTP " + res.status);
  const j = (await res.json()) as unknown;
  if (!Array.isArray(j)) throw new Error("v3 /bookmakers: expected array, got " + typeof j);
  return j as OddsApiV3Bookmaker[];
}

/**
 * Fetch odds for one sport + market from the named bookmakers (max 30 names per
 * request — chunk larger sets). Requires ODDS_API_KEY. Normalizes into OddsEvent[].
 */
export async function fetchV3Odds(
  sportKey: string,
  names: string[],
  opts: {
    market?: string;
    apiKey?: string;
    fetchImpl?: typeof fetch;
    dbPath?: string;
    cacheMs?: number;
  } = {},
): Promise<{ events: OddsEvent[]; fromCache: boolean }> {
  const market = opts.market ?? "h2h";
  const apiKey = (opts.apiKey ?? Bun.env.ODDS_API_KEY)?.trim();
  if (!apiKey) throw new Error("ODDS_API_KEY required — v3 /odds 401s without it (pinned)");
  const slug = V3_SPORT_MAP[sportKey];
  if (!slug) throw new Error("no v3 slug for sport key: " + sportKey);
  const cacheKey = `v3/${sportKey}/${market}/${names.join("+")}`;
  const now = Date.now();

  let db: Database | null = null;
  if (opts.dbPath) {
    db = new Database(opts.dbPath, { create: true });
    db.run("PRAGMA journal_mode=WAL;");
    db.run("CREATE TABLE IF NOT EXISTS odds_cache (feed_key TEXT PRIMARY KEY, data TEXT NOT NULL, etag TEXT, fetched_at INTEGER NOT NULL)");
    const row = db.query("SELECT data, fetched_at FROM odds_cache WHERE feed_key = ?").get(cacheKey) as
      | { data: string; fetched_at: number }
      | undefined;
    const cacheMs = opts.cacheMs ?? 60_000;
    if (row && now - row.fetched_at < cacheMs) {
      const events = parseV3OddsWire(JSON.parse(row.data));
      db.close();
      return { events, fromCache: true };
    }
  }

  const params = new URLSearchParams({ apiKey, markets: market, bookmakers: names.join(",") });
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(ODDS_API_V3_BASE + "/odds?sport=" + encodeURIComponent(slug) + "&" + params.toString(), { signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    db?.close();
    throw new Error("v3 /odds HTTP " + res.status + ": " + (await res.text()).slice(0, 120));
  }
  const j = (await res.json()) as unknown;
  const events = parseV3OddsWire(j);
  if (db) {
    db.run("INSERT OR REPLACE INTO odds_cache (feed_key, data, etag, fetched_at) VALUES (?, ?, ?, ?)", [cacheKey, JSON.stringify(j), null, now]);
    db.close();
  }
  return { events, fromCache: false };
}

/**
 * Normalize the v3 /odds wire into OddsEvent[]. Wire shape (from docs + the
 * 401 probe): array of events with id/commence/home/away/bookmakers[].
 * Tolerant: skips malformed rows rather than throwing.
 */
export function parseV3OddsWire(wire: unknown): OddsEvent[] {
  if (!Array.isArray(wire)) return [];
  const out: OddsEvent[] = [];
  for (const row of wire) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const idRaw = typeof r.id === "string" ? r.id : null;
    const sportRaw = typeof r.sport === "string" ? r.sport : null;
    const commenceRaw = typeof r.commence === "string" ? r.commence : typeof r.commence_time === "string" ? r.commence_time : null;
    const homeRaw = typeof r.home === "string" ? r.home : typeof r.home_team === "string" ? r.home_team : null;
    const awayRaw = typeof r.away === "string" ? r.away : typeof r.away_team === "string" ? r.away_team : null;
    if (!idRaw || !commenceRaw || !homeRaw || !awayRaw) continue;
    const bookmakers = Array.isArray(r.bookmakers)
      ? (r.bookmakers as unknown[]).flatMap((b): OddsEvent["bookmakers"] => {
          if (!b || typeof b !== "object") return [];
          const bk = b as Record<string, unknown>;
          const key = typeof bk.name === "string" ? bk.name : typeof bk.key === "string" ? bk.key : null;
          const title = typeof bk.title === "string" ? bk.title : key;
          const lastUpdate = typeof bk.last_update === "string" ? bk.last_update : typeof bk.updated === "string" ? bk.updated : "";
          if (!key) return [];
          const markets = Array.isArray(bk.markets)
            ? (bk.markets as unknown[]).flatMap((m): OddsEvent["bookmakers"][number]["markets"] => {
                if (!m || typeof m !== "object") return [];
                const mk = m as Record<string, unknown>;
                const mkey = typeof mk.key === "string" ? mk.key : typeof mk.name === "string" ? mk.name : "h2h";
                const outcomes = Array.isArray(mk.outcomes)
                  ? (mk.outcomes as unknown[]).flatMap((o): { name: string; price: number }[] => {
                      if (!o || typeof o !== "object") return [];
                      const oc = o as Record<string, unknown>;
                      const name = typeof oc.name === "string" ? oc.name : typeof oc.team === "string" ? oc.team : null;
                      const price = typeof oc.price === "number" ? oc.price : null;
                      if (!name || price === null) return [];
                      return [{ name, price }];
                    })
                  : [];
                if (outcomes.length === 0) return [];
                return [{ key: mkey, outcomes }];
              })
            : [];
          if (markets.length === 0) return [];
          return [{ key, title: title ?? key, lastUpdate, markets }];
        })
      : [];
    if (bookmakers.length === 0) continue;
    out.push({
      id: asFeedEventId(idRaw),
      sportKey: V3_SLUG_TO_SPORT[sportRaw ?? ""] ?? sportRaw ?? "unknown",
      commenceTime: commenceRaw,
      homeTeam: homeRaw,
      awayTeam: awayRaw,
      bookmakers,
    });
  }
  return out;
}

/** Active v3 bookmaker names (filtered from the live list). */
export function activeV3BookmakerNames(list: OddsApiV3Bookmaker[]): string[] {
  return list.filter((b) => b.active).map((b) => b.name);
}

/** Names declared in the config for the odds-api-v3 feed, per sport. */
export function v3NamesForSport(cfg: { bookmakers: OddsRegistryBookmaker[] }, sportKey: string): string[] {
  return cfg.bookmakers.filter((b) => b.feed === "odds-api-v3" && b.sports.includes(sportKey)).map((b) => b.name);
}

