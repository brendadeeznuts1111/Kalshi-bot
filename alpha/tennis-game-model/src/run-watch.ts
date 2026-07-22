/**
 * Shadow tick across watch-set book_ticks (event-store only).
 */
import { unbrand } from "../../../src/institutions/event-store/brands.ts";
import { DEFAULT_EVENT_STORE_DB } from "../../../src/institutions/event-store/paths.ts";
import { openEventStore } from "../../../src/institutions/event-store/open-db.ts";
import { latestBookTicksForWatchSet } from "./book-context.ts";
import { executeOnce } from "./execute.ts";

function arg(name: string): string | undefined {
  return Bun.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

export async function runWatchShadow(options: {
  dbPath?: string;
  leadMinutes?: number;
  dryRun?: boolean;
}): Promise<{ ticked: number; skipped: number }> {
  const db = openEventStore({
    dbPath: options.dbPath ?? DEFAULT_EVENT_STORE_DB,
    readonly: true,
  });
  const ticks = latestBookTicksForWatchSet(db, { leadMinutes: options.leadMinutes });
  let ticked = 0;
  let skipped = 0;

  for (const row of ticks) {
    if (options.dryRun) {
      console.log(`would tick ${unbrand(row.ticker)} mid=${row.midCents}`);
      ticked++;
      continue;
    }
    try {
      await executeOnce({
        ticker: unbrand(row.ticker),
        eventId: unbrand(row.eventId),
        dbPath: options.dbPath,
      });
      ticked++;
    } catch {
      skipped++;
    }
  }

  return { ticked, skipped };
}

if (import.meta.main) {
  const dbPath = arg("db");
  const lead = arg("lead");
  const dryRun = Bun.argv.includes("--dry-run");
  const leadMinutes = lead ? Number(lead) : undefined;

  const summary = await runWatchShadow({ dbPath, leadMinutes, dryRun });
  console.log(`Watch-set shadow: ticked=${summary.ticked} skipped=${summary.skipped}`);
}
