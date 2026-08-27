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
 *   bun run domain:sports -- --feed     # Pandora feedSportId catalog (85)
 *   bun run domain:sports -- --periods  # baked live.sportPeriod labels
 *   bun run domain:sports -- --countries
 *   bun run domain:sports -- --snapshot-leagues  # from widget-domain-snapshot.json
 */
// @see https://bun.com/docs/runtime/networking/fetch
import { hasFlag, argValue } from "../src/cli/argv.ts";
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

async function main(): Promise<void> {
  if (hasFlag("seed")) {
    const db = openEventStore({ dbPath: DEFAULT_EVENT_STORE_DB });
    ensurePartnerRegistrySchema(db);
    const n = seedFantasySportMappings(db);
    console.error(`seeded ${n} fantasy402 sport mappings → provider_sport_mappings`);
  }

  if (hasFlag("periods")) {
    const {
      PANDORA_SPORT_PERIODS,
      listBakedPeriodFeedSportIds,
      periodUnitForFeedSport,
      bakedPeriodLabel,
    } = await import("../src/domain/pandora-sport-periods.ts");
    const { feedSportName } = await import("../src/domain/pandora-feed-sports.ts");
    const ids = listBakedPeriodFeedSportIds();
    if (hasFlag("json")) {
      console.log(
        JSON.stringify(
          {
            capturedAt: PANDORA_SPORT_PERIODS.capturedAt,
            language: PANDORA_SPORT_PERIODS.language,
            feedSportCount: ids.length,
            periodUnit: PANDORA_SPORT_PERIODS.periodUnit,
            periods: PANDORA_SPORT_PERIODS.periods,
          },
          null,
          2,
        ),
      );
      return;
    }
    console.log(
      `baked sportPeriod: ${ids.length} feed sports · lang=${PANDORA_SPORT_PERIODS.language} · @ ${PANDORA_SPORT_PERIODS.capturedAt}`,
    );
    for (const id of ids) {
      const unit = periodUnitForFeedSport(id) ?? "—";
      const name = feedSportName(id) ?? "?";
      const codes = Object.keys(PANDORA_SPORT_PERIODS.periods[String(id)] ?? {});
      const s1 = bakedPeriodLabel(id, "s1") ?? "—";
      console.log(
        `  ${String(id).padStart(3)}  ${name.padEnd(28)} unit=${unit.padEnd(8)} s1=${s1.padEnd(14)} codes=${codes.join(",")}`,
      );
    }
    return;
  }

  if (hasFlag("countries")) {
    const { listPandoraCountries } = await import(
      "../src/domain/pandora-countries.ts"
    );
    const rows = listPandoraCountries();
    if (hasFlag("json")) {
      console.log(JSON.stringify({ count: rows.length, countries: rows }, null, 2));
      return;
    }
    console.log(`baked countries: ${rows.length}`);
    for (const c of rows.slice(0, hasFlag("all") ? rows.length : 40)) {
      console.log(`  ${c.id.padStart(4)}  ${c.name}`);
    }
    if (!hasFlag("all") && rows.length > 40) {
      console.log(`  … +${rows.length - 40} more (pass --all)`);
    }
    return;
  }

  if (hasFlag("snapshot-leagues")) {
    const { defaultWidgetDomainCachePath, summarizeLeaguesByFeedSport } =
      await import("../src/domain/widget-domain-extract.ts");
    const { feedSportName } = await import("../src/domain/pandora-feed-sports.ts");
    const path = argValue("from") ?? defaultWidgetDomainCachePath();
    const file = Bun.file(path);
    if (!(await file.exists())) {
      console.error(`no snapshot at ${path} — run: bun run domain:widget-extract -- --write`);
      process.exit(1);
    }
    const snap = (await file.json()) as {
      liveLeagues?: Array<{
        id: string;
        name: string;
        sportId?: string | null;
        platformSport?: string | null;
        sportIdCanonical?: string | null;
      }>;
    };
    const leagues = snap.liveLeagues ?? [];
    const summary = summarizeLeaguesByFeedSport(
      leagues as import("../src/domain/widget-domain-extract.ts").WidgetLiveLeague[],
    );
    if (hasFlag("json")) {
      console.log(
        JSON.stringify({ path, leagueCount: leagues.length, byFeed: summary }, null, 2),
      );
      return;
    }
    console.log(`snapshot leagues: ${leagues.length} @ ${path}`);
    for (const row of summary.slice(0, hasFlag("all") ? summary.length : 30)) {
      const fname = feedSportName(row.feedSportId) ?? "—";
      console.log(
        `  feed=${row.feedSportId.padEnd(4)} ${fname.padEnd(22)} n=${String(row.count).padStart(4)} domain=${row.sportIdCanonical ?? "—"}  e.g. ${row.sample.slice(0, 3).join("; ")}`,
      );
    }
    if (!hasFlag("all") && summary.length > 30) {
      console.log(`  … +${summary.length - 30} feed sports (pass --all)`);
    }
    return;
  }

  if (hasFlag("feed") || hasFlag("map")) {
    if (hasFlag("feed") && !hasFlag("map")) {
      const { listPandoraFeedSports } = await import(
        "../src/domain/pandora-feed-sports.ts"
      );
      const rows = listPandoraFeedSports();
      if (hasFlag("json")) {
        console.log(JSON.stringify({ count: rows.length, sports: rows }, null, 2));
        return;
      }
      console.log(
        `pandora feed sports: ${rows.length} · core=${rows.filter((r) => r.kind === "core").length} · mapped=${rows.filter((r) => r.sportId).length}`,
      );
      for (const r of rows) {
        console.log(
          `  ${String(r.feedSportId).padStart(3)}  ${(r.name).padEnd(28)} ${(r.sportId ?? "—").padEnd(18)} ${r.kind}`,
        );
      }
      return;
    }
    const summary = staticSportMapSummary();
    const payload = {
      summary,
      primary: primaryFantasySports().map((m) => ({
        canonical: m.canonical,
        streamBucket: m.streamBucket,
        feedSportId: m.feedSportId,
        apiSportId: m.apiSportId,
        widgetSportId: m.widgetSportId,
        label: m.label,
      })),
      all: FANTASY_SPORT_MAPPINGS.map((m) => ({
        canonical: m.canonical,
        streamBucket: m.streamBucket,
        feedSportId: m.feedSportId,
        apiSportId: m.apiSportId,
        widgetSportId: m.widgetSportId,
        label: m.label,
        primary: m.primary,
      })),
    };
    if (hasFlag("json")) console.log(JSON.stringify(payload, null, 2));
    else {
      console.log(
        `static map: ${summary.total} buckets · ${summary.primary} primary · feed=${summary.withFeedId} · api=${summary.withApiId}`,
      );
      console.log(
        "  planes: feed=Pandora eventData · widget=shell sportOrder · api=ticket (when set)",
      );
      for (const m of FANTASY_SPORT_MAPPINGS) {
        const ids = [
          m.feedSportId != null ? `feed=${m.feedSportId}` : "feed=?",
          m.widgetSportId != null ? `widget=${m.widgetSportId}` : "widget=?",
          m.apiSportId != null ? `api=${m.apiSportId}` : "api=?",
        ].join(" ");
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
