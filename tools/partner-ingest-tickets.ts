#!/usr/bin/env bun
/**
 * Ingest PlaceBet / open-ticket `betGroups` JSON into partner_ledger (kind=ticket).
 *
 * Accepts:
 *   - JSONL: one wire object per line (`{ betGroups, e, d }` or a single group)
 *   - JSON file: full wire or `{ betGroups: [...] }`
 *   - Directory: all `*.json` / `*.jsonl` under `--dir=`
 *
 *   bun run partner:ingest-tickets -- --json=research/tickets/one.json --out-id=out-SPEN-1
 *   bun run partner:ingest-tickets -- --jsonl=research/tickets/placebet.jsonl --out-id=out-SPEN-1
 *   bun run partner:ingest-tickets -- --dir=research/tickets --out-id=out-SPEN-1
 *   bun run partner:ingest-tickets -- --json=… --out-id=out-SPEN-1 --dry-run
 *   bun run partner:ingest-tickets -- --json=… --out-id=out-SPEN-1 --no-update
 *
 * Re-ingest with the same ticketNumber updates state/result/isWin when the
 * wire changes (settlement markers). Identical payload → skipped.
 *
 * No PlaceBet POST is mapped yet — offline ingest of captured responses.
 *
 * @see src/partner/ledger.ts writeTicketFromBetGroup
 * @see docs/SEAT-OPS.md
 */
// @see https://bun.com/docs/runtime/file-io
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { openEventStore } from "../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../src/institutions/event-store/paths.ts";
import {
  executionResultFromBetGroups,
  parseBetGroupsResponse,
} from "../src/partner/fantasy-ultra/parse.ts";
import {
  ensurePartnerLedgerSchema,
  sumTicketTotalsForDay,
  writeTicketFromBetGroup,
  writeTicketFromExecution,
  type TicketWriteResult,
} from "../src/partner/ledger.ts";
import {
  ensurePartnerRegistrySchema,
  getBettingAccountById,
} from "../src/partner/registry.ts";
import { parseOutMeta } from "../src/partner/out-capacity.ts";
import type { PartnerBetGroup } from "../src/partner/types.ts";

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

function isBetGroupsWire(v: unknown): boolean {
  return Boolean(v && typeof v === "object" && "betGroups" in (v as object));
}

type IngestCounts = {
  written: number;
  updated: number;
  skipped: number;
  groups: number;
};

function applyWrite(counts: IngestCounts, r: TicketWriteResult): void {
  if (r.action === "inserted") counts.written++;
  else if (r.action === "updated") counts.updated++;
  else counts.skipped++;
}

function ingestWire(
  db: ReturnType<typeof openEventStore>,
  wire: unknown,
  meta: {
    outId: string;
    partnerId: string;
    partnerCode: string;
    provider: string;
    updateExisting: boolean;
    dryRun: boolean;
  },
): IngestCounts {
  const counts: IngestCounts = {
    written: 0,
    updated: 0,
    skipped: 0,
    groups: 0,
  };

  const writeGroup = (g: PartnerBetGroup) => {
    counts.groups++;
    if (meta.dryRun) {
      counts.written++;
      return;
    }
    applyWrite(
      counts,
      writeTicketFromBetGroup(db, {
        outId: meta.outId,
        partnerId: meta.partnerId,
        partnerCode: meta.partnerCode,
        provider: meta.provider,
        group: g,
        updateExisting: meta.updateExisting,
      }),
    );
  };

  if (isBetGroupsWire(wire)) {
    const { groups } = parseBetGroupsResponse(wire);
    for (const g of groups) writeGroup(g);
    return counts;
  }

  if (wire && typeof wire === "object" && "ticketNumber" in (wire as object)) {
    writeGroup(wire as PartnerBetGroup);
    return counts;
  }

  const exec = executionResultFromBetGroups(wire);
  counts.groups = exec.ticketNumber ? 1 : 0;
  if (meta.dryRun) {
    if (exec.ticketNumber) counts.written++;
    else counts.skipped++;
    return counts;
  }
  applyWrite(
    counts,
    writeTicketFromExecution(db, {
      outId: meta.outId,
      partnerId: meta.partnerId,
      partnerCode: meta.partnerCode,
      provider: meta.provider,
      result: exec,
      updateExisting: meta.updateExisting,
    }),
  );
  return counts;
}

