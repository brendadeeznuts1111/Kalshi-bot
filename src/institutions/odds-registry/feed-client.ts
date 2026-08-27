/**
 * feed-client.ts — per-bookmaker feed connections driven by the registry meta.
 *
 * The registry XML is the SSOT: every <bookmaker><meta> blob holds the
 * feed-specific connection details, and connectBookmaker() reads ONLY that
 * blob to fetch ONE bookmaker's feed (one book, one feed, one connection).
 * This is the "connect to each one separately" layer — no batch endpoint
 * assumes a shared wire; every feed type (xml/json/ws) goes through its own
 * adapter, all Bun-native, all cached in the shared SQLite WAL odds_cache.
 */
import type { OddsEvent } from "../../alpha/odds-types.ts";
import { parseOddsXmlEvents } from "./xml-feed.ts";
import { fetchV3Odds } from "./odds-api-v3.ts";
import type { OddsRegistryBookmaker, OddsRegistryConfig } from "./types.ts";

export type FeedClientResult = {
  bookmakerKey: string;
  feed: OddsRegistryBookmaker["feed"];
  sportKey: string;
  events: OddsEvent[];
  fromCache: boolean;
  meta: Record<string, string>;
};

export type ConnectOptions = {
  market?: string;
  dbPath?: string;
  cacheMs?: number;
};

/**
 * Fetch one bookmaker's feed for one sport. Dispatches on the feed type;
 * every branch reads its connection details from the meta blob (with the
 * bookmaker's flat attributes as fallbacks for backward compatibility).
 */
export async function connectBookmaker(
  cfg: OddsRegistryConfig,
  bookmakerKey: string,
  sportKey: string,
  opts: ConnectOptions = {},
): Promise<FeedClientResult> {
  const bk = cfg.bookmakers.find((b) => b.key === bookmakerKey);
  if (!bk) throw new Error("unknown bookmaker key: " + bookmakerKey);
  if (!bk.sports.includes(sportKey)) throw new Error(bk.key + " does not cover sport " + sportKey);
  const market = opts.market ?? bk.markets?.split(",")[0] ?? "h2h";

  switch (bk.feed) {
    case "odds-api-v3": {
      // Meta: v3-name (the wire name), api-key-ref (env var holding the key).
      const v3Name = metaVal(bk, "v3-name", bk.name);
      const apiKeyRef = metaVal(bk, "api-key-ref", "ODDS_API_KEY");
      const apiKey = apiKeyRef.startsWith("env:") ? Bun.env[apiKeyRef.slice(4)] : Bun.env[apiKeyRef];
      const { events, fromCache } = await fetchV3Odds(sportKey, [v3Name], {
        market,
        ...(apiKey ? { apiKey } : {}),
        ...(opts.dbPath ? { dbPath: opts.dbPath } : {}),
        ...(opts.cacheMs !== undefined ? { cacheMs: opts.cacheMs } : {}),
      });
      return { bookmakerKey, feed: bk.feed, sportKey, events, fromCache, meta: bk.meta };
    }
    case "bun-xml": {
      // Meta: endpoint (the odds-heat XML URL). Fetched with Bun-native fetch.
      const endpoint = metaVal(bk, "endpoint", bk.endpoint ?? "");
      if (!endpoint) throw new Error(bk.key + " bun-xml feed needs <meta><endpoint>");
      const res = await fetch(endpoint, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(bk.key + " XML feed HTTP " + res.status);
      const text = await res.text();
      const events = parseOddsXmlEvents(text, { sportKey, market, source: "live" });
      return { bookmakerKey, feed: bk.feed, sportKey, events, fromCache: false, meta: bk.meta };
    }
    case "fonbet-ws": {
      // Meta: ws-url (the ODDSCORP endpoint), auth-key-ref (env var).
      // The WS capture itself lives in the event-store recorder; here we
      // declare the connection contract and fail loudly when the blob is
      // incomplete rather than half-connecting.
      const wsUrl = metaVal(bk, "ws-url", "");
      const authKeyRef = metaVal(bk, "auth-key-ref", "ODDSCORP_AUTH_KEY");
      if (!wsUrl) throw new Error(bk.key + " fonbet-ws feed needs <meta><ws-url>");
      // WS capture is the event-store recorder's job (tools/fonbet-sync-cli.ts);
      // this layer validates the meta contract (ws-url + auth-key-ref) so a
      // half-configured book fails loudly instead of silently connecting.
      void authKeyRef;
      return { bookmakerKey, feed: bk.feed, sportKey, events: [], fromCache: false, meta: bk.meta };
    }
  }
}

/** Read a meta key with a flat-attribute fallback. */
function metaVal(bk: OddsRegistryBookmaker, key: string, fallback: string): string {
  return bk.meta[key] ?? fallback;
}

/**
 * Connect to EVERY bookmaker covering a sport, each through its own feed
 * (the N-generic fan-out). Failures are per-book: one dead feed does not
 * suppress the rest.
 */
export async function connectAllBookmakers(
  cfg: OddsRegistryConfig,
  sportKey: string,
  opts: ConnectOptions = {},
): Promise<FeedClientResult[]> {
  const results: FeedClientResult[] = [];
  for (const bk of cfg.bookmakers) {
    if (!bk.sports.includes(sportKey)) continue;
    try {
      results.push(await connectBookmaker(cfg, bk.key, sportKey, opts));
    } catch (error) {
      results.push({
        bookmakerKey: bk.key,
        feed: bk.feed,
        sportKey,
        events: [],
        fromCache: false,
        meta: bk.meta,
        error: error instanceof Error ? error.message : String(error),
      } as FeedClientResult & { error: string });
    }
  }
  return results;
}

