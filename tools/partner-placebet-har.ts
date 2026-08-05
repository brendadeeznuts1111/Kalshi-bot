#!/usr/bin/env bun
/**
 * Extract PlaceBet endpoint map (+ optional ticket ingest) from a Chrome HAR.
 *
 * Does **not** invent URLs — only promotes request/response pairs whose body
 * matches the known betGroups wire.
 *
 *   bun run partner:placebet-har -- --har=path/to/export.har
 *   bun run partner:placebet-har -- --har=… --out=research/tickets/place-bet-map.json
 *   bun run partner:placebet-har -- --har=… --ingest --out-id=out-SPEN-1
 *   bun run partner:placebet-har -- --har=… --json
 *
 * After review:
 *   export FANTASY402_PLACE_BET_URL='<map.url>'
 *   # or keep map file and load in adapter tests
 *
 * @see docs/PARTNER-FANTASY-ULTRA.md
 * @see src/partner/fantasy-ultra/place-bet-har.ts
 */
// @see https://bun.com/docs/api/file-io
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { openEventStore } from "../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../src/institutions/event-store/paths.ts";
import {
  extractBetGroupsWiresFromHar,
  extractPlaceBetMapFromHar,
  loadHarFile,
} from "../src/partner/fantasy-ultra/place-bet-har.ts";
import { parseBetGroupsResponse } from "../src/partner/fantasy-ultra/parse.ts";
import {
  ensurePartnerLedgerSchema,
  writeTicketFromBetGroup,
} from "../src/partner/ledger.ts";
import {
  ensurePartnerRegistrySchema,
  getBettingAccountById,
} from "../src/partner/registry.ts";
import { parseOutMeta } from "../src/partner/skins.ts";

function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function partnerFromOutId(outId: string): string {
  const m = /^out-([A-Za-z0-9]+)-/i.exec(outId);
  return m?.[1]?.toUpperCase() ?? "UNKNOWN";
}

async function main(): Promise<void> {
  const harPath = argValue("har");
  if (!harPath) {
    console.error(
      "Usage: bun run partner:placebet-har -- --har=export.har [--out=map.json] [--ingest --out-id=out-SPEN-1]",
    );
    process.exit(1);
  }

  if (!(await Bun.file(harPath).exists())) {
    console.error(`HAR not found: ${harPath}`);
    process.exit(1);
  }

  const har = await loadHarFile(harPath);
  const { map, candidates } = extractPlaceBetMapFromHar(har, {
    harPath,
  });
  const wires = extractBetGroupsWiresFromHar(har);

  const outPath =
    argValue("out") ??
    join(process.cwd(), "research/tickets/place-bet-map.json");

  if (map) {
    mkdirSync(dirname(outPath), { recursive: true });
    await Bun.write(outPath, JSON.stringify(map, null, 2) + "\n");
  }

  let ingest:
    | { outId: string; written: number; groups: number }
    | undefined;
  if (hasFlag("ingest")) {
    const outId = argValue("out-id")?.trim();
    if (!outId) {
      console.error("--ingest requires --out-id=out-SPEN-1");
      process.exit(1);
    }
    const db = openEventStore({ dbPath: DEFAULT_EVENT_STORE_DB });
    ensurePartnerLedgerSchema(db);
    ensurePartnerRegistrySchema(db);
    const row = getBettingAccountById(db, outId);
    const meta = row ? parseOutMeta(row.metaJson) : {};
    const partnerCode =
      (typeof meta.partnerCode === "string" && meta.partnerCode) ||
      partnerFromOutId(outId);
    const partnerId = row?.partnerId ?? `partner-${partnerCode.toLowerCase()}`;
    const provider = row?.provider ?? "fantasy402";
    let written = 0;
    let groups = 0;
    for (const wire of wires) {
      const parsed = parseBetGroupsResponse(wire);
      for (const g of parsed.groups) {
        groups++;
        const r = writeTicketFromBetGroup(db, {
          outId,
          partnerId,
          partnerCode,
          provider,
          group: g,
        });
        if (r.action === "inserted" || r.action === "updated") written++;
      }
    }
    ingest = { outId, written, groups };
  }

  const report = {
    ok: Boolean(map),
    harPath,
    mapPath: map ? outPath : null,
    candidates,
    map: map
      ? {
          url: map.url,
          method: map.method,
          encoding: map.encoding,
          requestKeys: map.requestKeys,
          score: map.score,
          responseOk: map.responseOk,
          sampleTicketNumbers: map.sampleTicketNumbers,
          notes: map.notes,
        }
      : null,
    betGroupsResponses: wires.length,
    ingest,
    next: map
      ? [
          `Review ${outPath}`,
          `export FANTASY402_PLACE_BET_URL=${JSON.stringify(map.url)}`,
          "bun run partner:test-fantasy -- --out=out-SPEN-1  # session",
          "placeOrder with dryRun:false only after body keys match live UI",
        ]
      : [
          "No betGroups response found in HAR.",
          "In Chrome: Network → Place Bet → Save all as HAR with content.",
          "Ensure response body is preserved (not truncated).",
        ],
  };

  if (hasFlag("json") || !process.stdout.isTTY) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `placebet-har: ${report.ok ? "MAPPED" : "NO MATCH"}  candidates=${candidates.length} betGroupsBodies=${wires.length}`,
    );
    if (map) {
      console.log(`  url: ${map.url}`);
      console.log(`  method: ${map.method}  encoding: ${map.encoding}  score=${map.score}`);
      console.log(`  requestKeys: ${map.requestKeys.join(", ") || "(none)"}`);
      console.log(`  wrote: ${outPath}`);
      console.log(`  export FANTASY402_PLACE_BET_URL=${JSON.stringify(map.url)}`);
    } else {
      console.log("  No PlaceBet candidate (need response with betGroups[]).");
    }
    if (ingest) {
      console.log(
        `  ingest: out=${ingest.outId} groups=${ingest.groups} written=${ingest.written}`,
      );
    }
    console.log("  next:");
    for (const n of report.next) console.log(`    · ${n}`);
  }

  if (!map) process.exitCode = 1;
}

await main();
