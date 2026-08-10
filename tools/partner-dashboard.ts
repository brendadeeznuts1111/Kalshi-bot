#!/usr/bin/env bun
/**
 * Bake a thin static partner ops board (no Vite / React).
 *
 *   bun run partner:dashboard
 *   bun run partner:dashboard -- --open
 *   bun run partner:dashboard -- --out=public/partner-dashboard
 *
 * Then: bun run serve  →  /partner-dashboard/
 *
 * @see docs/SEAT-OPS.md
 */
import { argValue, hasFlag } from '../src/cli/argv.ts';
// @see https://bun.com/docs/runtime/sqlite
// @see https://bun.com/docs/api/file-io
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openEventStore } from "../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../src/institutions/event-store/paths.ts";
import {
  buildPartnerDashboardSnapshot,
  renderPartnerDashboardHtml,
} from "../src/partner/dashboard-data.ts";
import { parseRiskThreshold } from "../src/partner/risk-health.ts";



async function main(): Promise<void> {
  const outDir =
    argValue("out") ?? join(process.cwd(), "public/partner-dashboard");
  mkdirSync(outDir, { recursive: true });

  const db = openEventStore({ dbPath: DEFAULT_EVENT_STORE_DB });
  const data = await buildPartnerDashboardSnapshot(db, {
    riskThreshold: parseRiskThreshold(
      argValue("risk-threshold") ?? process.env.PARTNER_FINANCE_RISK_THRESHOLD,
      "warn",
    ),
  });

  const htmlPath = join(outDir, "index.html");
  const jsonPath = join(outDir, "state.json");
  const html = renderPartnerDashboardHtml(data);

  await Bun.write(htmlPath, html);
  await Bun.write(jsonPath, JSON.stringify(data, null, 2) + "\n");

  console.log(
    JSON.stringify(
      {
        ok: data.ok,
        htmlPath,
        jsonPath,
        generatedAt: data.generatedAt,
        registry: data.registry,
        risk: {
          ok: data.risk.ok,
          errors: data.risk.errorCount,
          warns: data.risk.warnCount,
        },
        serve: "bun run serve  →  http://localhost:<port>/partner-dashboard/",
      },
      null,
      2,
    ),
  );

  if (hasFlag("open")) {
    const fileUrl = Bun.pathToFileURL(htmlPath).href;
    Bun.spawn(["open", fileUrl], { stdout: "ignore", stderr: "ignore" });
  }
}

await main();
