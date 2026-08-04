#!/usr/bin/env bun
// @see https://bun.com/docs/guides/process/argv
// @see https://bun.com/docs/runtime/webview
// @see https://bun.com/docs/runtime/image
/**
 * Render match_liquidity dashboard via Bun.WebView + Bun.Image thumb.
 * Zero network — reads event-store only.
 *
 *   bun run liquidity:ground
 *   bun run liquidity:ground -- --html-only
 *   bun run liquidity:ground -- --recompute --json
 */
import { parseArgs } from "node:util";
import { ensureEventStoreDir, openEventStore } from "../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../src/institutions/event-store/paths.ts";
import { recomputeMatchLiquidity } from "../src/institutions/event-store/match-liquidity.ts";
import {
  captureMatchLiquidityGround,
  formatMatchLiquidityGroundLines,
  persistMatchLiquidityGroundArtifact,
} from "../src/institutions/event-store/match-liquidity-ground.ts";

export async function runMatchLiquidityGroundCli(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      db: { type: "string" },
      limit: { type: "string" },
      "html-only": { type: "boolean", default: false },
      recompute: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
    strict: false,
  });

  await ensureEventStoreDir();
  const dbPath = typeof values.db === "string" ? values.db : DEFAULT_EVENT_STORE_DB;
  const db = openEventStore({ dbPath });
  if (values.recompute === true) {
    const n = recomputeMatchLiquidity(db);
    if (values.json !== true) console.log(`recompute: ${n} match_liquidity row(s)`);
  }

  const limit = values.limit ? Number(values.limit) : undefined;
  const artifact = await captureMatchLiquidityGround(db, {
    limit: Number.isFinite(limit) ? limit : undefined,
    htmlOnly: values["html-only"] === true,
  });
  await persistMatchLiquidityGroundArtifact(artifact);

  if (values.json) {
    console.log(
      JSON.stringify(
        {
          at: artifact.at,
          webview: artifact.webview,
          image: artifact.image,
          summary: artifact.model.summary,
          paths: {
            html: artifact.dashboardHtml,
            png: artifact.dashboardPng,
            thumb: artifact.thumbWebp,
          },
        },
        null,
        2,
      ),
    );
  } else {
    console.log(formatMatchLiquidityGroundLines(artifact).join("\n"));
  }
  return 0;
}

if (import.meta.main) {
  process.exit(await runMatchLiquidityGroundCli(process.argv.slice(2)));
}
