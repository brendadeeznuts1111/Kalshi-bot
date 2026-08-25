import { describe, expect, test } from "bun:test";
import {
  CHANNEL_ACTIONS,
  CHANNEL_DEFS,
  CHANNEL_IDS,
  CHANNEL_ORDER,
  isKnownChannel,
} from "../../src/institutions/channel-registry.ts";

describe("channel registry SSOT", () => {
  test("every ChannelId has exactly one def with label + description + >=1 source", () => {
    expect(CHANNEL_IDS.length).toBeGreaterThanOrEqual(1);
    for (const id of CHANNEL_IDS) {
      const def = CHANNEL_DEFS[id];
      expect(def, "def missing for " + id).toBeDefined();
      expect(def.id).toBe(id);
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(0);
      expect(def.sources.length).toBeGreaterThanOrEqual(1);
    }
  });

  test("defs cover exactly the ChannelId set (no strays, no gaps)", () => {
    expect(Object.keys(CHANNEL_DEFS).sort()).toEqual([...CHANNEL_IDS].sort());
  });

  test("CHANNEL_ORDER is a permutation of CHANNEL_IDS with unique dashboardOrder", () => {
    expect([...CHANNEL_ORDER].sort()).toEqual([...CHANNEL_IDS].sort());
    const orders = CHANNEL_ORDER.map((id) => CHANNEL_DEFS[id].dashboardOrder);
    expect(new Set(orders).size).toBe(orders.length);
  });

  test("isKnownChannel accepts every id and rejects non-channels", () => {
    for (const id of CHANNEL_IDS) expect(isKnownChannel(id)).toBe(true);
    expect(isKnownChannel("not-a-channel")).toBe(false);
    expect(isKnownChannel("")).toBe(false);
  });

  test("every action belongs to exactly one channel and is unique", () => {
    const seen = new Map<string, string>();
    for (const id of CHANNEL_ORDER) {
      for (const a of CHANNEL_DEFS[id].actions) {
        expect(seen.has(a), "duplicate action " + a).toBe(false);
        seen.set(a, id);
      }
    }
    expect([...seen.keys()].sort()).toEqual([...CHANNEL_ACTIONS].sort());
  });

  test("channels with cron declare a valid Bun.cron expression (5 fields)", () => {
    for (const id of CHANNEL_ORDER) {
      const cron = CHANNEL_DEFS[id].cron;
      if (!cron) continue;
      const fields = cron.expr.trim().split(/\s+/);
      expect(fields.length, "cron for " + id + " has " + fields.length + " fields").toBe(5);
      expect(cron.title.length).toBeGreaterThan(0);
    }
  });
});
