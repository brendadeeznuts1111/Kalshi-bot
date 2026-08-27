#!/usr/bin/env bun
/**
 * `bun run odds:value-report [--feed=FILE|URL] [--venues=FILE] [--sport=...] [--market=h2h] [--json]`
 *
 * Value-pattern report: runs the consensus-vs-venue detector over a local
 * odds-heat XML feed (or --feed URL fetched with Bun-native fetch) + venue
 * implied refs (JSON array of VenuePriceRef), emits a human or JSON report.
 */
import { parseArgs } from "node:util";
import { join } from "node:path";
import { detectValuePatterns, parseOddsXmlEvents, type VenuePriceRef } from "../src/institutions/odds-registry/index.ts";

const { values: v, positionals: pos } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    feed: { type: "string" },
    venues: { type: "string" },
    sport: { type: "string" },
    market: { type: "string" },
    json: { type: "boolean" },
  },
  strict: false,
  allowPositionals: true,
});
const arg = (name: string): string | undefined =>
  typeof v[name] === "string" ? (v[name] as string) : undefined;

const ROOT = join(import.meta.dir, "..");
const feedPath = arg("feed") ?? pos[0] ?? join(ROOT, "public/registry/odds-reference.xml");
const venuesPath = arg("venues") ?? join(ROOT, "public/registry/venue-refs.json");
const sport = arg("sport") ?? "soccer_epl";
const market = arg("market") ?? "h2h";

async function loadFeed(path: string): Promise<string> {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    const res = await fetch(path);
    if (!res.ok) throw new Error("feed fetch failed: HTTP " + res.status);
    return await res.text();
  }
  const f = Bun.file(path);
  if (!(await f.exists())) throw new Error("feed not found: " + path);
  return await f.text();
}

const feedText = await loadFeed(feedPath);
const events = parseOddsXmlEvents(feedText, { sportKey: sport, market });
const venueRefs: VenuePriceRef[] = (await Bun.file(venuesPath).json().catch(() => [])) as VenuePriceRef[];
const patterns = detectValuePatterns(events, venueRefs);

if (arg("json")) {
  console.log(JSON.stringify({ feed: feedPath, sport, market, events: events.length, venueRefs: venueRefs.length, patterns }, null, 2));
  process.exit(0);
}

console.log("Value-pattern report — " + sport + " " + market + " (" + events.length + " events, " + venueRefs.length + " venue refs)");
if (patterns.length === 0) { console.log("  no patterns — feed venues that diverge from consensus to surface mispricing"); process.exit(0); }
for (const p of patterns) {
  console.log("  [" + p.severity.toUpperCase().padEnd(5) + "] " + p.kind + " " + p.eventId + " " + p.side + " — " + p.note);
}

