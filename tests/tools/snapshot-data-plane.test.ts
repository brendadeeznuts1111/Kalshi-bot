// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  captureSnapshot,
  captureDataPlane,
  compressBuffer,
  computeFingerprint,
  decompressBuffer,
  findSnapshots,
  listSnapshots,
  pruneSnapshots,
  readRegistry,
  validateRegistry,
  type DataPlaneSnapshot,
} from "../../tools/snapshot-data-plane.ts";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "snapshot-test-"));
}

function makeMinimalSnapshot(ts = Date.now()): DataPlaneSnapshot {
  const iso = new Date(ts).toISOString();
  const snap: DataPlaneSnapshot = {
    v: 1,
    ts: iso,
    tsUnix: ts,
    run: `keeper-${iso.slice(0, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}`,
    fingerprint: "",
    rows: {
      events: 100,
      markets: 200,
      resolutions: 50,
      book_ticks: 1000,
      book_ticks_by_source: { "kalshi-rest": 900, "kalshi-ws": 100 },
      event_links: 80,
      live_scores: 5,
      score_snapshots: 5,
      player_profiles: 300,
      odds_ticks: 0,
    },
    files: {
      event_store_db: 1_000_000,
      cache_db: 500_000,
      ticker_map_db: 20_000,
      shadow_log_jsonl: 50_000,
    },
    coverage: {
      watchEvents: 2,
      watchTickers: 4,
      watchWithWs: 0,
      watchWithRest: 4,
      watchWithBoth: 0,
      watchWithNeither: 0,
      wsTicksTotal: 100,
      restTicksTotal: 900,
      wsExchangeClockPct: 64.2,
      linkedEventsWithWs: 0,
      linkedEventsTotal: 80,
    },
    canary: {
      exitCode: 0,
      watch: 2,
      polled: 2,
      live: 0,
      wouldUpsert: 0,
      wireOk: true,
      liveMatches: [],
    },
    blockers: {
      gh_auth: true,
      protonpass_session: true,
      kalshi_ws: true,
      odds_api: true,
    },
    sources: {
      "kalshi-rest-itf": { active: true, rows: 100, blocker: null },
      "kalshi-ws-books": { active: true, rows: 100, blocker: "KALSHI_API_KEY_ID" },
    },
  };
  snap.fingerprint = computeFingerprint(snap);
  return snap;
}

