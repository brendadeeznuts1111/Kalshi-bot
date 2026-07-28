#!/usr/bin/env bun
/**
 * Data-plane snapshot capture — point-in-time state + append to registry.
 *
 * Usage:
 *   bun tools/snapshot-data-plane.ts
 *   bun tools/snapshot-data-plane.ts --db=/path/to/event-store.db
 *   bun tools/snapshot-data-plane.ts --registry=/path/to/registry.jsonl
 */
import { openEventStore } from "../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../src/institutions/event-store/paths.ts";
import { analyzeTennisBookCoverage } from "../src/institutions/event-store/tennis-book-coverage.ts";

function arg(name: string): string | undefined {
  return Bun.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function getFileSizeBytes(path: string): Promise<number> {
  try {
    const stat = await Bun.file(path).stat();
    return stat.size;
  } catch {
    return 0;
  }
}

export type DataPlaneSnapshot = {
  v: 1;
  ts: string;
  tsUnix: number;
  run: string;
  rows: {
    events: number;
    markets: number;
    resolutions: number;
    book_ticks: number;
    book_ticks_by_source: Record<string, number>;
    event_links: number;
    live_scores: number;
    score_snapshots: number;
    player_profiles: number;
    odds_ticks: number;
  };
  files: {
    event_store_db: number;
    cache_db: number;
    ticker_map_db: number;
    shadow_log_jsonl: number;
  };
  coverage: {
    watchEvents: number;
    watchTickers: number;
    watchWithWs: number;
    watchWithRest: number;
    watchWithBoth: number;
    watchWithNeither: number;
    wsTicksTotal: number;
    restTicksTotal: number;
    wsExchangeClockPct: number | null;
    linkedEventsWithWs: number;
    linkedEventsTotal: number;
  };
  canary: {
    exitCode: number | null;
    watch: number;
    polled: number;
    live: number;
    wouldUpsert: number;
    wireOk: boolean | null;
    liveMatches: Array<{ ticker: string; summary: string }>;
  };
  blockers: {
    gh_auth: boolean;
    protonpass_session: boolean;
    kalshi_ws: boolean;
    odds_api: boolean;
  };
  sources: Record<string, { active: boolean; rows: number; blocker: string | null }>;
};

export async function captureSnapshot(
  options: { dbPath?: string; registryPath?: string } = {},
): Promise<DataPlaneSnapshot> {
  const dbPath = options.dbPath ?? DEFAULT_EVENT_STORE_DB;
  const registryPath = options.registryPath ?? "research/registry/data-plane-snapshots.jsonl";
  const db = openEventStore({ dbPath });

  const now = new Date();
  const iso = now.toISOString();
  const run = `keeper-${iso.slice(0, 10)}-${iso.slice(11, 16).replace(":", "")}`;

  // Row counts
  const events = Number((db.query("SELECT COUNT(*) AS n FROM events").get() as any)?.n ?? 0);
  const markets = Number((db.query("SELECT COUNT(*) AS n FROM markets").get() as any)?.n ?? 0);
  const resolutions = Number((db.query("SELECT COUNT(*) AS n FROM resolutions").get() as any)?.n ?? 0);
  const book_ticks = Number((db.query("SELECT COUNT(*) AS n FROM book_ticks").get() as any)?.n ?? 0);
  const event_links = Number((db.query("SELECT COUNT(*) AS n FROM event_links").get() as any)?.n ?? 0);
  const live_scores = Number((db.query("SELECT COUNT(*) AS n FROM live_scores").get() as any)?.n ?? 0);
  const score_snapshots = Number((db.query("SELECT COUNT(*) AS n FROM score_snapshots").get() as any)?.n ?? 0);
  const player_profiles = Number((db.query("SELECT COUNT(*) AS n FROM player_profiles").get() as any)?.n ?? 0);
  const odds_ticks = Number((db.query("SELECT COUNT(*) AS n FROM odds_ticks").get() as any)?.n ?? 0);

  const bySource = db
    .query("SELECT source, COUNT(*) AS n FROM book_ticks GROUP BY source")
    .all() as Array<{ source: string; n: number }>;
  const book_ticks_by_source: Record<string, number> = {};
  for (const row of bySource) book_ticks_by_source[row.source] = row.n;

  // File sizes
  const event_store_db = await getFileSizeBytes(dbPath);
  const cache_db = await getFileSizeBytes(dbPath.replace("event-store.db", "cache.db"));
  const ticker_map_db = await getFileSizeBytes(dbPath.replace("event-store.db", "ticker-map.db"));
  const shadow_log_jsonl = await getFileSizeBytes("alpha/tennis-game-model/shadow-log.jsonl");

  // Coverage
  const coverage = analyzeTennisBookCoverage(db, { leadMinutes: 5, limit: 40 });

  // Canary / live — read latest canary history entry
  let canary: DataPlaneSnapshot["canary"] = {
    exitCode: null, watch: 0, polled: 0, live: 0, wouldUpsert: 0, wireOk: null, liveMatches: [],
  };
  try {
    const historyFile = Bun.file("research/cache/tennis-canary/history.jsonl");
    if (await historyFile.exists()) {
      const lines = (await historyFile.text()).trim().split("\n");
      const lastLine = lines[lines.length - 1];
      if (lastLine) {
        const canaryData = JSON.parse(lastLine);
        canary = {
          exitCode: canaryData.exitCode ?? null,
          watch: canaryData.summary?.watched ?? 0,
          polled: canaryData.summary?.polled ?? 0,
          live: canaryData.summary?.live ?? 0,
          wouldUpsert: canaryData.summary?.upserted ?? 0,
          wireOk: canaryData.exitCode === 0,
          liveMatches: (canaryData.liveTickers ?? []).map((t: string) => ({ ticker: t, summary: t })),
        };
      }
    }
  } catch { /* leave defaults */ }

  // Blockers
  const ghProc = Bun.spawn(["gh", "auth", "status"], { stdout: "pipe", stderr: "pipe" });
  const gh_auth = (await ghProc.exited) !== 0;

  const ppTest = await Bun.spawn(["pass-cli", "test"], { stdout: "pipe", stderr: "pipe" }).exited;
  const ppVault = await Bun.spawn(["pass-cli", "vault", "list"], { stdout: "pipe", stderr: "pipe" }).exited;
  const protonpass_session = ppTest === 0 && ppVault === 0;

  const kalshi_ws = !!(Bun.env.KALSHI_API_KEY_ID || Bun.env.KALSHI_ACCESS_KEY);
  const odds_api = !!Bun.env.ODDS_API_KEY;

  // Sources map
  const sources: DataPlaneSnapshot["sources"] = {
    "kalshi-rest-itf": { active: true, rows: events, blocker: null },
    "itf-stadion": { active: true, rows: resolutions, blocker: null },
    "kalshi-rest-books": { active: true, rows: book_ticks_by_source["kalshi-rest"] ?? 0, blocker: null },
    "kalshi-ws-books": {
      active: (book_ticks_by_source["kalshi-ws"] ?? 0) > 0,
      rows: book_ticks_by_source["kalshi-ws"] ?? 0,
      blocker: kalshi_ws ? null : "KALSHI_API_KEY_ID",
    },
    "player-profiles": { active: true, rows: player_profiles, blocker: null },
    "shadow-itf": { active: true, rows: Math.floor(shadow_log_jsonl / 1024), blocker: null },
    "odds-api": { active: odds_api, rows: odds_ticks, blocker: odds_api ? null : "ODDS_API_KEY" },
    "github-research": { active: protonpass_session, rows: 29, blocker: protonpass_session ? null : "GH_TOKEN" },
  };

  const snapshot: DataPlaneSnapshot = {
    v: 1,
    ts: iso,
    tsUnix: now.getTime(),
    run,
    rows: { events, markets, resolutions, book_ticks, book_ticks_by_source, event_links, live_scores, score_snapshots, player_profiles, odds_ticks },
    files: { event_store_db, cache_db, ticker_map_db, shadow_log_jsonl },
    coverage: {
      watchEvents: coverage.watchEvents,
      watchTickers: coverage.watchTickers,
      watchWithWs: coverage.watchWithWs,
      watchWithRest: coverage.watchWithRest,
      watchWithBoth: coverage.watchWithBoth,
      watchWithNeither: coverage.watchWithNeither,
      wsTicksTotal: coverage.wsTicksTotal,
      restTicksTotal: coverage.restTicksTotal,
      wsExchangeClockPct: coverage.wsExchangeClockPct,
      linkedEventsWithWs: coverage.linkedEventsWithWs,
      linkedEventsTotal: coverage.linkedEventsTotal,
    },
    canary,
    blockers: {
      gh_auth: !gh_auth,
      protonpass_session: !protonpass_session,
      kalshi_ws: !kalshi_ws,
      odds_api: !odds_api,
    },
    sources,
  };

  // Append to registry
  const line = JSON.stringify(snapshot);
  const registryFile = Bun.file(registryPath);
  let existing = "";
  if (await registryFile.exists()) {
    existing = await registryFile.text();
    if (existing.length > 0 && !existing.endsWith("\n")) existing += "\n";
  }
  await Bun.write(registryPath, existing + line + "\n");

  return snapshot;
}

if (import.meta.main) {
  const snapshot = await captureSnapshot({
    dbPath: arg("db"),
    registryPath: arg("registry"),
  });

  console.log(`Snapshot captured: ${snapshot.run}`);
  console.log(`Registry: research/registry/data-plane-snapshots.jsonl`);
  console.log("");
  console.log("=== Snapshot summary ===");
  console.log(`events=${snapshot.rows.events} markets=${snapshot.rows.markets} resolutions=${snapshot.rows.resolutions}`);
  console.log(`book_ticks=${snapshot.rows.book_ticks} (rest=${snapshot.rows.book_ticks_by_source["kalshi-rest"] ?? 0} ws=${snapshot.rows.book_ticks_by_source["kalshi-ws"] ?? 0})`);
  console.log(`event_links=${snapshot.rows.event_links} player_profiles=${snapshot.rows.player_profiles}`);
  console.log(`canary: watch=${snapshot.canary.watch} polled=${snapshot.canary.polled} live=${snapshot.canary.live}`);
  console.log(`blockers: gh=${snapshot.blockers.gh_auth} pp=${snapshot.blockers.protonpass_session} kalshi_ws=${snapshot.blockers.kalshi_ws} odds_api=${snapshot.blockers.odds_api}`);
}
