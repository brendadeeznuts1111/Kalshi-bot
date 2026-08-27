#!/usr/bin/env bun
/**
 * `bun run odds:report <feed> [--venues=config/odds-venues.json] [--plain]`
 *
 * Odds Heat ANSI report — one colored chip line per event:
 *
 *   bun run odds:report public/registry/odds-reference.xml
 *   bun run odds:report https://example.com/odds.xml --plain
 *
 * Feed is an http(s) URL or a local XML file (Bun.XML). Venue identity
 * (name/city/venue-local kickoff) comes from the venue store; the weather
 * chip renders when the event carries a forecast (the report route attaches
 * forecasts — this CLI is offline-first). --plain strips ANSI for piping.
 */
import { parseArgs } from "node:util";
import {
  loadVenueStore,
  parseOddsXmlEvents,
  renderOddsReportAnsi,
  type OddsEventLineOptions,
} from "../src/institutions/odds-registry/index.ts";
import { loadOddsInput } from "../src/lib/odds-tile.ts";

const { values: v, positionals: pos } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    venues: { type: "string", default: "config/odds-venues.json" },
    plain: { type: "boolean", default: false },
  },
});

const feed = pos[0];
if (!feed) {
  console.error("usage: bun run odds:report <feed.xml|url> [--venues=config/odds-venues.json] [--plain]");
  process.exit(1);
}

const input = await loadOddsInput(feed);
const events = parseOddsXmlEvents(input, { sportKey: "soccer_epl", market: "h2h" });
if (events.length === 0) {
  console.error("no events parsed from feed");
  process.exit(1);
}

const store = await loadVenueStore(import.meta.dir + "/..").catch(() => undefined);
const options: OddsEventLineOptions = {};
if (store) options.venueStore = store;

const block = renderOddsReportAnsi(events, options);
console.log(v.plain ? Bun.stripANSI(block) : block);