describe("snapshot-data-plane", () => {
  describe("computeFingerprint", () => {
    test("returns stable 8-char hex for identical objects", () => {
      const a = makeMinimalSnapshot(1_000_000);
      const b = makeMinimalSnapshot(1_000_000);
      expect(computeFingerprint(a)).toBe(computeFingerprint(b));
      expect(computeFingerprint(a)).toHaveLength(8);
    });

    test("returns different fingerprint for different objects", () => {
      const a = makeMinimalSnapshot(1_000_000);
      const b = makeMinimalSnapshot(2_000_000);
      expect(computeFingerprint(a)).not.toBe(computeFingerprint(b));
    });
  });

  describe("compression round-trip", () => {
    test("gzip compress + decompress preserves bytes", () => {
      const original = Buffer.from(JSON.stringify(makeMinimalSnapshot()));
      const compressed = compressBuffer(original);
      const decompressed = decompressBuffer(compressed);
      expect(decompressed.toString()).toBe(original.toString());
      expect(compressed.length).toBeLessThan(original.length);
    });
  });

  describe("captureSnapshot", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = makeTempDir();
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    test("writes artifact, registry, and index", async () => {
      const snapshot = await captureSnapshot({ registryDir: tmpDir });

      expect(snapshot.v).toBe(1);
      expect(snapshot.run).toMatch(/^keeper-\d{4}-\d{2}-\d{2}-\d{6}(-\d{3})?$/);
      expect(snapshot.fingerprint).toHaveLength(8);
      expect(snapshot.rows.events).toBeGreaterThan(0);

      // Check artifact file exists
      const artifactFile = Bun.file(`${tmpDir}/snapshots/${snapshot.run}-${snapshot.fingerprint}.json`);
      expect(await artifactFile.exists()).toBe(true);

      // Check index exists
      const indexFile = Bun.file(`${tmpDir}/index.json`);
      expect(await indexFile.exists()).toBe(true);
      const index = await indexFile.json();
      expect(index.totalSnapshots).toBe(1);
      expect(index.latestRun).toBe(snapshot.run);

      // Check hot registry exists
      const hotFile = Bun.file(`${tmpDir}/data-plane-snapshots.jsonl`);
      expect(await hotFile.exists()).toBe(true);
      const lines = (await hotFile.text()).trim().split("\n").filter(Boolean);
      expect(lines.length).toBe(1);

      // Verify fingerprint integrity in artifact
      const artifact = await artifactFile.json() as DataPlaneSnapshot;
      expect(artifact.fingerprint).toBe(computeFingerprint(artifact));
    });

    test("captureDataPlane is alias for captureSnapshot", async () => {
      const s1 = await captureSnapshot({ registryDir: tmpDir });
      await new Promise((r) => setTimeout(r, 100));
      const s2 = await captureDataPlane({ registryDir: tmpDir });
      expect(s1.v).toBe(1);
      expect(s2.v).toBe(1);
    });

    test("multiple captures append without collision", async () => {
      const s1 = await captureSnapshot({ registryDir: tmpDir });
      await new Promise((r) => setTimeout(r, 100));
      const s2 = await captureSnapshot({ registryDir: tmpDir });

      expect(s1.run).not.toBe(s2.run);
      expect(s1.fingerprint).not.toBe(s2.fingerprint);

      const indexFile = Bun.file(`${tmpDir}/index.json`);
      const index = await indexFile.json();
      expect(index.totalSnapshots).toBe(2);
    });
  });

  describe("readRegistry", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = makeTempDir();
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    test("reads empty registry gracefully", async () => {
      const entries = await readRegistry(tmpDir);
      expect(entries).toHaveLength(0);
    });

    test("reads and sorts entries by timestamp desc", async () => {
      await captureSnapshot({ registryDir: tmpDir });
      await new Promise((r) => setTimeout(r, 100));
      await captureSnapshot({ registryDir: tmpDir });

      const entries = await readRegistry(tmpDir);
      expect(entries.length).toBe(2);
      expect(entries[0]!.tsUnix).toBeGreaterThanOrEqual(entries[1]!.tsUnix);
    });
  });

  describe("pruneSnapshots", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = makeTempDir();
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    test("compresses entries older than threshold", async () => {
      const s1 = await captureSnapshot({ registryDir: tmpDir });

      // Manually override the artifact's timestamp to be 8 days old
      const artifactPath = `${tmpDir}/snapshots/${s1.run}-${s1.fingerprint}.json`;
      const artifact = await Bun.file(artifactPath).json() as DataPlaneSnapshot;
      artifact.tsUnix = Date.now() - 8 * 24 * 60 * 60 * 1000;
      artifact.ts = new Date(artifact.tsUnix).toISOString();
      await Bun.write(artifactPath, JSON.stringify(artifact, null, 2) + "\n");

      // Update index manually
      const indexFile = Bun.file(`${tmpDir}/index.json`);
      const index = await indexFile.json();
      index.entries[0].tsUnix = artifact.tsUnix;
      index.entries[0].ts = artifact.ts;
      await Bun.write(`${tmpDir}/index.json`, JSON.stringify(index, null, 2) + "\n");

      await captureSnapshot({ registryDir: tmpDir });

      const result = await pruneSnapshots(tmpDir, { compressAfterMs: 7 * 24 * 60 * 60 * 1000 });
      expect(result.compressed).toBe(1);
      expect(result.bytesSaved).toBeGreaterThan(0);

      // Old artifact should be removed, .gz should exist
      const oldGz = Bun.file(`${artifactPath}.gz`);
      expect(await oldGz.exists()).toBe(true);
      const oldJson = Bun.file(artifactPath);
      expect(await oldJson.exists()).toBe(false);
    });

    test("deletes oldest when over maxTotalSnapshots", async () => {
      for (let i = 0; i < 5; i++) {
        await captureSnapshot({ registryDir: tmpDir });
        await new Promise((r) => setTimeout(r, 50));
      }

      const result = await pruneSnapshots(tmpDir, { maxTotalSnapshots: 3 });
      expect(result.deleted).toBe(2);

      const indexFile = Bun.file(`${tmpDir}/index.json`);
      const index = await indexFile.json();
      expect(index.totalSnapshots).toBe(3);
    });
  });

  describe("validateRegistry", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = makeTempDir();
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    test("passes on valid fresh registry", async () => {
      await captureSnapshot({ registryDir: tmpDir });
      const result = await validateRegistry(tmpDir);
      expect(result.ok).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test("detects duplicate runs", async () => {
      await captureSnapshot({ registryDir: tmpDir });
      const hotFile = Bun.file(`${tmpDir}/data-plane-snapshots.jsonl`);
      const existing = await hotFile.text();
      await Bun.write(`${tmpDir}/data-plane-snapshots.jsonl`, existing + existing);

      const indexFile = Bun.file(`${tmpDir}/index.json`);
      const index = await indexFile.json();
      index.entries.push({ ...index.entries[0] });
      index.totalSnapshots = 2;
      await Bun.write(`${tmpDir}/index.json`, JSON.stringify(index, null, 2) + "\n");

      const result = await validateRegistry(tmpDir);
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.includes("duplicate run"))).toBe(true);
    });

    test("detects missing artifact files", async () => {
      await captureSnapshot({ registryDir: tmpDir });
      const indexFile = Bun.file(`${tmpDir}/index.json`);
      const index = await indexFile.json();
      index.entries[0].file = "snapshots/nonexistent.json";
      await Bun.write(`${tmpDir}/index.json`, JSON.stringify(index, null, 2) + "\n");

      const result = await validateRegistry(tmpDir);
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.includes("missing artifact"))).toBe(true);
    });
  });

  describe("findSnapshots", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = makeTempDir();
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    test("filters by date range", async () => {
      for (let i = 0; i < 3; i++) {
        await captureSnapshot({ registryDir: tmpDir });
        await new Promise((r) => setTimeout(r, 50));
      }

      const today = new Date().toISOString().slice(0, 10);
      const found = await findSnapshots({ from: today, to: today }, tmpDir);
      expect(found.length).toBe(3);
    });

    test("filters by hasLiveMatches", async () => {
      const snap = makeMinimalSnapshot();
      snap.canary.liveMatches = [{ ticker: "KXTEST", summary: "Test match" }];
      snap.fingerprint = computeFingerprint(snap);

      const run = snap.run;
      const fp = snap.fingerprint;
      await Bun.write(`${tmpDir}/snapshots/${run}-${fp}.json`, JSON.stringify(snap, null, 2) + "\n");

      const index = {
        v: 1,
        createdAt: snap.ts,
        updatedAt: snap.ts,
        totalSnapshots: 1,
        totalBytes: JSON.stringify(snap).length,
        compressedBytes: 0,
        latestRun: run,
        entries: [{
          run, ts: snap.ts, tsUnix: snap.tsUnix, fingerprint: fp,
          file: `snapshots/${run}-${fp}.json`, sizeBytes: JSON.stringify(snap).length,
          compressed: false, hasLiveMatches: true,
        }],
      };
      await Bun.write(`${tmpDir}/index.json`, JSON.stringify(index, null, 2) + "\n");

      const live = await findSnapshots({ hasLiveMatches: true }, tmpDir);
      expect(live.length).toBe(1);

      const notLive = await findSnapshots({ hasLiveMatches: false }, tmpDir);
      expect(notLive.length).toBe(0);
    });
  });

  describe("listSnapshots", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = makeTempDir();
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    test("returns newest first", async () => {
      for (let i = 0; i < 3; i++) {
        await captureSnapshot({ registryDir: tmpDir });
        await new Promise((r) => setTimeout(r, 50));
      }

      const list = await listSnapshots(tmpDir);
      expect(list.length).toBe(3);
      for (let i = 1; i < list.length; i++) {
        expect(list[i - 1]!.tsUnix).toBeGreaterThanOrEqual(list[i]!.tsUnix);
      }
    });
  });
});
