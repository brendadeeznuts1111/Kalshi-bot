#!/usr/bin/env bun
// @see https://bun.com/docs/guides/process/argv
/**
 * Primary-source ITF results collector (Stadion feed behind WTT Live).
 * Provenance on every row; corpus=trading. Polite: cache-first, pause between days.
 * After ingest, bridges Stadion ↔ Kalshi event_ids (surname+day+lane; hard-fail ambiguous).
 */
import { parseArgs } from "node:util";
import {
  collectItfStadionDay,
  collectItfStadionRange,
  recentUtcDays,
  repairStadionToursFromLevel,
} from "../../src/institutions/event-store/ingest-primary-results.ts";
import { bridgeStadionToKalshi } from "../../src/institutions/event-store/stadion-kalshi-bridge.ts";
import { ensureEventStoreDir, openEventStore } from "../../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../../src/institutions/event-store/paths.ts";

function parseFormat(raw: unknown): "singles" | "doubles" | "all" {
  if (raw === "doubles" || raw === "all" || raw === "singles") return raw;
  return "singles";
}

export async function runCollectResultsCli(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      day: { type: "string" },
      days: { type: "string" },
      format: { type: "string" },
      force: { type: "boolean", default: false },
      bridge: { type: "boolean", default: true },
      "bridge-only": { type: "boolean", default: false },
      "repair-tours": { type: "boolean", default: false },
      db: { type: "string" },
      json: { type: "boolean", default: false },
    },
    strict: false,
  });

  await ensureEventStoreDir();
  const dbPath = typeof values.db === "string" ? values.db : DEFAULT_EVENT_STORE_DB;
  const db = openEventStore({ dbPath });
  const doBridge = values.bridge !== false;

  if (values["repair-tours"] === true) {
    const repair = repairStadionToursFromLevel(db);
    const bridge = doBridge ? bridgeStadionToKalshi(db) : undefined;
    if (values.json) {
      console.log(JSON.stringify({ repair, bridge }, null, 2));
      return 0;
    }
    console.log("Repair Stadion tours from level (no refetch)\n");
    console.log(`scanned=${repair.scanned}  updated=${repair.updated}`);
    if (bridge) {
      console.log(
        `\nBridge: linked=${bridge.linked} ambiguous=${bridge.ambiguous} ` +
          `unmatched=${bridge.unmatched} resolutions+=${bridge.resolutionsPropagated}`,
      );
      for (const a of bridge.anomalies.slice(0, 20)) console.log(`  ! ${a}`);
    } else {
      console.log("\nBridge: skipped (--bridge=false)");
    }
    return 0;
  }

  if (values["bridge-only"] === true) {
    const bridge = bridgeStadionToKalshi(db);
    if (values.json) {
      console.log(JSON.stringify({ bridge }, null, 2));
      return 0;
    }
    console.log("Stadion ↔ Kalshi bridge (no collect)\n");
    console.log(
      `linked=${bridge.linked}  ambiguous=${bridge.ambiguous}  unmatched=${bridge.unmatched}  ` +
        `resolutions+=${bridge.resolutionsPropagated}  ` +
        `(stadion=${bridge.stadionCandidates} kalshi=${bridge.kalshiCandidates})`,
    );
    for (const a of bridge.anomalies.slice(0, 20)) console.log(`  ! ${a}`);
    return 0;
  }

  const format = parseFormat(values.format);
  const dayList: string[] = [];
  if (typeof values.day === "string") dayList.push(values.day);
  else if (values.days) dayList.push(...recentUtcDays(Number(values.days) || 3));
  else dayList.push(...recentUtcDays(2));

  const summaries =
    dayList.length === 1
      ? [
          await collectItfStadionDay(db, dayList[0]!, {
            format,
            force: values.force === true,
            bridge: doBridge,
          }),
        ]
      : await collectItfStadionRange(db, dayList, {
          format,
          force: values.force === true,
          bridge: doBridge,
        });

  if (values.json) {
    console.log(JSON.stringify({ summaries }, null, 2));
    return 0;
  }

  console.log("ITF primary results — Stadion / WTT Live (corpus=trading)\n");
  for (const s of summaries) {
    console.log(
      `${s.day}  +${s.eventsInserted} events (~${s.eventsUpdated} updated)  ` +
        `${s.singles} singles / ${s.doubles} doubles parsed  ` +
        `${s.cacheHit ? "cache" : "fetch"}  ${s.sourceUrl}`,
    );
  }
  const inserted = summaries.reduce((n, s) => n + s.eventsInserted, 0);
  const updated = summaries.reduce((n, s) => n + s.eventsUpdated, 0);
  console.log(`\nTotal inserted: ${inserted}  updated: ${updated}`);

  const bridge = summaries.map((s) => s.bridge).find(Boolean);
  if (bridge) {
    console.log(
      `\nBridge: linked=${bridge.linked} ambiguous=${bridge.ambiguous} ` +
        `unmatched=${bridge.unmatched} resolutions+=${bridge.resolutionsPropagated}`,
    );
    for (const a of bridge.anomalies.slice(0, 20)) console.log(`  ! ${a}`);
  } else if (!doBridge) {
    console.log("\nBridge: skipped (--bridge=false)");
  }

  console.log("Recorder: bun run tennis:record -- --loop --top=15");
  console.log("Re-bridge only: bun run tennis:collect -- --bridge-only");
  console.log("Repair poisoned tours: bun run tennis:collect -- --repair-tours");
  return 0;
}

if (import.meta.main) {
  process.exit(await runCollectResultsCli(process.argv.slice(2)));
}
