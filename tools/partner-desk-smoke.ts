#!/usr/bin/env bun
/**
 * Signed-desk readiness for Fantasy402 outs (no secret echo).
 *
 * Walks the registry, resolves per-out env via resolvePartnerEnv fallback chain,
 * and optionally probes login() when secrets are present.
 *
 *   bun run partner:desk-smoke
 *   bun run partner:desk-smoke -- --json
 *   bun run partner:desk-smoke -- --seed                 # align DB from partners.toml
 *   bun run partner:desk-smoke -- --out=out-SPEN-1
 *   bun run partner:desk-smoke -- --login                # probe login when secrets present
 *   bun run partner:desk-smoke -- --login --strict       # exit 1 if any out not ready
 *
 * After vault inject:
 *   bun run protonpass:run -- bun run partner:desk-smoke -- --login
 *
 * @see docs/PARTNER-DOMAIN.md
 */
// @see https://bun.com/docs/runtime/sqlite
// @see https://bun.com/docs/api/file-io
import { openEventStore } from "../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../src/institutions/event-store/paths.ts";
import {
  fantasyDeskEnvPresence,
  fantasyVaultItemTitle,
  loadFantasy402ProfileFromPrefix,
} from "../src/partner/account-profile.ts";
import { FantasyUltraAdapter } from "../src/partner/fantasy-ultra/adapter.ts";
import { credentialsFromFantasyProfile } from "../src/partner/account-profile.ts";
import {
  ensurePartnerRegistrySchema,
  listActiveBettingAccounts,
} from "../src/partner/registry.ts";
import {
  loadPartnersTomlFile,
  seedRegistryFromPartnersToml,
} from "../src/partner/toml-config.ts";

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function redactUrl(u: string): string {
  try {
    const url = new URL(u);
    const keys = [...url.searchParams.keys()];
    return `${url.origin}${url.pathname}?${keys.map((k) => `${k}=…`).join("&")}`;
  } catch {
    return "(invalid url)";
  }
}

async function resolveTomlPath(): Promise<string | null> {
  for (const p of ["config/partners.toml", "config/partners.example.toml"]) {
    if (await Bun.file(p).exists()) return p;
  }
  return null;
}

async function main(): Promise<void> {
  const asJson = hasFlag("json");
  const doSeed = hasFlag("seed");
  const doLogin = hasFlag("login");
  const strict = hasFlag("strict");
  const outFilter = argValue("out")?.trim();

  const db = openEventStore({ dbPath: DEFAULT_EVENT_STORE_DB });
  ensurePartnerRegistrySchema(db);

  let seededFrom: string | null = null;
  if (doSeed) {
    const path = await resolveTomlPath();
    if (!path) {
      console.error("No config/partners.toml or partners.example.toml to seed");
      process.exit(1);
    }
    const loaded = await loadPartnersTomlFile(path);
    seedRegistryFromPartnersToml(db, loaded.doc);
    seededFrom = path;
  }

  let accounts = listActiveBettingAccounts(db).filter(
    (a) => a.provider === "fantasy402" || a.provider.startsWith("fantasy"),
  );
  if (outFilter) {
    accounts = accounts.filter((a) => a.id === outFilter);
    if (accounts.length === 0) {
      console.error(
        `No active fantasy out matching ${outFilter}. Try --seed or partner:toml -- --seed`,
      );
      process.exit(1);
    }
  }

  type Row = {
    outId: string;
    envPrefix: string;
    vaultItemTitle: string;
    secretsOk: boolean;
    missing: string[];
    present: string[];
    sources: Record<string, string | undefined>;
    login?: { ok: boolean; desktop?: string; error?: string };
  };

  const rows: Row[] = [];

  for (const a of accounts) {
    const prefix = a.envPrefix || "FANTASY402_";
    const presence = fantasyDeskEnvPresence(prefix);
    const row: Row = {
      outId: a.id,
      envPrefix: presence.envPrefix,
      vaultItemTitle: fantasyVaultItemTitle(a.id),
      secretsOk: presence.ok,
      missing: presence.missing,
      present: presence.present,
      sources: presence.sources as Record<string, string | undefined>,
    };

    if (doLogin && presence.ok) {
      const profile = loadFantasy402ProfileFromPrefix(prefix, {
        accountId: a.id,
      });
      if (!profile) {
        row.login = { ok: false, error: "profile null after presence ok" };
      } else {
        try {
          const adapter = new FantasyUltraAdapter({
            credentials: credentialsFromFantasyProfile(profile),
            warmSession: false,
          });
          const urls = await adapter.login();
          const desktop =
            urls && typeof urls === "object" && "desktop" in urls
              ? redactUrl(String((urls as { desktop: string }).desktop))
              : undefined;
          row.login = { ok: true, desktop };
        } catch (e) {
          row.login = {
            ok: false,
            error:
              e instanceof Error
                ? e.message.slice(0, 160)
                : String(e).slice(0, 160),
          };
        }
      }
    } else if (doLogin && !presence.ok) {
      row.login = {
        ok: false,
        error: `skipped — missing ${presence.missing.join(",")}`,
      };
    }

    rows.push(row);
  }

  const ready = rows.filter((r) => r.secretsOk).length;
  const loginOk = rows.filter((r) => r.login?.ok).length;
  const report = {
    ok: rows.length > 0 && rows.every((r) => r.secretsOk),
    generatedAt: new Date().toISOString(),
    seededFrom,
    outs: rows.length,
    secretsReady: ready,
    loginProbed: doLogin,
    loginOk: doLogin ? loginOk : undefined,
    rows,
    next: [
      ready < rows.length
        ? "Export JWT+creds or: bun run partner:vault:provision -- --out=<id> --print-uris"
        : "bun run partner:desk-smoke -- --login",
      "bun run protonpass:run -- bun run partner:test-fantasy -- --out=<id>",
      "bun run partner:ws-ingest -- --capture --out-id=<id>",
      "bun run partner:finance-cron -- --probe-login",
    ],
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `partner desk-smoke: ${report.ok ? "READY" : "BLOCKED"}  outs=${rows.length} secretsReady=${ready}` +
        (doLogin ? ` loginOk=${loginOk}` : "") +
        (seededFrom ? ` seeded=${seededFrom}` : ""),
    );
    for (const r of rows) {
      const mark = r.secretsOk ? "✓" : "✗";
      console.log(
        `  ${mark} ${r.outId}  prefix=${r.envPrefix}  vaultItem="${r.vaultItemTitle}"`,
      );
      if (!r.secretsOk) {
        console.log(`      missing: ${r.missing.join(", ") || "(none)"}`);
      } else {
        const src = r.present
          .map((k) => `${k}@${r.sources[k] ?? "?"}`)
          .join(" ");
        console.log(`      present: ${src}`);
      }
      if (r.login) {
        if (r.login.ok) {
          console.log(`      login: ok  desktop=${r.login.desktop ?? "—"}`);
        } else {
          console.log(`      login: FAIL  ${r.login.error ?? ""}`);
        }
      }
    }
    console.log("  next:");
    for (const n of report.next) console.log(`    · ${n}`);
  }

  if (strict && !report.ok) process.exit(1);
  if (strict && doLogin && rows.some((r) => r.login && !r.login.ok)) {
    process.exit(1);
  }
}

await main();
