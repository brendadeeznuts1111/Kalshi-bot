/**
 * consensus-history tests — snapshot store round-trip, prune/dedupe, and
 * convergence classification against prior records (the movement-chip data
 * source). Store IO uses the caller's root so tests run on temp dirs.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OddsEvent } from "../../../src/alpha/odds-types.ts";
import {
  classifyAgainstHistory,
  currentRecords,
  latestRecord,
  loadSnapshotStore,
  mergeRecords,
  parseOddsXmlEvents,
  saveSnapshotStore,
} from "../../../src/institutions/odds-registry/index.ts";

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});
const root = () => {
  if (!dir) dir = mkdtempSync(join(tmpdir(), "odds-hist-"));
  return dir;
};

const feed = (home: string, price: number) =>
  `<odds-heat><cluster venue="51.5074,-0.1278" book="bet365" commence="2026-09-01T19:00:00Z">`
    + `<home team="${home}"/><away team="Beta FC"/>`
    + `<print name="A" american="${price}"/><print name="B" american="+100"/></cluster></odds-heat>`;

const events = (home = "Alpha FC", price = -200): OddsEvent[] =>
  parseOddsXmlEvents(feed(home, price), { sportKey: "soccer_epl" });

describe("currentRecords / latestRecord", () => {
  test("one record per event×side from the feed", () => {
    const recs = currentRecords(events());
    expect(recs).toHaveLength(2);
    expect(recs.every((r) => r.bookmakers === 1)).toBe(true);
    expect(recs.every((r) => r.consensus > 0 && r.consensus < 1)).toBe(true);
  });

  test("latestRecord picks the newest ts for the key", () => {
    const store = {
      records: [
        { eventId: "e1", side: "A", ts: 100, consensus: 0.5, spread: 0.01, bookmakers: 2 },
        { eventId: "e1", side: "A", ts: 200, consensus: 0.6, spread: 0.02, bookmakers: 3 },
        { eventId: "e1", side: "B", ts: 200, consensus: 0.4, spread: 0.01, bookmakers: 3 },
      ],
    };
    expect(latestRecord(store, "e1", "A")?.consensus).toBe(0.6);
    expect(latestRecord(store, "e1", "zz")).toBeNull();
  });
});

describe("mergeRecords", () => {
  test("dedupes identical snapshots and prunes by age", () => {
    const now = Date.now();
    const store = mergeRecords(
      { records: [{ eventId: "e", side: "A", ts: now - 25 * 3600_000, consensus: 0.1, spread: 0, bookmakers: 1 }] },
      [
        { eventId: "e", side: "A", ts: now - 60_000, consensus: 0.5, spread: 0.01, bookmakers: 2 },
        { eventId: "e", side: "A", ts: now - 60_000, consensus: 0.5, spread: 0.01, bookmakers: 2 },
        { eventId: "e", side: "A", ts: now, consensus: 0.52, spread: 0.01, bookmakers: 2 },
      ],
      now,
    );
    // old record pruned, duplicate dropped
    expect(store.records).toHaveLength(2);
    expect(store.records[0]!.consensus).toBe(0.5);
  });
});

describe("classifyAgainstHistory (movement)", () => {
  test("first build has no prior -> no patterns; second build classifies", async () => {
    const r = root();
    // Build 1: two books DISAGREEING (wide spread ≈ 7.6pp on side A)
    const wide = parseOddsXmlEvents(
      `<odds-heat><cluster venue="51.5074,-0.1278" book="bet365" commence="2026-09-01T19:00:00Z">`
        + `<home team="Alpha FC"/><away team="Beta FC"/>`
        + `<print name="A" american="-150"/><print name="B" american="+120"/></cluster>`
        + `<cluster venue="51.5074,-0.1278" book="pinnacle" commence="2026-09-01T19:00:00Z">`
        + `<print name="A" american="-110"/><print name="B" american="+110"/></cluster></odds-heat>`,
      { sportKey: "soccer_epl" },
    );
    let store = await loadSnapshotStore(r);
    expect(classifyAgainstHistory(store, wide)).toEqual([]);
    await saveSnapshotStore(r, mergeRecords(store, currentRecords(wide)));
    // Build 2: the field TIGHTENS onto the same price (spread ≈ 0.5pp)
    const tighter = parseOddsXmlEvents(
      `<odds-heat><cluster venue="51.5074,-0.1278" book="bet365" commence="2026-09-01T19:00:00Z">`
        + `<home team="Alpha FC"/><away team="Beta FC"/>`
        + `<print name="A" american="-200"/><print name="B" american="+102"/></cluster>`
        + `<cluster venue="51.5074,-0.1278" book="pinnacle" commence="2026-09-01T19:00:00Z">`
        + `<print name="A" american="-201"/><print name="B" american="+101"/></cluster></odds-heat>`,
      { sportKey: "soccer_epl" },
    );
    store = await loadSnapshotStore(r);
    const patterns = classifyAgainstHistory(store, tighter);
    expect(patterns.some((p) => p.kind === "converging")).toBe(true);
    await saveSnapshotStore(r, mergeRecords(store, currentRecords(tighter)));
  });

  test("round-trips through the store file", async () => {
    const r = root();
    await saveSnapshotStore(r, mergeRecords({ records: [] }, currentRecords(events())));
    const store = await loadSnapshotStore(r);
    expect(store.records).toHaveLength(2);
    expect(latestRecord(store, events()[0]!.id, "A")).not.toBeNull();
  });
});
