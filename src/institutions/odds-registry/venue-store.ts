/**
 * venue-store.ts — the venue store: physical match locations with identity.
 *
 * The wire carries only `venue="lat,long"`; this store gives those
 * coordinates a human identity and a canonical grouping key:
 *
 *   - venueKey: canonical identifier derived from coordinates rounded to
 *     4dp (~11m) — the grouping/collision key, stable across feed variants.
 *   - name/city: human-readable identity ("Alpha Park, London").
 *   - timezone: venue-local kickoff rendering.
 *   - aliases: alternate names normalized to the canonical one ("MSG" ->
 *     "Madison Square Garden" style).
 *
 * The store lives at config/odds-venues.json. A venue quoting coordinates
 * that the store does not declare still renders — by coordinates — with a
 * derived venueKey; it is never dropped.
 */
import type { EventLocation } from "../../alpha/odds-types.ts";

export type VenueProfile = {
  /** Canonical key: v:<lat 4dp>:<long 4dp> — the grouping identity. */
  venueKey: string;
  /** Stadium / arena name. */
  name: string;
  /** City for human-friendly display. */
  city?: string;
  /** IANA timezone for venue-local kickoff (e.g. "Europe/London"). */
  timezone?: string;
  /** Alternate names normalized to `name` (case/space-insensitive). */
  aliases?: string[];
};

export type VenueStore = {
  schema: string;
  venues: VenueProfile[];
};

/** Canonical grouping key for a location: coords rounded to 4dp (~11m). */
export function venueKeyFor(loc: EventLocation): string {
  return `v:${loc.lat.toFixed(4)}:${loc.long.toFixed(4)}`;
}

const normalizeName = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Canonicalize a venue name through the store's name/alias table
 * ("MSG" -> "Madison Square Garden"). Unknown names pass through unchanged.
 */
export function canonicalVenueName(store: VenueStore | undefined, raw: string): string {
  if (!store) return raw;
  const needle = normalizeName(raw);
  if (needle === "") return raw;
  for (const v of store.venues) {
    const candidates = [v.name, ...(v.aliases ?? [])].map(normalizeName);
    if (candidates.includes(needle)) return v.name;
  }
  return raw;
}

/** Profile for a location; undefined when the store does not declare it. */
export function venueProfileFor(
  store: VenueStore | undefined,
  loc: EventLocation,
): VenueProfile | undefined {
  if (!store) return undefined;
  const key = venueKeyFor(loc);
  return store.venues.find((v) => v.venueKey === key);
}

/**
 * Kickoff rendered for humans at the venue: venue-local time when the store
 * declares a timezone, UTC ISO otherwise. Invalid timezones fall back to UTC.
 */
export function localKickoff(commenceIso: string, timezone?: string): string {
  const ms = Date.parse(commenceIso);
  if (!Number.isFinite(ms)) return commenceIso;
  if (!timezone) return new Date(ms).toISOString();
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(ms);
  } catch {
    return new Date(ms).toISOString();
  }
}

/** Events grouped by venueKey (only locations resolve to a key). */
export function venueCollisionCounts(events: { location?: EventLocation }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const ev of events) {
    if (!ev.location) continue;
    const key = venueKeyFor(ev.location);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** Load config/odds-venues.json; empty store when the file is missing. */
export async function loadVenueStore(root: string): Promise<VenueStore> {
  const file = Bun.file(root + "/config/odds-venues.json");
  if (!(await file.exists())) return { schema: "odds-venues/v1", venues: [] };
  const parsed = (await file.json()) as VenueStore;
  if (!Array.isArray(parsed.venues)) return { schema: "odds-venues/v1", venues: [] };
  return parsed;
}
