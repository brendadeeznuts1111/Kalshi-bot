/**
 * venue-store tests — canonical venueKey grouping, alias normalization,
 * venue-local kickoff, and collision counts (the venue domain, separate
 * from events and books).
 */
import { describe, expect, test } from "bun:test";
import {
  canonicalVenueName,
  localKickoff,
  venueCollisionCounts,
  venueKeyFor,
  venueProfileFor,
  type VenueStore,
} from "../../../src/institutions/odds-registry/index.ts";

const STORE: VenueStore = {
  schema: "odds-venues/v1",
  venues: [
    {
      venueKey: "v:51.5074:-0.1278",
      name: "Alpha Park",
      city: "London",
      timezone: "Europe/London",
      aliases: ["The Alpha Ground", "AP"],
    },
    {
      venueKey: "v:40.7505:-73.9934",
      name: "Madison Square Garden",
      city: "New York",
      timezone: "America/New_York",
      aliases: ["MSG"],
    },
  ],
};

describe("venueKeyFor", () => {
  test("canonical 4dp key groups nearby coordinates", () => {
    expect(venueKeyFor({ lat: 51.5074, long: -0.1278 })).toBe("v:51.5074:-0.1278");
    // Sub-4dp jitter is the same venue.
    expect(venueKeyFor({ lat: 51.50741, long: -0.12779 })).toBe("v:51.5074:-0.1278");
  });
});

describe("venueProfileFor / canonicalVenueName", () => {
  test("declared coordinates resolve to the named venue", () => {
    const p = venueProfileFor(STORE, { lat: 51.5074, long: -0.1278 });
    expect(p?.name).toBe("Alpha Park");
    expect(p?.city).toBe("London");
    expect(p?.timezone).toBe("Europe/London");
  });

  test("undeclared coordinates resolve to nothing (never a guess)", () => {
    expect(venueProfileFor(STORE, { lat: 48.8584, long: 2.2945 })).toBeUndefined();
    expect(venueProfileFor(undefined, { lat: 51.5074, long: -0.1278 })).toBeUndefined();
  });

  test("aliases canonicalize to the store name (MSG case)", () => {
    expect(canonicalVenueName(STORE, "MSG")).toBe("Madison Square Garden");
    expect(canonicalVenueName(STORE, "  the alpha ground ")).toBe("Alpha Park");
    expect(canonicalVenueName(STORE, "Some Other Ground")).toBe("Some Other Ground");
    expect(canonicalVenueName(undefined, "MSG")).toBe("MSG");
  });
});

describe("localKickoff", () => {
  test("renders venue-local time (BST is UTC+1 in September)", () => {
    expect(localKickoff("2026-09-01T19:00:00Z", "Europe/London")).toBe("1 Sep 2026 at 20:00");
    expect(localKickoff("2026-09-01T19:00:00Z", "America/New_York")).toContain("15:00");
  });

  test("no timezone -> UTC ISO; invalid timezone -> UTC fallback; bad input passes through", () => {
    expect(localKickoff("2026-09-01T19:00:00Z")).toBe("2026-09-01T19:00:00.000Z");
    expect(localKickoff("2026-09-01T19:00:00Z", "Mars/Olympus")).toBe("2026-09-01T19:00:00.000Z");
    expect(localKickoff("not-a-date")).toBe("not-a-date");
  });
});

describe("venueCollisionCounts", () => {
  test("counts events per venueKey; unlocated events never collide", () => {
    const counts = venueCollisionCounts([
      { location: { lat: 51.5074, long: -0.1278 } },
      { location: { lat: 51.5074, long: -0.1278 } },
      { location: { lat: 51.50741, long: -0.12779 } },
      {},
    ]);
    expect(counts.get("v:51.5074:-0.1278")).toBe(3);
    expect(counts.size).toBe(1);
  });
});