async function listTicketFiles(dir: string): Promise<string[]> {
  const names = await readdir(dir);
  return names
    .filter((n) => n.endsWith(".json") || n.endsWith(".jsonl"))
    .sort()
    .map((n) => join(dir, n));
}

async function main(): Promise<void> {
  const jsonl = argValue("jsonl");
  const jsonPath = argValue("json");
  const dirPath = argValue("dir");
  const outId = argValue("out-id") ?? "out-SPEN-1";
  const dryRun = hasFlag("dry-run");
  const updateExisting = !hasFlag("no-update");
  const jsonOut = hasFlag("json-out") || hasFlag("machine");

  if (!jsonl && !jsonPath && !dirPath) {
    console.error(
      "usage: bun run partner:ingest-tickets -- --json=<path>|--jsonl=<path>|--dir=<path> --out-id=out-SPEN-1 [--dry-run] [--no-update]",
    );
    process.exitCode = 1;
    return;
  }

  const db = openEventStore({ dbPath: DEFAULT_EVENT_STORE_DB });
  ensurePartnerRegistrySchema(db);
  ensurePartnerLedgerSchema(db);

  const account = getBettingAccountById(db, outId);
  const metaFromAccount = account ? parseOutMeta(account.metaJson) : null;
  const partnerCode = (
    argValue("partner-code") ??
    (typeof metaFromAccount?.partnerCode === "string"
      ? metaFromAccount.partnerCode
      : null) ??
    partnerFromOutId(outId)
  ).toUpperCase();
  const partnerId =
    argValue("partner-id") ?? account?.partnerId ?? `partner-${partnerCode.toLowerCase()}`;
  const provider =
    argValue("provider") ?? account?.provider ?? "fantasy402";

  const meta = {
    outId,
    partnerId,
    partnerCode,
    provider,
    updateExisting,
    dryRun,
  };

  let written = 0;
  let updated = 0;
  let skipped = 0;
  let groups = 0;
  let files = 0;
  let lines = 0;

  const paths: string[] = [];
  if (dirPath) paths.push(...(await listTicketFiles(dirPath)));
  if (jsonPath) paths.push(jsonPath);
  if (jsonl) paths.push(jsonl);

  for (const path of paths) {
    files++;
    if (path.endsWith(".jsonl")) {
      const text = await Bun.file(path).text();
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        lines++;
        const wire = JSON.parse(trimmed) as unknown;
        const r = ingestWire(db, wire, meta);
        written += r.written;
        updated += r.updated;
        skipped += r.skipped;
        groups += r.groups;
      }
    } else {
      const wire = (await Bun.file(path).json()) as unknown;
      lines++;
      const r = ingestWire(db, wire, meta);
      written += r.written;
      updated += r.updated;
      skipped += r.skipped;
      groups += r.groups;
    }
  }

  const totals = sumTicketTotalsForDay(db, { partnerCode, outId });
  const summary = {
    outId,
    partnerCode,
    partnerId,
    provider,
    dryRun,
    updateExisting,
    registryHit: Boolean(account),
    files,
    lines,
    groups,
    written,
    updated,
    skipped,
    ticketsToday: totals,
  };
  if (jsonOut) console.log(JSON.stringify(summary, null, 2));
  else {
    const mode = dryRun ? "dry-run" : "ingest-tickets";
    console.error(
      `${mode}: out=${outId} files=${files} groups=${groups} written=${written} updated=${updated} skipped=${skipped}` +
        (account ? "" : " (out not in registry — using CLI meta)"),
    );
    console.error(
      `  today ${totals.dayUtc}: n=${totals.ticketCount} risk=$${totals.totalRisk} toWin=$${totals.totalToWin}` +
        ` open=${totals.openCount}/$${totals.openRisk} settled=${totals.settledCount}`,
    );
  }
}

await main();
