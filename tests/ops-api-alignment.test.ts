// @see https://bun.com/docs/test/index#run-tests
/**
 * API ↔ dashboard alignment contract.
 *
 * The /ops dashboard must render the SAME truths the API endpoints report —
 * if these disagree, the board is lying to operators.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { deleteRun, saveRun } from "../src/research/cache.ts";
import { createResearchServer } from "../src/research/serve.ts";
import type { ResearchRun } from "../src/research/types.ts";
import { freshTestGeneratedAt, mintTestProductionRunId } from "./fixtures.ts";

let server: ReturnType<typeof createResearchServer>;
let base: string;
/** Worktree/operator caches may have zero production runs; seed one for prefix alignment. */
const SEED_RUN_ID = mintTestProductionRunId();

beforeAll(() => {
  const at = freshTestGeneratedAt();
  const run: ResearchRun = {
    runId: SEED_RUN_ID,
    kind: "production",
    source: "pipeline",
    generatedAt: at,
    dimension: "all",
    config: { shortlistSize: 12, gate: { minStars: 5, minForks: 3, maxAgeMonths: 18 } },
    stats: { discovered: 1, gated: 1, inspected: 1, shortlist: 0 },
    candidates: [],
    gated: [],
    scored: [],
    shortlist: [],
    excludedSdkOnly: [],
  };
  saveRun(SEED_RUN_ID, at, run);
  server = createResearchServer({ port: 0 });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop(true);
  deleteRun(SEED_RUN_ID);
});

async function json<T = Record<string, unknown>>(path: string): Promise<T> {
  const res = await fetch(`${base}${path}`);
  expect(res.status).toBe(200);
  return (await res.json()) as T;
}

describe("ops dashboard ↔ API alignment", () => {
  test("ops.json agents match /polymarket/status agents", async () => {
    const ops = await json<{ agents: Record<string, boolean> }>("/ops.json");
    const status = await json<{ agents: Record<string, boolean> }>("/polymarket/status");
    expect(Object.keys(ops.agents).sort()).toEqual(Object.keys(status.agents).sort());
    for (const [name, up] of Object.entries(status.agents)) {
      expect(ops.agents[name]).toBe(up);
    }
  });

  test("/ops HTML renders every agent the API reports", async () => {
    const status = await json<{ agents: Record<string, boolean> }>("/polymarket/status");
    const html = await (await fetch(`${base}/ops`)).text();
    for (const name of Object.keys(status.agents)) {
      expect(html).toContain(name);
    }
  });

  test("ops.json runs are a prefix of /api/runs", async () => {
    const ops = await json<{ runs: { runId: string }[] }>("/ops.json");
    const api = await json<{ runs: { runId: string }[] }>("/api/runs");
    expect(ops.runs.length).toBeGreaterThan(0);
    const apiIds = api.runs.map(r => r.runId);
    for (const r of ops.runs) {
      expect(apiIds).toContain(r.runId);
    }
    // Same ordering (newest first) for the rendered window
    expect(ops.runs[0]!.runId).toBe(api.runs[0]!.runId);
  });

  test("server.tickCount matches /polymarket/ticks length", async () => {
    const ops = await json<{ server: { tickCount: number; lineMoveCount: number } }>("/ops.json");
    const ticksRes = await json<unknown>("/polymarket/ticks");
    const movesRes = await json<unknown>("/polymarket/line-moves");
    // API wraps collections: { ticks: [...] } / { lineMoves: [...] } (or bare array).
    const len = (v: unknown, key: string): number =>
      Array.isArray(v) ? v.length
      : v && typeof v === "object" && Array.isArray((v as Record<string, unknown>)[key])
        ? ((v as Record<string, unknown[]>)[key]!).length
        : Number.NaN;
    const tickLen = len(ticksRes, "ticks");
    const moveLen = len(movesRes, "lineMoves");
    expect(Number.isNaN(tickLen)).toBe(false);
    expect(Number.isNaN(moveLen)).toBe(false);
    expect(ops.server.tickCount).toBe(tickLen);
    expect(ops.server.lineMoveCount).toBe(moveLen);
  });

  test("/ops HTML flow labels and fire times match ops.json", async () => {
    const ops = await json<{ flows: { label: string; lastFireAt: string | null }[] }>("/ops.json");
    const html = await (await fetch(`${base}/ops`)).text();
    for (const flow of ops.flows) {
      expect(html).toContain(flow.label);
      if (flow.lastFireAt) {
        // Rendered as ISO timestamp somewhere on the page
        expect(html).toContain(flow.lastFireAt.slice(0, 19));
      }
    }
  });

  test("ops.json carries the server block the HTML Server panel renders", async () => {
    const ops = await json<{ server: { bunVersion: string; rssMb: number; uptimeSec: number } }>("/ops.json");
    const html = await (await fetch(`${base}/ops`)).text();
    expect(html).toContain(`Bun ${ops.server.bunVersion}`);
    expect(ops.server.rssMb).toBeGreaterThan(0);
    expect(ops.server.uptimeSec).toBeGreaterThanOrEqual(0);
  });
});
