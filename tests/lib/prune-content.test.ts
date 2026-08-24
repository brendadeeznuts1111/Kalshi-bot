// Content pruning decision-matrix tests (archive vs delete, §25).
// @see docs/AGENT-PITFALLS.md §25 (Bun.rename missing, ensureDirectory not an API)
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_THRESHOLDS,
  applyPrune,
  archiveRemovedFiles,
  changelogEntry,
  planPrune,
  restoreContent,
  scanDirectory,
  type FileRecord,
} from "../../src/lib/prune-content.ts";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const record = (path: string, size: number, mtime: string, hash?: string): FileRecord => ({
  path,
  absPath: "/unused/" + path,
  size,
  mtime,
  ...(hash ? { hash } : {}),
});
const OLD = "2020-01-01T00:00:00.000Z";
const NOW = new Date().toISOString();

describe("planPrune decision matrix", () => {
  test("referenced -> keep", () => {
    const p = planPrune([record("a.md", 10, NOW)], ["a.md"]);
    expect(p.rows[0]!.decision).toBe("keep");
  });
  test("unreferenced duplicate -> delete", () => {
    const p = planPrune(
      [
        record("a.bin", 10, NOW, "h1"),
        record("b.bin", 10, NOW, "h1"),
        record("c.md", 10, NOW, "h2"),
      ],
      [],
    );
    expect(p.rows.find((r) => r.file.path === "a.bin")!.decision).toBe("delete");
    expect(p.rows.find((r) => r.file.path === "b.bin")!.decision).toBe("delete");
    expect(p.rows.find((r) => r.file.path === "c.md")!.decision).toBe("keep"); // young, no dup
  });
  test("unreferenced + stale -> delete", () => {
    const p = planPrune([record("old.bin", 10, OLD)], []);
    expect(p.rows[0]!.decision).toBe("delete");
  });
  test("unreferenced + large -> archive", () => {
    const p = planPrune([record("big.bin", 200 * 1024 * 1024, NOW)], []);
    expect(p.rows[0]!.decision).toBe("archive");
  });
  test("referenced + large -> review", () => {
    const p = planPrune([record("big.md", 200 * 1024 * 1024, NOW)], ["big.md"]);
    expect(p.rows[0]!.decision).toBe("review");
  });
  test("historically significant opt -> archive", () => {
    const p = planPrune(
      [record("draft.md", 10, NOW)],
      [],
      DEFAULT_THRESHOLDS,
      { historicallySignificant: (f) => f.path.includes("draft") },
    );
    expect(p.rows[0]!.decision).toBe("archive");
  });
});

describe("applyPrune -> .trash/ + sidecar", () => {
  test("moves file and writes .meta.json with verified fields", async () => {
    const root = mkdtempSync(join(tmpdir(), "prune-"));
    mkdirSync(join(root, "content"), { recursive: true });
    writeFileSync(join(root, "content", "dup-a.bin"), "same-bytes");
    writeFileSync(join(root, "content", "dup-b.bin"), "same-bytes");
    const files = await scanDirectory(root, "content", { hash: true });
    const plan = planPrune(files, []);
    const row = plan.rows.find((r) => r.file.path === "content/dup-b.bin")!;
    expect(row.decision).toBe("delete");
    const meta = await applyPrune(row, root);
    rmSync(root, { recursive: true, force: true });
    expect(meta).not.toBeNull();
    expect(meta!.action).toBe("deleted");
    expect(meta!.originalPath).toBe("content/dup-b.bin");
    expect(meta!.reason).toContain("duplicate");
    expect(meta!.size).toBe(10);
    expect(meta!.hash).toBeTruthy();
    expect(meta!.performedBy).toBe("prune-script");
    expect(meta!.archivedAt).toBeTruthy();
  });

  test("renameSync semantics: missing file -> null (no throw)", async () => {
    const root = mkdtempSync(join(tmpdir(), "prune-"));
    const meta = await applyPrune(
      { file: record("gone.bin", 1, NOW), decision: "delete", reason: "x" },
      root,
    );
    rmSync(root, { recursive: true, force: true });
    expect(meta).toBeNull();
  });
});

