#!/usr/bin/env bun
/**
 * Partner domain health — registry + capacity + env presence + optional TOML drift.
 *
 *   bun run partner:health
 *   bun run partner:health -- --json
 *   bun run partner:health -- --strict-env   # exit 2 if secrets missing
 *   bun run partner:health -- --toml=config/partners.toml
 *
 * Does not print secret values.
 */
// @see https://bun.com/docs/runtime/sqlite
import { openEventStore } from "../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../src/institutions/event-store/paths.ts";
import { buildOpsStatusReport } from "../src/partner/architecture.ts";
import {
  computeProviderCapacity,
  ensurePartnerRegistrySchema,
  listActiveBettingAccounts,
} from "../src/partner/registry.ts";
import {
  checkPartnersEnvPresence,
  diffPartnersTomlVsDb,
  formatEnvPresenceText,
  formatPartnersDiffText,
  loadPartnersTomlFile,
  loadRegistrySnapshot,
} from "../src/partner/toml-config.ts";
import { listLedgerFreshness } from "../src/partner/ledger.ts";
import {
  evaluateRiskHealth,
  formatRiskHealthText,
  parseRiskThreshold,
  riskOkUnderThreshold,
  toRiskHealthJsonSnapshot,
} from "../src/partner/risk-health.ts";
import { getPartnerVisual } from "../src/partner/visuals.ts";
import { parseOutMeta } from "../src/partner/skins.ts";

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function main(): Promise<void> {
  const db = openEventStore({ dbPath: DEFAULT_EVENT_STORE_DB });
  ensurePartnerRegistrySchema(db);

  const snap = loadRegistrySnapshot(db);
  const accounts = listActiveBettingAccounts(db);
  const capacity = computeProviderCapacity(accounts);
  const env = checkPartnersEnvPresence(accounts);
  const domain = buildOpsStatusReport();
  const ledgerFreshness = listLedgerFreshness(db);
  const riskThreshold = parseRiskThreshold(
    argValue("risk-threshold") ?? process.env.PARTNER_FINANCE_RISK_THRESHOLD,
    "warn",
  );
  const risk = evaluateRiskHealth(db, accounts, {
    oddsStaleMs: Number(argValue("odds-stale-ms") ?? "") || undefined,
  });
  const riskOk = riskOkUnderThreshold(risk, riskThreshold);

  const tomlPath =
    argValue("toml") ??
    ((await Bun.file("config/partners.toml").exists())
      ? "config/partners.toml"
      : (await Bun.file("config/partners.example.toml").exists())
        ? "config/partners.example.toml"
        : null);

  let tomlDrift: ReturnType<typeof diffPartnersTomlVsDb> | null = null;
  let tomlError: string | null = null;
  if (tomlPath) {
    try {
      const loaded = await loadPartnersTomlFile(tomlPath);
      tomlDrift = diffPartnersTomlVsDb(loaded.doc, db);
    } catch (e) {
      tomlError = e instanceof Error ? e.message : String(e);
    }
  }

  const partnerCodes = new Set<string>();
  for (const a of accounts) {
    const meta = parseOutMeta(a.metaJson);
    if (typeof meta.partnerCode === "string" && meta.partnerCode) {
      partnerCodes.add(meta.partnerCode.toUpperCase());
    }
  }

  const health = {
    ok:
      env.ok &&
      riskOk &&
      !tomlError &&
      (tomlDrift == null ||
        (tomlDrift.added === 0 && tomlDrift.changed === 0)),
    generatedAt: new Date().toISOString(),
    registry: {
      partners: snap.partners.length,
      outs: snap.accounts.length,
      activeOuts: accounts.length,
    },
    capacity: capacity.map((c) => ({
      provider: c.provider,
      totalMaxStake: c.totalMaxStake,
      outCount: c.accountCount,
      skinPairCount: c.skinPairCount,
    })),
    env: {
      ok: env.ok,
      missingCount: env.missingCount,
      outs: env.outs.map((o) => ({
        outId: o.outId,
        envPrefix: o.envPrefix,
        missing: o.missing,
        present: o.present,
      })),
    },
    toml: tomlPath
      ? {
          path: tomlPath,
          error: tomlError,
          drift: tomlDrift
            ? {
                added: tomlDrift.added,
                changed: tomlDrift.changed,
                removed: tomlDrift.removed,
                // removed = DB-only orphans (seed will not delete)
              }
            : null,
        }
      : null,
    domain: {
      built: domain.totals.built,
      partial: domain.totals.partial,
      planned: domain.totals.planned,
    },
    visuals: [...partnerCodes].sort().map((code) => {
      const v = getPartnerVisual(code);
      return { code, hex: v.hex, hue: v.hue };
    }),
    ledger: ledgerFreshness.map((f) => ({
      outId: f.outId,
      lastDeskSnapshotAt: f.lastDeskSnapshotAt
        ? new Date(f.lastDeskSnapshotAt).toISOString()
        : null,
      lastTicketAt: f.lastTicketAt
        ? new Date(f.lastTicketAt).toISOString()
        : null,
      lastOddsBookAt: f.lastOddsBookAt
        ? new Date(f.lastOddsBookAt).toISOString()
        : null,
      deskSnapshotsToday: f.deskSnapshotsToday,
      ticketsToday: f.ticketsToday,
      oddsLinesToday: f.oddsLinesToday,
    })),
    risk: {
      ok: riskOk,
      threshold: riskThreshold,
      errorCount: risk.errorCount,
      warnCount: risk.warnCount,
      infoCount: risk.infoCount,
      findings: risk.findings,
      outs: risk.outs,
      /** partner:health --json style snapshot for alert payloads / debugging */
      snapshot: toRiskHealthJsonSnapshot(risk, riskThreshold),
    },
  };

  if (hasFlag("json")) {
    console.log(JSON.stringify(health, null, 2));
  } else {
    const mark = health.ok ? "ok" : "DEGRADED";
    console.log(`partner health: ${mark}`);
    console.log(
      `  registry: partners=${health.registry.partners} outs=${health.registry.outs} active=${health.registry.activeOuts}`,
    );
    for (const c of health.capacity) {
      console.log(
        `  capacity ${c.provider}: $${c.totalMaxStake}  outs=${c.outCount} skins=${c.skinPairCount}`,
      );
    }
    console.error(formatEnvPresenceText(env));
    if (tomlPath && tomlDrift) {
      console.error(`toml drift (${tomlPath}):`);
      console.error(formatPartnersDiffText(tomlDrift));
    }
    if (tomlError) {
      console.error(`toml error: ${tomlError}`);
    }
    console.log(
      `  domain maturity: built=${domain.totals.built} partial=${domain.totals.partial} planned=${domain.totals.planned}`,
    );
    for (const v of health.visuals) {
      const vis = getPartnerVisual(v.code);
      console.log(
        `  ${vis.ansi}${v.code}${vis.ansiReset}  ${v.hex}`,
      );
    }
    if (ledgerFreshness.length) {
      console.log("  ledger freshness:");
      for (const f of ledgerFreshness) {
        const desk = f.lastDeskSnapshotAt
          ? new Date(f.lastDeskSnapshotAt).toISOString()
          : "never";
        const odds = f.lastOddsBookAt
          ? new Date(f.lastOddsBookAt).toISOString()
          : "never";
        console.log(
          `    ${f.outId}  desk=${desk}  odds=${odds} linesToday=${f.oddsLinesToday} ticketsToday=${f.ticketsToday}`,
        );
      }
    } else {
      console.log(
        "  ledger: empty (run partner:finance-cron / partner:ws-ingest)",
      );
    }
    console.error(formatRiskHealthText(risk));
    console.error(`  risk threshold for alerts: ${riskThreshold}`);
    console.log(
      "  · workflow: TOML → seed → finance-cron → ws-ingest → partner:health",
    );
  }

  if (hasFlag("strict-env") && !env.ok) {
    process.exitCode = 2;
  } else if (hasFlag("strict-risk") && !riskOk) {
    process.exitCode = 2;
  } else if (!health.ok && hasFlag("strict")) {
    process.exitCode = 2;
  }
}

await main();
