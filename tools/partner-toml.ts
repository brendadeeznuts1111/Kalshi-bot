#!/usr/bin/env bun
/**
 * Partner registry TOML (Bun.TOML.parse / stringify).
 *
 *   bun run partner:toml -- --path=config/partners.example.toml
 *   bun run partner:toml -- --validate
 *   bun run partner:toml -- --diff
 *   bun run partner:toml -- --dry-run
 *   bun run partner:toml -- --check-env
 *   bun run partner:toml -- --seed
 *   bun run partner:toml -- --seed --strict-env
 *   bun run partner:toml -- --export --out=config/partners.export.toml
 *
 * @see https://bun.com/docs/runtime/toml
 */
// @see https://bun.com/docs/runtime/toml
// @see https://bun.com/docs/runtime/sqlite
import { openEventStore } from "../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../src/institutions/event-store/paths.ts";
import { listActiveBettingAccounts } from "../src/partner/registry.ts";
import {
  DEFAULT_PARTNERS_TOML,
  EXAMPLE_PARTNERS_TOML,
  buildPartnersTomlFromRows,
  checkPartnersEnvPresence,
  diffPartnersTomlVsDb,
  formatEnvPresenceText,
  formatPartnerAssetIssues,
  formatPartnersDiffText,
  loadPartnersTomlFile,
  seedRegistryFromPartnersToml,
  stringifyPartnersToml,
  validatePartnerAssetPrefixes,
  visualsAppendixForCodes,
} from "../src/partner/toml-config.ts";
import { getPartnerVisual } from "../src/partner/visuals.ts";

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function resolvePath(): Promise<string> {
  const p = argValue("path");
  if (p) return p;
  if (await Bun.file(DEFAULT_PARTNERS_TOML).exists()) return DEFAULT_PARTNERS_TOML;
  return EXAMPLE_PARTNERS_TOML;
}

async function main(): Promise<void> {
  if (hasFlag("export")) {
    const db = openEventStore({ dbPath: DEFAULT_EVENT_STORE_DB });
    const accounts = listActiveBettingAccounts(db);
    const partners = db
      .query(
        `SELECT id, name, active, profit_split AS profitSplit, commission_rate AS commissionRate, notes
         FROM partners`,
      )
      .all() as Array<{
      id: string;
      name: string;
      active: number;
      profitSplit: number | null;
      commissionRate: number | null;
      notes: string | null;
    }>;
    const doc = buildPartnersTomlFromRows(
      partners.map((p) => ({
        id: p.id,
        name: p.name,
        active: Boolean(p.active),
        profitSplit: p.profitSplit,
        commissionRate: p.commissionRate,
        notes: p.notes,
      })),
      accounts,
    );
    const text = stringifyPartnersToml(doc);
    const out = argValue("out") ?? "config/partners.export.toml";
    await Bun.write(out, text);
    console.error(
      `exported ${doc.partners?.length ?? 0} partners, ${doc.outs?.length ?? 0} outs → ${out}`,
    );
    if (hasFlag("json")) console.log(JSON.stringify(doc, null, 2));
    else console.log(text);
    return;
  }

  const path = await resolvePath();
  const dryRun = hasFlag("dry-run");
  const wantDiff = hasFlag("diff") || dryRun || hasFlag("seed");
  const wantEnv =
    hasFlag("check-env") || dryRun || hasFlag("validate") || hasFlag("seed");
  const wantAssets =
    hasFlag("check-assets") || dryRun || hasFlag("validate") || hasFlag("seed");
  const strictEnv = hasFlag("strict-env");
  const strictAssets = hasFlag("strict-assets") || hasFlag("validate");
  const wantSeed = hasFlag("seed") && !dryRun;

  try {
    const loaded = await loadPartnersTomlFile(path);
    const codes = (loaded.doc.partners ?? [])
      .map((p) => String(p.code ?? "").toUpperCase())
      .filter(Boolean);

    if (wantAssets) {
      const assetIssues = validatePartnerAssetPrefixes(loaded.doc);
      console.error(formatPartnerAssetIssues(assetIssues));
      if (strictAssets && assetIssues.length > 0) {
        console.error("assets: --strict-assets/validate → failing");
        process.exitCode = 1;
        if (wantSeed) return;
      }
    }

    if (wantEnv) {
      const envReport = checkPartnersEnvPresence(loaded.accounts);
      console.error(formatEnvPresenceText(envReport));
      if (strictEnv && !envReport.ok) {
        console.error("env: --strict-env → failing on missing required keys");
        process.exitCode = 1;
        if (wantSeed) return;
      }
    }

    if (wantDiff) {
      const db = openEventStore({ dbPath: DEFAULT_EVENT_STORE_DB });
      const diff = diffPartnersTomlVsDb(loaded.doc, db);
      console.error(formatPartnersDiffText(diff));
    }

    if (wantSeed) {
      const db = openEventStore({ dbPath: DEFAULT_EVENT_STORE_DB });
      const n = seedRegistryFromPartnersToml(db, loaded.doc);
      console.error(
        `seeded from ${path}: partners=${n.partners} outs=${n.accounts}`,
      );
    } else if (dryRun && hasFlag("seed")) {
      console.error("dry-run: skipped seed (no DB writes)");
    }

    if (hasFlag("json")) {
      console.log(
        JSON.stringify(
          {
            path: loaded.path,
            version: loaded.doc.version ?? null,
            title: loaded.doc.title ?? null,
            partners: loaded.partners,
            accounts: loaded.accounts.map((a) => ({
              id: a.id,
              partnerId: a.partnerId,
              provider: a.provider,
              maxStake: a.maxStake,
              maxWin: a.maxWin,
              metaJson: a.metaJson,
            })),
            visuals: codes.map((c) => {
              const v = getPartnerVisual(c);
              return { code: c, hex: v.hex, hue: v.hue, hsl: v.hsl };
            }),
          },
          null,
          2,
        ),
      );
    } else {
      console.log(`partners TOML: ${path}`);
      console.log(
        `  version=${loaded.doc.version ?? "?"} title=${loaded.doc.title ?? "—"}`,
      );
      console.log(
        `  partners=${loaded.partners.length} outs=${loaded.accounts.length}`,
      );
      for (const p of loaded.partners) {
        const code =
          (loaded.doc.partners ?? []).find(
            (x) =>
              x.id === p.id ||
              `partner-${String(x.code).toLowerCase()}` === p.id,
          )?.code ?? p.id;
        const v = getPartnerVisual(String(code));
        console.log(
          `  ${v.ansi}${String(code).toUpperCase()}${v.ansiReset}  ${p.name}  ${v.hex}  active=${p.active}`,
        );
      }
      for (const a of loaded.accounts) {
        let vault = "—";
        try {
          const meta = JSON.parse(a.metaJson || "{}") as { vaultId?: string };
          if (meta.vaultId) vault = meta.vaultId;
        } catch {
          /* ignore */
        }
        console.log(
          `    └── ${a.id}  ${a.provider}  capacity=$${a.maxStake}  env=${a.envPrefix ?? "—"}  vault=${vault}`,
        );
      }
      if (hasFlag("visuals") && codes.length) {
        console.log("\n# derived visuals (not secrets)\n");
        console.log(visualsAppendixForCodes(codes));
      }
    }

    if (hasFlag("validate")) {
      console.error("validate: ok");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`TOML error: ${msg}`);
    process.exitCode = 1;
  }
}

await main();