describe("archiveRemovedFiles (Bun.Archive, §26)", () => {
  test("bundles removed files into a gzip tarball that round-trips", async () => {
    const root = mkdtempSync(join(tmpdir(), "prune-arch-"));
    mkdirSync(join(root, "content"), { recursive: true });
    writeFileSync(join(root, "content", "a.txt"), "hello a");
    writeFileSync(join(root, "content", "b.txt"), "hello b");
    const files = await scanDirectory(root, "content");
    const plan = planPrune(files, []); // both unreferenced
    // move them first (archiveRemovedFiles bundles the .trash copies)
    const rows: Array<{ file: FileRecord; decision: "delete" | "archive"; reason: string }> = [];
    for (const row of plan.rows) {
      await applyPrune(row, root);
      rows.push({ file: row.file, decision: "delete", reason: row.reason });
    }
    const info = await archiveRemovedFiles(rows, root);
    expect(info).not.toBeNull();
    expect(info!.entries).toBe(2);
    expect(info!.path).toMatch(/\.tar\.gz$/);
    expect(info!.bytes).toBeGreaterThan(0);
    // extract + verify contents
    const outDir = join(root, "extracted");
    const archive = new Bun.Archive(await Bun.file(info!.path).bytes());
    const n = await archive.extract(outDir);
    expect(n).toBe(2);
    expect(await Bun.file(join(outDir, "content", "a.txt")).text()).toBe("hello a");
    expect(await Bun.file(join(outDir, "content", "b.txt")).text()).toBe("hello b");
    rmSync(root, { recursive: true, force: true });
  });
});

describe("restoreContent (§27)", () => {
  test("restores a pruned file from .trash via its sidecar", async () => {
    const root = mkdtempSync(join(tmpdir(), "prune-rest-"));
    mkdirSync(join(root, "content"), { recursive: true });
    writeFileSync(join(root, "content", "gone.md"), "recover me");
    const files = await scanDirectory(root, "content");
    const plan = planPrune(files, []);
    const row = plan.rows[0]!;
    await applyPrune(row, root);
    expect(existsSync(join(root, "content", "gone.md"))).toBe(false);
    const restored = await restoreContent("content/gone.md", root);
    expect(restored).toBe("content/gone.md");
    expect(readFileSync(join(root, "content", "gone.md"), "utf8")).toBe("recover me");
    rmSync(root, { recursive: true, force: true });
  });

  test("restore of an unknown path returns null", async () => {
    const root = mkdtempSync(join(tmpdir(), "prune-rest-"));
    const restored = await restoreContent("content/nope.md", root);
    rmSync(root, { recursive: true, force: true });
    expect(restored).toBeNull();
  });
});

describe("changelogEntry", () => {
  test("appends the doc-shaped entry with counts + paths", () => {
    const rows = [
      { file: record("a.bin", 1, NOW), decision: "delete" as const, reason: "dup" },
      { file: record("b.bin", 1, NOW), decision: "archive" as const, reason: "large" },
    ];
    const entry = changelogEntry(rows, ".data/prune-report.json");
    expect(entry).toContain("Deleted 1");
    expect(entry).toContain("a.bin");
    expect(entry).toContain("Archived 1");
    expect(entry).toContain("b.bin");
    expect(entry).toContain("prune-report.json");
  });
});

describe("scanDirectory", () => {
  test("recursive scan + hash, skips .trash", async () => {
    const root = mkdtempSync(join(tmpdir(), "prune-"));
    mkdirSync(join(root, "content", "sub"), { recursive: true });
    mkdirSync(join(root, ".trash", "x"), { recursive: true });
    writeFileSync(join(root, "content", "a.md"), "aaa");
    writeFileSync(join(root, "content", "sub", "b.md"), "bbb");
    writeFileSync(join(root, ".trash", "x", "gone.md"), "gone");
    const files = await scanDirectory(root, "content", { hash: true });
    rmSync(root, { recursive: true, force: true });
    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual(["content/a.md", "content/sub/b.md"]);
    expect(files[0]!.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
