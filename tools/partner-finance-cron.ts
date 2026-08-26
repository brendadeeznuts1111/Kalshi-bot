#!/usr/bin/env bun
/**
 * Registry-driven partner desk / finance report (once).
 *
 *   bun run partner:finance-cron
 *   bun run partner:finance-cron -- --once
 *   bun run partner:finance-cron -- --strict-env
 *   bun run partner:finance-cron -- --partner=SPEN --json
 *   bun run partner:finance-cron -- --notify --probe-login
 *
 * Cron master: PARTNER_FINANCE_CRON=1 bun run cron:start
 */
import { argValue, hasFlag } from '../src/cli/argv.ts';
// @see https://bun.com/docs/runtime/sqlite
import { openEventStore } from "../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../src/institutions/event-store/paths.ts";
import {
  formatFinanceCronReportText,
  runFinanceCron,
} from "../src/partner/finance-cron.ts";



async function main(): Promise<void> {
  const db = openEventStore({ dbPath: DEFAULT_EVENT_STORE_DB });
  try {
    const partnerFilter = argValue("partner");
    const riskThreshold = argValue("risk-threshold") as
      | "error"
      | "warn"
      | "info"
      | "off"
      | undefined;
    const report = await runFinanceCron(db, {
      strictEnv: hasFlag("strict-env"),
      ...(partnerFilter !== undefined ? { partnerFilter } : {}),
      probeLogin:
        hasFlag("probe-login") ||
        process.env.PARTNER_FINANCE_PROBE_LOGIN === "1",
      probeInventory: !hasFlag("no-inventory"),
      notify:
        hasFlag("notify") ||
        process.env.PARTNER_FINANCE_NOTIFY === "1" ||
        process.env.PARTNER_TELEGRAM_NOTIFY === "true",
      riskAlert:
        hasFlag("risk-alert") ||
        hasFlag("notify") ||
        process.env.PARTNER_FINANCE_RISK_ALERT === "1" ||
        process.env.PARTNER_FINANCE_NOTIFY === "1",
      riskDigest:
        hasFlag("risk-digest") ||
        process.env.PARTNER_FINANCE_RISK_DIGEST === "1",
      riskForce:
        hasFlag("risk-force") ||
        process.env.PARTNER_FINANCE_RISK_FORCE === "1",
      ...(riskThreshold !== undefined ? { riskThreshold } : {}),
      riskIncludeHealthJson: !hasFlag("no-health-json"),
      autoWsIngest:
        hasFlag("auto-ws-ingest") ||
        process.env.PARTNER_FINANCE_AUTO_WS_INGEST === "1",
      autoWsIngestAfterHours: Number(
        argValue("auto-ws-ingest-hours") ??
          process.env.PARTNER_FINANCE_AUTO_WS_INGEST_HOURS ??
          "24",
      ),
      webviewOdds:
        hasFlag("webview") || process.env.PARTNER_FINANCE_WEBVIEW === "1",
    });

    if (hasFlag("json")) {
      // strip nothing secret — risk findings already safe
      console.log(
        JSON.stringify(
          {
            ...report,
            risk: report.risk
              ? {
                  ok: report.risk.ok,
                  errorCount: report.risk.errorCount,
                  warnCount: report.risk.warnCount,
                  findings: report.risk.findings,
                }
              : undefined,
          },
          null,
          2,
        ),
      );
    } else {
      console.log(formatFinanceCronReportText(report));
      if (report.risk) {
        const { formatRiskHealthText } = await import(
          "../src/partner/risk-health.ts"
        );
        console.error(formatRiskHealthText(report.risk));
      }
      if (report.notified) console.error("telegram: desk notified");
      if (report.riskNotified) console.error("telegram: risk alert notified");
      if (report.riskAlertDeduped) {
        console.error("telegram: risk alert deduped (unchanged fingerprint)");
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`finance-cron error: ${msg}`);
    process.exitCode = 2;
  }
}

await main();
