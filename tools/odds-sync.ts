#!/usr/bin/env bun
/**
 * `bun run odds:sync [--sport=tennis_atp] [--db=research/cache/odds-cache.db] [--dry-run] [--json]`
 *
 * Connect to EVERY bookmaker covering a sport, each through its own feed
 * (registry meta -> connectAllBookmakers), cache into the shared SQLite WAL,
 * then run the value detector + convergence on the cached events.
 *
 * Live-feed reality: v3 /odds needs ODDS_API_KEY (pinned 401 without it);
 * bun-xml + fonbet-ws need their endpoints. --dry-run exercises the full
 * fan-out + reporting without network.
 */
import { parseArgs } from "node:util";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import {
  classifyConvergence,
  connectAllBookmakers,
  consensusSnapshot,
  detectValuePatterns,
  loadOddsRegistryConfig,
} from "../src/institutions/odds-registry/index.ts";

const { values: v } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    sport: { type: "string" },
    db: { type: "string" },
    dryRun: { type: "boolean" },
    json: { type: "boolean" },
  },
  strict: false,
  allowPositionals: true,
});
const arg = (name: string): string | undefined =>
  typeof v[name] === "string" ? (v[name] as string) : undefined;

const ROOT = join(import.meta.dir, "..");
const sport = arg("sport") ?? "tennis_atp";
const dbPath = arg("db") ?? join(ROOT, "research/cache/odds-cache.db");
const dryRun = Boolean(v.dryRun);

const cfg = await loadOddsRegistryConfig(ROOT);

// ── 1. fan out: every book covering the sport, each through its own feed ──
const results = await connectAllBookmakers(cfg, sport, dryRun ? {} : { dbPath });
// --local: when no live key/endpoint, substitute the committed reference feed
// (public/registry/odds-reference.xml) so the full sync -> detect loop is
// demonstrable offline. Each synthetic book's events carry the same match.
const localRef = join(ROOT, "public/registry/odds-reference.xml");
if (Boolean(v.local) && (await Bun.file(localRef).exists())) {
  const { parseOddsXmlEvents } = await import("../src/institutions/odds-registry/xml-feed.ts");
  const refText = await Bun.file(localRef).text();
  const refEvents = parseOddsXmlEvents(refText, { sportKey: sport, market: "h2h" });
  for (const r of results) {
    if ((r as { error?: string }).error) {
      (r as { error?: string }).error = undefined as never;
      r.events = refEvents;
    }
  }
}
const ok = results.filter((r) => r.events.length > 0);
const errored = results.filter((r) => (r as { error?: string }).error);

// ── 2. gather the cached events into one normalized array ──
const events = ok.flatMap((r) => r.events);

// ── 3. value detector + convergence on the live/cached data ──
// (venue refs come from a JSON file when present; empty otherwise)
const venueRefs = await Bun.file(join(ROOT, "public/registry/venue-refs.json")).json().catch(() => []);
const patterns = detectValuePatterns(events, venueRefs);

// ── 4. convergence: compare this run's consensus snapshots to the previous ──
// run's (stored in a snapshots table in the same WAL DB). First run stores
// and reports nothing; later runs classify spread tightening/widening.
const converge: Array<ReturnType<typeof classifyConvergence> & { eventId: string; side: string }> = [];
if (!dryRun && events.length > 0) {
  const db = new Database(dbPath, { create: true });
  db.run("PRAGMA journal_mode=WAL;");
  db.run("CREATE TABLE IF NOT EXISTS odds_snapshots (event_id TEXT, side TEXT, ts INTEGER, consensus REAL, spread REAL, bookmakers INTEGER, PRIMARY KEY (event_id, side))");
  const eventIds = [...new Set(events.map((ev) => ev.id))];
  for (const eventId of eventIds) {
    for (const ev of events) {
      if (ev.id !== eventId) continue;
      const sides = [...new Set(ev.bookmakers.flatMap((bk) => bk.markets[0]?.outcomes.map((o) => o.name) ?? []))];
      for (const side of sides) {
        const cur = consensusSnapshot(events, eventId, side);
        if (!cur) continue;
        const prior = db.query("SELECT ts, consensus, spread, bookmakers FROM odds_snapshots WHERE event_id = ? AND side = ?").get(eventId, side) as
          | { ts: number; consensus: number; spread: number; bookmakers: number }
          | undefined;
        const pattern = classifyConvergence(eventId, side, cur, prior ?? null);
        if (pattern) converge.push({ ...pattern, eventId, side });
        db.run("INSERT OR REPLACE INTO odds_snapshots (event_id, side, ts, consensus, spread, bookmakers) VALUES (?, ?, ?, ?, ?, ?)", [eventId, side, cur.ts, cur.consensus, cur.spread, cur.bookmakers]);
      }
    }
  }
  db.close();
}

if (arg("json")) {
  console.log(JSON.stringify({
    sport,
    bookmakers: { total: results.length, ok: ok.length, errored: errored.length },
    events: events.length,
    patterns: patterns.map((p) => ({ kind: p.kind, severity: p.severity, eventId: p.eventId, side: p.side, note: p.note })),
    convergence: converge,
    errors: errored.slice(0, 5).map((r) => ({ key: r.bookmakerKey, error: (r as { error?: string }).error })),
  }, null, 2));
  process.exit(0);
}

console.log("odds:sync " + sport + " — " + ok.length + "/" + results.length + " books ok (" + events.length + " events)");
if (errored.length) {
  console.log("  errors:");
  for (const r of errored.slice(0, 5)) console.log("    " + r.bookmakerKey + ": " + (r as { error?: string }).error);
  if (errored.length > 5) console.log("    … +" + (errored.length - 5) + " more");
}
console.log("  value patterns: " + patterns.length);
for (const p of patterns.slice(0, 5)) console.log("    [" + p.severity.toUpperCase().padEnd(5) + "] " + p.kind + " " + p.eventId + " " + p.side + " — " + p.note);
if (patterns.length > 5) console.log("    … +" + (patterns.length - 5) + " more");
console.log("  convergence: " + converge.length);
for (const c of converge.slice(0, 5)) console.log("    [" + c.severity.toUpperCase().padEnd(5) + "] " + c.kind + " " + c.eventId + " " + c.side + " — " + c.note);
if (converge.length > 5) console.log("    … +" + (converge.length - 5) + " more");

