#!/usr/bin/env bun
/**
 * Domain live-product sports + stream-list coverage inventory (plive/ezlive shell).
 * Not seat-partner — sport tiers live in src/domain/.
 *
 *   bun run domain:sports
 *   bun run domain:sports -- --json
 *   bun run domain:sports -- --leagues=table_tennis
 *   bun run domain:sports -- --leagues=all --json
 *   bun run domain:sports -- --seed     # refresh provider_sport_mappings in event-store
 *   bun run domain:sports -- --map      # static map only (offline)
 */
// @see https://bun.com/docs/api/fetch
import { openEventStore } from "../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../src/institutions/event-store/paths.ts";
import {
  ensurePartnerRegistrySchema,
  seedFantasySportMappings,
} from "../src/partner/registry.ts";
import {
  fetchStreamSportsInventory,
  staticSportMapSummary,
} from "../src/inventory/sports-inventory.ts";
import {
  FANTASY_SPORT_MAPPINGS,
  primaryFantasySports,
} from "../src/partner/fantasy-ultra/widget-config.ts";

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function main(): Promise<void> {
  if (hasFlag("seed")) {
    const db = openEventStore({ dbPath: DEFAULT_EVENT_STORE_DB });
    ensurePartnerRegistrySchema(db);
    const n = seedFantasySportMappings(db);
    console.error(`seeded ${n} fantasy402 sport mappings → provider_sport_mappings`);
  }

  if (hasFlag("map")) {
    const summary = staticSportMapSummary();
    const payload = {
      summary,
      primary: primaryFantasySports().map((m) => ({
        canonical: m.canonical,
        streamBucket: m.streamBucket,
        apiSportId: m.apiSportId,
        widgetSportId: m.widgetSportId,
        label: m.label,
      })),
      all: FANTASY_SPORT_MAPPINGS.map((m) => ({
        canonical: m.canonical,
        streamBucket: m.streamBucket,
        apiSportId: m.apiSportId,
        widgetSportId: m.widgetSportId,
        label: m.label,
        primary: m.primary,
      })),
    };
    if (hasFlag("json")) console.log(JSON.stringify(payload, null, 2));
    else {
      console.log(
        `static map: ${summary.total} buckets · ${summary.primary} primary · ${summary.withApiId} with API id`,
      );
      for (const m of FANTASY_SPORT_MAPPINGS) {
        const ids =
          m.apiSportId != null
            ? `api=${m.apiSportId} widget=${m.widgetSportId ?? "—"}`
            : "api=? widget=?";
        console.log(
          `  ${m.primary ? "★" : "·"} ${m.streamBucket.padEnd(20)} ${m.label.padEnd(22)} ${ids}`,
        );
      }
    }
    return;
  }

  const inv = await fetchStreamSportsInventory();
  const leaguesFilter = argValue("leagues");

  const payload = {
    fetchedAt: new Date(inv.fetchedAt).toISOString(),
    url: inv.url,
    sportBuckets: inv.sportBuckets,
    totalEvents: inv.totalEvents,
    mappedBuckets: inv.mappedBuckets,
    unmappedBuckets: inv.unmappedBuckets,
    mapOnlyBuckets: inv.mapOnlyBuckets,
    primaryLive: inv.primaryLive,
    staticMap: staticSportMapSummary(),
    sports: inv.rows.map((r) => ({
      streamBucket: r.streamBucket,
      label: r.label,
      eventCount: r.eventCount,
      leagueCount: r.leagueCount,
      mapped: r.mapped,
      primary: r.primary,
      canonical: r.mapping?.canonical ?? null,
      apiSportId: r.mapping?.apiSportId ?? null,
      widgetSportId: r.mapping?.widgetSportId ?? null,
    })),
    ...(leaguesFilter
      ? {
          leagues: inv.rows
            .filter(
              (r) =>
                leaguesFilter === "all" ||
                r.streamBucket === leaguesFilter ||
                r.mapping?.canonical === leaguesFilter,
            )
            .flatMap((r) =>
              r.leagues.map((l) => ({
                streamBucket: r.streamBucket,
                league: l.league,
                eventCount: l.eventCount,
              })),
            ),
        }
      : {}),
    notes: [
      "Coverage inventory only — not a priced book",
      "primary sports have confirmed API/widget ids; others mapped by stream bucket only",
      "Get_SportsLeagues (auth) still needed for full book league catalog + API sport ids",
      "Sync: bun run inventory:sync -- --sport=all  (or table_tennis / tennis / …)",
    ],
  };

  if (hasFlag("json")) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(
    `stream-list: ${inv.sportBuckets} sports · ${inv.totalEvents} events · map ${inv.mappedBuckets}/${inv.sportBuckets} · primary live ${inv.primaryLive}`,
  );
  if (inv.unmappedBuckets.length) {
    console.log(`  unmapped live: ${inv.unmappedBuckets.join(", ")}`);
  }
  for (const r of inv.rows) {
    if (r.eventCount === 0 && !hasFlag("all")) continue;
    const mark = r.primary ? "★" : r.mapped ? "·" : "?";
    const api =
      r.mapping?.apiSportId != null ? `api=${r.mapping.apiSportId}` : "api=?";
    console.log(
      `  ${mark} ${r.streamBucket.padEnd(20)} events=${String(r.eventCount).padStart(3)} leagues=${String(r.leagueCount).padStart(3)}  ${r.label}  ${api}`,
    );
  }

  if (leaguesFilter) {
    const want =
      leaguesFilter === "all"
        ? inv.rows.filter((r) => r.eventCount > 0)
        : inv.rows.filter(
            (r) =>
              r.streamBucket === leaguesFilter ||
              r.mapping?.canonical === leaguesFilter,
          );
    console.log(`\nleagues (${leaguesFilter}):`);
    for (const r of want) {
      console.log(`  [${r.streamBucket}]`);
      for (const l of r.leagues.slice(0, leaguesFilter === "all" ? 8 : 50)) {
        console.log(`    ${String(l.eventCount).padStart(3)}  ${l.league}`);
      }
      if (leaguesFilter === "all" && r.leagues.length > 8) {
        console.log(`    … +${r.leagues.length - 8} more`);
      }
    }
  }

  for (const n of payload.notes) console.log(`  · ${n}`);
}

await main();
