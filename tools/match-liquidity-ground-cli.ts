#!/usr/bin/env bun
// @see https://bun.com/docs/guides/process/argv
// @see https://bun.com/docs/runtime/webview
// @see https://bun.com/docs/runtime/image
/**
 * Render match_liquidity dashboard via Bun.WebView + Bun.Image thumb.
 *
 *   bun run liquidity:ground
 *   bun run liquidity:ground -- --html-only
 *   bun run liquidity:ground -- --recompute --json
 *   bun run liquidity:ground -- --fetch-volume --html-only   # network: backfill market volumes
 */
import { parseArgs } from "node:util";
import { ensureEventStoreDir, openEventStore } from "../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../src/institutions/event-store/paths.ts";
import { recomputeMatchLiquidity } from "../src/institutions/event-store/match-liquidity.ts";
import { backfillQuotedMarketVolumes } from "../src/institutions/event-store/match-liquidity-backfill.ts";
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
      "fetch-volume": { type: "boolean", default: false },
      "volume-limit": { type: "string" },
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
  let backfill: Awaited<ReturnType<typeof backfillQuotedMarketVolumes>> | null = null;
  if (values["fetch-volume"] === true) {
    const volLimit = values["volume-limit"] ? Number(values["volume-limit"]) : 80;
    backfill = await backfillQuotedMarketVolumes(db, {
      limit: Number.isFinite(volLimit) ? volLimit : 80,
    });
    if (values.json !== true) {
      console.log(
        `volume backfill: candidates=${backfill.candidates} updated=${backfill.updated} errors=${backfill.errors}`,
      );
    }
  }

  const limit = values.limit ? Number(values.limit) : undefined;
  const artifact = await captureMatchLiquidityGround(db, {
    ...(limit !== undefined && Number.isFinite(limit) ? { limit } : {}),
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
          backfill,
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
