// @see https://bun.com/docs/bundler/plugins (cached) — maps.toml triple-lock unit tests.
// Pure functions only: no network, no subprocess (syncDocsLock is exercised
// end-to-end by running `bun run docs:refresh`).
import { describe, expect, test } from "bun:test";
import {
  evaluateMapsLock,
  mapsHashOfPins,
  mapsPinsContent,
  mapsTomlContent,
  parseMapsPins,
  type MapsPins,
} from "../../src/lib/maps-lock.ts";

const base: MapsPins = {
  bunVersion: "1.4.0",
  bunTypesVersion: "1.4.0",
  typesBunVersion: "1.4.0",
  docsRef: "bun-v1.4.0",
  docsScope: "all",
  docsPages: 333,
};

describe("maps.toml triple-lock", () => {
  test("pins content is deterministic and stable", () => {
    expect(mapsPinsContent(base)).toBe(mapsPinsContent({ ...base }));
    expect(mapsPinsContent(base)).toContain('runtime.bun = "1.4.0"');
    expect(mapsPinsContent(base)).toContain('docs.pages = 333');
  });

  test("hash is 16 hex chars and changes when any pin drifts", () => {
    const h = mapsHashOfPins(base);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    // A Bun bump changes runtime + docs ref -> different hash.
    expect(mapsHashOfPins({ ...base, bunVersion: "1.5.0", docsRef: "bun-v1.5.0" })).not.toBe(h);
    // A types pin drift changes the hash.
    expect(mapsHashOfPins({ ...base, bunTypesVersion: "1.5.0" })).not.toBe(h);
    // A page-count change changes the hash.
    expect(mapsHashOfPins({ ...base, docsPages: 334 })).not.toBe(h);
  });

  test("mapsTomlContent round-trips through Bun.TOML.parse", () => {
    const toml = mapsTomlContent(base, "2026-08-24T00:00:00.000Z");
    const parsed = Bun.TOML.parse(toml) as any;
    expect(parsed.generated).toBe("2026-08-24T00:00:00.000Z");
    expect(parsed.runtime.bun).toBe("1.4.0");
    expect(parsed.types["bun-types"]).toBe("1.4.0");
    expect(parsed.types["@types/bun"]).toBe("1.4.0");
    expect(parsed.docs.ref).toBe("bun-v1.4.0");
    expect(parseMapsPins(parsed)).toEqual(base);
  });

  test("parseMapsPins rejects malformed shapes", () => {
    expect(parseMapsPins(null)).toBeNull();
    expect(parseMapsPins("nope")).toBeNull();
    expect(parseMapsPins({ runtime: {}, types: {}, docs: {} })).toBeNull();
    expect(parseMapsPins({ runtime: { bun: 1 }, types: {}, docs: {} })).toBeNull();
  });

  test("evaluate: all in sync -> ok, no reasons", () => {
    const st = evaluateMapsLock({ expectedPins: base, filePins: base, recordedHash: mapsHashOfPins(base) });
    expect(st.ok).toBe(true);
    expect(st.reasons).toEqual([]);
    expect(st.expectedHash).toBe(mapsHashOfPins(base));
  });

  test("evaluate: missing maps.toml + missing INDEX hash -> reasons", () => {
    const st = evaluateMapsLock({ expectedPins: base, filePins: null, recordedHash: null });
    expect(st.ok).toBe(false);
    const joined = st.reasons.join("\n");
    expect(joined).toContain("maps.toml missing");
    expect(joined).toContain("mapsHash missing");
  });

  test("evaluate: Bun bump drift names the drifted pins", () => {
    const st = evaluateMapsLock({
      expectedPins: { ...base, bunVersion: "1.5.0", docsRef: "bun-v1.5.0" },
      filePins: base,
      recordedHash: mapsHashOfPins(base),
    });
    expect(st.ok).toBe(false);
    const joined = st.reasons.join("\n");
    expect(joined).toContain("bunVersion");
    expect(joined).toContain("docsRef");
    expect(joined).toContain("maps.toml pins stale");
  });

  test("evaluate: INDEX mapsHash stale vs file -> reason", () => {
    const st = evaluateMapsLock({ expectedPins: base, filePins: base, recordedHash: "0".repeat(16) });
    expect(st.ok).toBe(false);
    const joined = st.reasons.join("\n");
    expect(joined).toContain("INDEX.json mapsHash");
  });
});
