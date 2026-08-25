/**
 * pipeline-status.ts — shared pipeline health collection.
 *
 * Reads the gate state files (.data/*.json), the cache DBs and the design
 * metafiles and returns one row per gate. Used by the ops:pipelines CLI
 * (scripts/pipeline-status.ts) and by the server (/ops page, /status JSON).
 * Fully offline: no network, no subprocess.
 */
import { join } from "node:path";
import { readdirSync, statSync, existsSync } from "node:fs";
import { Database } from "bun:sqlite";

export const ROOT = join(import.meta.dir, "..", "..");
export const DATA_DIR = join(ROOT, ".data");

export type PipelineStatusRow = {
  pipeline: string;
  gate: string;
  ok: boolean | null;
  detail: string;
  ageDays: number | null;
};

async function readState(file: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = JSON.parse(await Bun.file(join(DATA_DIR, file)).text());
    return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function pushState(
  rows: PipelineStatusRow[],
  pipeline: string,
  gate: string,
  file: string,
  detailOf: (s: Record<string, unknown>) => string,
): Promise<void> {
  const s = await readState(file);
  if (!s || s.lastChecked === undefined) {
    rows.push({ pipeline, gate, ok: null, detail: "not run — seed with the gate", ageDays: null });
    return;
  }
  const ok = s.ok !== false;
  const ageDays = (Date.now() - new Date(String(s.lastChecked)).getTime()) / 86400000;
  rows.push({ pipeline, gate, ok, detail: detailOf(s), ageDays });
}

function sqlCount(dbPath: string, sql: string): number | null {
  if (!existsSync(dbPath)) return null;
  try {
    const db = new Database(dbPath, { readonly: true });
    const row = db.query(sql).get() as { n?: number } | null;
    db.close();
    return typeof row?.n === "number" ? row.n : null;
  } catch {
    return null;
  }
}

/** Collect every pipeline gate row (docs, compliance, mapping, data, design). */
export async function collectPipelineStatus(): Promise<PipelineStatusRow[]> {
  const rows: PipelineStatusRow[] = [];

  await pushState(rows, "docs", "docs:render", "docs-state.json", (s) => String(s.total ?? 0) + " markdown file(s)");
  await pushState(rows, "docs", "docs:api", "api-state.json", (s) => String(s.tokens ?? 0) + " tokens · " + String(s.fails ?? 0) + " drift" + (s.strict ? " (STRICT)" : ""));
  await pushState(rows, "docs", "docs:integrity", "integrity-state.json", (s) => String(s.links ?? 0) + " links · " + String(s.staleSrc ?? 0) + " stale src");
  await pushState(rows, "docs", "output:probe", "output-state.json", (s) => String(s.assertions ?? 0) + " assertions");
  await pushState(rows, "compliance", "licenses:gate", "licenses-state.json", (s) => String(s.packages ?? 0) + " prod packages · " + String(s.fails ?? 0) + " violations");
  await pushState(rows, "mapping", "blog-map", "blog-map-state.json", (s) => Math.round(Number(s.coverage ?? 0) * 100) + "% coverage · " + String(s.matched ?? 0) + " mapped");

  const masseyDb = join(ROOT, "research/cache/massey.db");
  const evDb = join(ROOT, "research/cache/event-store.db");
  const masseySports = sqlCount(masseyDb, "SELECT COUNT(DISTINCT sport) as n FROM massey_ratings");
  const masseyRatings = sqlCount(masseyDb, "SELECT COUNT(*) as n FROM massey_ratings");
  rows.push({
    pipeline: "data", gate: "massey",
    ok: masseySports !== null && masseySports > 0,
    detail: existsSync(masseyDb) ? masseySports + " sport(s) · " + masseyRatings + " ratings" : "db missing — run bun run massey:sync",
    ageDays: null,
  });
  const events = sqlCount(evDb, "SELECT COUNT(*) as n FROM events");
  const markets = sqlCount(evDb, "SELECT COUNT(*) as n FROM markets");
  rows.push({
    pipeline: "data", gate: "event-store",
    ok: (events ?? 0) > 0,
    detail: existsSync(evDb) ? events + " events · " + markets + " markets" : "db missing — run tennis:itf --sync",
    ageDays: null,
  });

  const dist = join(ROOT, "dist");
  const metas = existsSync(dist) ? readdirSync(dist).filter((f) => f.endsWith(".meta.json")) : [];
  const metaBytes = metas.reduce((acc, f) => acc + (statSync(join(dist, f)).size || 0), 0);
  rows.push({
    pipeline: "design", gate: "metafiles",
    ok: metas.length > 0,
    detail: metas.length + " module metafile(s) · " + (metaBytes / 1024).toFixed(1) + " KB — run bun run design:build",
    ageDays: null,
  });

  return rows;
}

export function summarizePipelines(rows: PipelineStatusRow[]): { checks: number; failing: number; ok: number } {
  return {
    checks: rows.length,
    ok: rows.filter((r) => r.ok === true).length,
    failing: rows.filter((r) => r.ok === false).length,
  };
}

/** Render the terminal table (used by the ops:pipelines CLI). */
export function renderPipelineStatus(rows: PipelineStatusRow[]): string {
  const paint = (ok: boolean | null): string => (ok === true ? "ok  " : ok === false ? "FAIL" : "----");
  const out = ["ops:pipelines — pipeline health (" + Bun.version + ")", "pipeline     gate                status  detail"];
  for (const r of [...rows].sort((a, b) => (a.pipeline + a.gate).localeCompare(b.pipeline + b.gate))) {
    const age = r.ageDays === null ? "" : " · " + (r.ageDays > 30 ? "stale " + Math.round(r.ageDays) + "d" : r.ageDays > 1 ? Math.round(r.ageDays) + "d" : "fresh");
    out.push(r.pipeline.padEnd(12) + r.gate.padEnd(20) + paint(r.ok) + "  " + r.detail + age);
  }
  const s = summarizePipelines(rows);
  out.push("--- " + s.checks + " checks · " + s.failing + " failing" + (s.failing ? " — run the failing gates" : ""));
  return out.join("\n");
}
