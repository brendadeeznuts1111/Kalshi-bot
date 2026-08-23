/**
 * Harvest player nationalities + venue geo from cached ITF Stadion responses
 * into seed dictionaries consumed by src/research/tennis-meta.ts.
 *
 * The Stadion feed carries player.person.country {ISOcode, _name} and
 * venue {city, country} — authoritative tour metadata, decoupled from
 * Kalshi/Polymarket price strings. Re-run after any Stadion sync.
 *
 * Usage:
 *   bun tools/tennis/harvest-nationalities.ts
 *   bun tools/tennis/harvest-nationalities.ts --dry-run
 */
// @see https://bun.com/docs/runtime/file-io
import { readdirSync } from "node:fs";
import { readJsonFile } from "../../src/lib/json-file.ts";
import { join } from "node:path";
import { CACHE_DIR, joinPath } from "../../src/research/paths.ts";
import { normalizeKey } from "../../src/research/tennis-meta.ts";

const STADION_DIR = join(CACHE_DIR, "itf-stadion");
const SEED_DIR = joinPath(import.meta.dir, "../../research/seed");

type IsoEntry = { iso3: string; country: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asCountry(v: unknown): IsoEntry | null {
  if (!isRecord(v)) return null;
  const iso3 = typeof v.ISOcode === "string" ? v.ISOcode : null;
  const country = typeof v._name === "string" ? v._name : null;
  return iso3 && country ? { iso3, country } : null;
}

export function harvestStadionWire(wire: unknown, out: {
  players: Map<string, IsoEntry>;
  venues: Map<string, IsoEntry>;
}): void {
  const walk = (o: unknown): void => {
    if (Array.isArray(o)) {
      for (const v of o) walk(v);
      return;
    }
    if (!isRecord(o)) return;
    // player.person.country — player nationality
    const player = o.player;
    if (isRecord(player) && isRecord(player.person)) {
      const name = typeof player.person._name === "string" ? player.person._name : null;
      const country = asCountry(player.person.country);
      if (name && country) out.players.set(normalizeKey(name), country);
    }
    // venue {city, country} — tournament geo
    const venue = o.venue;
    if (isRecord(venue)) {
      const city = typeof venue.city === "string" ? venue.city : null;
      const country = asCountry(venue.country);
      if (city && country) out.venues.set(normalizeKey(city), country);
    }
    for (const v of Object.values(o)) walk(v);
  };
  walk(wire);
}

export async function harvestAll(options: { dryRun?: boolean } = {}): Promise<{
  days: number;
  players: number;
  venues: number;
}> {
  const out = { players: new Map<string, IsoEntry>(), venues: new Map<string, IsoEntry>() };
  const files = readdirSync(STADION_DIR).filter((f) => f.endsWith(".json")).sort();
  for (const f of files) {
    const wire: unknown = await readJsonFile(join(STADION_DIR, f));
    harvestStadionWire(wire, out);
  }
  if (!options.dryRun) {
    const playersObj = {
      $comment:
        "Harvested from ITF Stadion (player.person.country). name (normalized) → {iso3, country}. Regenerate: bun tools/tennis/harvest-nationalities.ts",
      ...Object.fromEntries([...out.players.entries()].sort()),
    };
    const venuesObj = {
      $comment:
        "Harvested from ITF Stadion (venue.city + venue.country). city (normalized) → {iso3, country}. Regenerate: bun tools/tennis/harvest-nationalities.ts",
      ...Object.fromEntries([...out.venues.entries()].sort()),
    };
    await Bun.write(join(SEED_DIR, "player-nationalities.json"), JSON.stringify(playersObj, null, 2) + "\n");
    await Bun.write(join(SEED_DIR, "venue-geo.json"), JSON.stringify(venuesObj, null, 2) + "\n");
  }
  return { days: files.length, players: out.players.size, venues: out.venues.size };
}

if (import.meta.main) {
  const dryRun = Bun.argv.includes("--dry-run");
  const r = await harvestAll({ dryRun });
  console.log(
    `Harvested ${r.players} player nationalities + ${r.venues} venue geos from ${r.days} Stadion days` +
      (dryRun ? " (dry-run)" : " → research/seed/"),
  );
}
