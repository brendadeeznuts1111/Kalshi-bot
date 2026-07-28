#!/usr/bin/env bun
/**
 * Outcome backfill utility — resolve shadow predictions from event-store outcomes.
 * Reads unresolved predictions in shadow-log, looks up event winners in DB,
 * appends outcome-resolution entries.
 *
 * Usage:
 *   bun tools/tennis/backfill-outcomes.ts --program=tennis-game-model
 *   bun tools/tennis/backfill-outcomes.ts --program=tennis-game-model --dry-run
 */
import { joinPath } from "../../src/research/paths.ts";
import { openEventStore } from "../../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../../src/institutions/event-store/paths.ts";
import {
  readShadowLogEntries,
  appendOutcomeResolutions,
  existingOutcomeEventIds,
  isPredictionEntry,
} from "../../src/institutions/shadow-line.ts";
import { loadProgramManifest } from "../../src/institutions/program-manifest.ts";

function arg(name: string): string | undefined {
  return Bun.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}
function argFlag(name: string): boolean {
  return Bun.argv.includes(`--${name}`);
}

async function main() {
  const program = arg("program");
  const dbPath = arg("db") ?? DEFAULT_EVENT_STORE_DB;
  const dryRun = argFlag("dry-run");

  if (!program) {
    console.error("Usage: bun tools/tennis/backfill-outcomes.ts --program=tennis-game-model [--dry-run]");
    process.exit(1);
  }

  const alphaRoot = joinPath(process.cwd(), "alpha");
  const manifestPath = joinPath(alphaRoot, program, "program.json");
  const manifest = await loadProgramManifest(manifestPath);
  const logPath = joinPath(alphaRoot, program, manifest.shadowLog);

  const entries = await readShadowLogEntries(logPath);
  const resolvedEvents = existingOutcomeEventIds(entries);

  const unresolvedPredictions = entries
    .filter(isPredictionEntry)
    .filter((e) => !resolvedEvents.has(e.eventId));

  if (unresolvedPredictions.length === 0) {
    console.log(`No unresolved predictions in ${program}`);
    return;
  }

  console.log(`Unresolved predictions: ${unresolvedPredictions.length}`);

  const db = openEventStore({ dbPath, readonly: true });

  const eventIds = [...new Set(unresolvedPredictions.map((p) => p.eventId))];
  const outcomesByEventId: Record<string, 0 | 1> = {};
  let resolved = 0;
  let missing = 0;

  for (const eventId of eventIds) {
    const event = db
      .query(`SELECT winner, loser, outcome FROM events WHERE event_id = $id`)
      .get({ $id: eventId }) as { winner: string; loser: string; outcome: string } | null;

    if (!event || event.outcome !== "completed" || !event.winner) {
      missing++;
      continue;
    }

    const market = db
      .query(`SELECT yes_side_label FROM markets WHERE event_id = $id LIMIT 1`)
      .get({ $id: eventId }) as { yes_side_label: string } | null;

    if (!market || !market.yes_side_label) {
      missing++;
      continue;
    }

    const winnerNormalized = event.winner.trim().toLowerCase();
    const yesLabelNormalized = market.yes_side_label.trim().toLowerCase();
    const outcome = winnerNormalized === yesLabelNormalized ? 1 : 0;
    outcomesByEventId[eventId] = outcome;
    resolved++;
  }

  console.log(`Resolvable: ${resolved}, Missing: ${missing}`);

  if (dryRun) {
    for (const [eventId, outcome] of Object.entries(outcomesByEventId).slice(0, 10)) {
      console.log(`  ${eventId} → ${outcome}`);
    }
    if (Object.keys(outcomesByEventId).length > 10) {
      console.log(`  … ${Object.keys(outcomesByEventId).length - 10} more`);
    }
    return;
  }

  if (Object.keys(outcomesByEventId).length === 0) {
    console.log("No outcomes to append");
    return;
  }

  const result = await appendOutcomeResolutions(logPath, manifest.name, outcomesByEventId, entries);
  console.log(`Appended ${result} outcome-resolution entries`);

  const afterEntries = await readShadowLogEntries(logPath);
  const chainValid = entries.length + result === afterEntries.length;
  console.log(`Chain valid: ${chainValid}`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
