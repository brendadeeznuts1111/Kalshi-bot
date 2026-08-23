import { describe, expect, test } from "bun:test";
import {
  canonicalMatchKey,
  normalizeSideToHomeAway,
  parseCanonicalMatchKey,
} from "../../../src/institutions/event-store/event-identity.ts";

describe("canonicalMatchKey (day|lane|sorted-last-names)", () => {
  test("builds the canonical key with sorted surnames", () => {
    expect(
      canonicalMatchKey({
        day: "2026-07-22",
        lane: "kxitfwmatch",
        playerA: "Francesca Pace",
        playerB: "Martina Trevisan",
        format: "singles",
      }),
    ).toBe("2026-07-22|KXITFWMATCH|pace|trevisan");
  });

  test("returns null when surnames collide (ambiguous)", () => {
    expect(
      canonicalMatchKey({
        day: "2026-07-22",
        lane: "kx",
        playerA: "Ann Smith",
        playerB: "Bob Smith",
        format: "singles",
      }),
    ).toBeNull();
  });
});

describe("parseCanonicalMatchKey", () => {
  test("round-trips a built key", () => {
    const key = canonicalMatchKey({ day: "2026-07-22", lane: "kx", playerA: "Ann Pace", playerB: "Bob Trevisan", format: "singles" })!;
    expect(parseCanonicalMatchKey(key)).toEqual({ day: "2026-07-22", lane: "KX", competitors: ["pace", "trevisan"] });
  });
  test("rejects malformed keys", () => {
    expect(parseCanonicalMatchKey("a|b")).toBeNull();
    expect(parseCanonicalMatchKey("a||c")).toBeNull();
  });
});

describe("normalizeSideToHomeAway (unified side vocabulary)", () => {
  test("direct dialects map as-is", () => {
    expect(normalizeSideToHomeAway("home")).toBe("home");
    expect(normalizeSideToHomeAway("away")).toBe("away");
    expect(normalizeSideToHomeAway("1")).toBe("home");
    expect(normalizeSideToHomeAway("2")).toBe("away");
    expect(normalizeSideToHomeAway("yes")).toBe("home");
    expect(normalizeSideToHomeAway("no")).toBe("away");
    expect(normalizeSideToHomeAway("HOME")).toBe("home");
    expect(normalizeSideToHomeAway("  away ")).toBe("away");
  });

  test("winner/loser resolve through the competitor name", () => {
    const names = { home: "Ann Pace", away: "Bob Trevisan" };
    expect(normalizeSideToHomeAway("winner", { competitor: "Ann Pace", ...names })).toBe("home");
    expect(normalizeSideToHomeAway("loser", { competitor: "Ann Pace", ...names })).toBe("home");
    expect(normalizeSideToHomeAway("winner", { competitor: "Bob Trevisan", ...names })).toBe("away");
    expect(normalizeSideToHomeAway("winner", { competitor: "ann pace", ...names })).toBe("home");
  });

  test("winner/loser are ambiguous without names or on collision", () => {
    expect(normalizeSideToHomeAway("winner")).toBeNull();
    expect(normalizeSideToHomeAway("winner", { competitor: "Ann Pace" })).toBeNull();
    expect(normalizeSideToHomeAway("winner", { competitor: "Ann Pace", home: "Ann Pace", away: "Ann Pace" })).toBeNull();
    expect(normalizeSideToHomeAway("winner", { competitor: "Unknown", home: "Ann Pace", away: "Bob Trevisan" })).toBeNull();
  });

  test("unknown sides return null", () => {
    expect(normalizeSideToHomeAway("draw")).toBeNull();
    expect(normalizeSideToHomeAway(null)).toBeNull();
    expect(normalizeSideToHomeAway("")).toBeNull();
  });
});
