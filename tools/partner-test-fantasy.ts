#!/usr/bin/env bun
/**
 * Live smoke for Fantasy402 Ultra adapter (signed desk).
 *
 * Secrets via env / Proton Pass only (never commit):
 *   Prefer per-out: FANTASY402_SPEN_1_BEARER_TOKEN · CUSTOMER_ID · AGENT_ID · PASSWORD
 *   Fallback: partner (FANTASY402_SPEN_*) → book (FANTASY402_*)
 *
 * Usage:
 *   bun run partner:test-fantasy
 *   bun run partner:test-fantasy -- --out=out-SPEN-1
 *   bun run partner:test-fantasy -- --prefix=FANTASY402_SPEN_1_ --renew
 *   bun run partner:test-fantasy -- --sport=tennis --limit=8
 *   bun run protonpass:run -- bun run partner:test-fantasy -- --out=out-SPEN-1
 */
// @see https://bun.com/docs/runtime/utils#bun-env
import {
  getFantasySessionAdapter,
  loadFantasy402ProfileFromEnv,
  requireFantasy402ProfileFromPrefix,
} from "../src/partner/index.ts";
import { openEventStore } from "../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../src/institutions/event-store/paths.ts";
import {
  ensurePartnerRegistrySchema,
  getBettingAccountById,
} from "../src/partner/registry.ts";
import type { PartnerAccountProfile } from "../src/partner/account-profile.ts";

function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
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

function redactJwt(t: string): string {
  if (t.length < 20) return "(short)";
  return `${t.slice(0, 12)}…(len=${t.length})`;
}

function resolveProfile(): PartnerAccountProfile {
  const outId = argValue("out")?.trim();
  const prefixArg = argValue("prefix")?.trim();

  if (outId || prefixArg) {
    let envPrefix = prefixArg;
    let accountId = outId ?? "fantasy402-out";
    if (outId && !envPrefix) {
      const db = openEventStore({ dbPath: DEFAULT_EVENT_STORE_DB });
      ensurePartnerRegistrySchema(db);
      const row = getBettingAccountById(db, outId);
      if (!row) {
        throw new Error(
          `Unknown out ${outId} in registry — run: bun run partner:toml -- --seed`,
        );
      }
      envPrefix = row.envPrefix || "FANTASY402_";
      accountId = row.id;
    }
    if (!envPrefix) {
      throw new Error("Need --prefix= when --out cannot resolve registry row");
    }
    return requireFantasy402ProfileFromPrefix(envPrefix, {
      accountId,
    });
  }

  const book = loadFantasy402ProfileFromEnv();
  if (!book) {
    throw new Error(
      "Missing Fantasy402 secrets. Use --out=out-SPEN-1 (registry prefix) " +
        "or export FANTASY402_* / FANTASY402_SPEN_1_* keys. " +
        "See: bun run partner:desk-smoke",
    );
  }
  return book;
}

async function main(): Promise<void> {
  const sport = argValue("sport") ?? "tennis";
  const limit = Math.min(
    Math.max(Number(argValue("limit") ?? "10") || 10, 1),
    50,
  );
  const doRenew = hasFlag("renew");

  const profile = resolveProfile();
  console.log(
    JSON.stringify(
      {
        accountId: profile.id,
        partner: profile.partner,
        domain: profile.url,
        customerID: profile.meta.customerID,
        agentID: profile.meta.agentID,
        skin: profile.meta.skin,
        currency: profile.meta.currency,
        tokenPresent: profile.meta.token.length > 0,
        tokenLen: profile.meta.token.length,
      },
      null,
      2,
    ),
  );

  const adapter = getFantasySessionAdapter(profile);

  if (doRenew) {
    const next = await adapter.renewToken();
    console.log(
      JSON.stringify({ renewed: true, bearer: redactJwt(next) }, null, 2),
    );
  }

  const urls = await adapter.login();
  if (urls && typeof urls === "object" && "desktop" in urls) {
    console.log(
      JSON.stringify(
        {
          live: {
            desktop: redactUrl(urls.desktop),
            mobile: redactUrl(urls.mobile),
          },
          warmed:
            "isWarmed" in adapter
              ? (adapter as { isWarmed(): boolean }).isWarmed()
              : undefined,
          cookies:
            "cookieCount" in adapter
              ? (adapter as { cookieCount(): number }).cookieCount()
              : undefined,
          next: [
            "export LIVE_DESKTOP_URL='…'  # full desktop URL from login (not redacted here)",
            "bun run partner:ws-ingest -- --capture --seconds=25 --out-id=" +
              profile.id,
          ],
        },
        null,
        2,
      ),
    );
  } else {
    console.log(JSON.stringify({ live: urls }, null, 2));
  }

  if ("listSports" in adapter || "getBookedEvents" in adapter) {
    try {
      // Prefer stream inventory path when adapter exposes sports
      const anyAdapter = adapter as {
        listSports?: () => Promise<unknown>;
        getBookedEvents?: (sport: string) => Promise<unknown>;
      };
      if (typeof anyAdapter.getBookedEvents === "function") {
        const events = await anyAdapter.getBookedEvents(sport);
        const list = Array.isArray(events) ? events.slice(0, limit) : events;
        console.log(
          JSON.stringify(
            { sport, sample: list, note: "booked events (truncated)" },
            null,
            2,
          ),
        );
      }
    } catch (e) {
      console.error(
        JSON.stringify({
          bookedEventsError:
            e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
        }),
      );
    }
  }
}

await main();
