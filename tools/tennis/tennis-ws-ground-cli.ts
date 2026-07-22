#!/usr/bin/env bun
// @see https://bun.com/docs/guides/process/argv
// @see https://bun.com/docs/runtime/webview
// @see https://bun.com/docs/runtime/image
/**
 * Render tennis WS / book_ticks dashboard via Bun.WebView + Bun.Image thumb.
 * Zero network — reads event-store only.
 */
import { parseArgs } from "node:util";
import { ensureEventStoreDir, openEventStore } from "../../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../../src/institutions/event-store/paths.ts";
import {
  captureTennisWsGround,
  formatTennisWsGroundLines,
  persistTennisWsGroundArtifact,
} from "../../src/institutions/event-store/tennis-ws-ground.ts";

export async function runTennisWsGroundCli(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      lead: { type: "string" },
      limit: { type: "string" },
      db: { type: "string" },
      /** Write HTML only — skip Bun.WebView screenshot. */
      "html-only": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
    strict: false,
  });

  await ensureEventStoreDir();
  const dbPath = typeof values.db === "string" ? values.db : DEFAULT_EVENT_STORE_DB;
  const db = openEventStore({ dbPath });
  const leadMinutes = values.lead ? Number(values.lead) : 5;
  const limit = values.limit ? Number(values.limit) : 40;

  const artifact = await captureTennisWsGround(db, {
    leadMinutes,
    limit,
    htmlOnly: values["html-only"] === true,
  });
  await persistTennisWsGroundArtifact(artifact);

  if (values.json) {
    console.log(JSON.stringify(artifact, null, 2));
  } else {
    console.log(formatTennisWsGroundLines(artifact).join("\n"));
  }
  return 0;
}

if (import.meta.main) {
  process.exit(await runTennisWsGroundCli(process.argv.slice(2)));
}
