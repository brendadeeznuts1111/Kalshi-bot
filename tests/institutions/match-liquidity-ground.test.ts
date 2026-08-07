// @see https://bun.com/docs/test/index#run-tests
import { describe, expect, test } from "bun:test";
import type { BookSnapshot } from "../../src/institutions/alpha-signal-types.ts";
import { openEventStore } from "../../src/institutions/event-store/open-db.ts";
import {
  recomputeMatchLiquidity,
  summarizeMatchLiquidity,
} from "../../src/institutions/event-store/match-liquidity.ts";
import {
  loadMatchLiquidityDashboardModel,
  renderMatchLiquidityDashboardHtml,
} from "../../src/institutions/event-store/match-liquidity-dashboard.ts";
import {
  captureMatchLiquidityGround,
  formatMatchLiquidityGroundLines,
  persistMatchLiquidityGroundArtifact,
} from "../../src/institutions/event-store/match-liquidity-ground.ts";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const tightBook: BookSnapshot = {
  ts: Date.now(),
  seq: 1,
  bids: [{ priceCents: 48, size: 20 }],
  asks: [{ priceCents: 51, size: 20 }],
};

function seedQuoted(db: ReturnType<typeof openEventStore>): void {
  const now = Date.now();
  db.query(
    `INSERT INTO events (
       event_id, tour, level, tournament, location, surface, court, round,
       player_a, player_b, winner, loser, start_ts, outcome,
       source, source_row_hash, ingested_at, corpus
     ) VALUES (
       'g1', 'ATP', 'MS', 'Ground Cup', '', 'Hard', '', 'R32',
       'A', 'B', '', '', '2026-08-01T12:00:00.000Z', '',
       'test', 'hash-g1', $ing, 'trading'
     )`,
  ).run({ $ing: now });
  db.query(
    `INSERT INTO markets (
       market_id, event_id, venue, ticker, market_kind,
       volume_fp, volume_24h_fp, open_interest_fp, source
     ) VALUES ('mg1', 'g1', 'kalshi', 'TICK-G1', 'match_winner', '2000', '900', '1', 'test')`,
  ).run();
  db.query(
    `INSERT INTO book_ticks (
       event_id, ticker, market_kind, ts, recv_ts, source_clock, levels_json, source
     ) VALUES ('g1', 'TICK-G1', 'match_winner', $ts, $ts, 'recv', $json, 'test')`,
  ).run({ $ts: now, $json: JSON.stringify(tightBook) });
  recomputeMatchLiquidity(db, "g1");
}

describe("match-liquidity ground + snapshot summary", () => {
  test("summarize + HTML dashboard", () => {
    const db = openEventStore({ dbPath: ":memory:" });
    seedQuoted(db);
    const sum = summarizeMatchLiquidity(db);
    expect(sum.tablePresent).toBe(true);
    expect(sum.total).toBe(1);
    expect(sum.quoted).toBe(1);
    expect(sum.liquidityOk).toBe(1);
    expect(sum.tradable).toBe(1);

    const model = loadMatchLiquidityDashboardModel(db);
    expect(model.rows.length).toBe(1);
    const html = renderMatchLiquidityDashboardHtml(model);
    expect(html).toContain("Match liquidity");
    expect(html).toContain("tradable");
    expect(html).toContain("Ground Cup");
  });

  test("html-only ground writes artifacts", async () => {
    const db = openEventStore({ dbPath: ":memory:" });
    seedQuoted(db);
    const outDir = mkdtempSync(join(tmpdir(), "liq-ground-"));
    const artifact = await captureMatchLiquidityGround(db, { htmlOnly: true, outDir });
    expect(artifact.webview).toBe(false);
    expect(artifact.snapshotMeta?.runtime.bunVersion).toBe(Bun.version);
    expect(artifact.snapshotMeta?.webview.width).toBe(1280);
    expect(artifact.snapshotMeta?.image.thumbnail).toBeNull();
    expect(await Bun.file(artifact.dashboardHtml).exists()).toBe(true);
    const html = await Bun.file(artifact.dashboardHtml).text();
    expect(html).toContain("liq_ok");
    const latest = await persistMatchLiquidityGroundArtifact(
      artifact,
      join(outDir, "latest.json"),
    );
    expect(latest.tradable).toBe(1);
    expect(latest.rows).toBe(1);
    expect(latest.snapshotMeta.schemaVersion).toBe(1);
    const lines = formatMatchLiquidityGroundLines(artifact);
    expect(lines.some((l) => l.includes("webview=skipped"))).toBe(true);
  });
});
