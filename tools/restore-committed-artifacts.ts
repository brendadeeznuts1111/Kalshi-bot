#!/usr/bin/env bun
// @see https://bun.com/docs/runtime/file-io#writing-files-bun-write
/**
 * Restore committed artifacts that tests may overwrite or delete.
 * SSOT: *.fixture → production path (reports + audit-evidence JSONL).
 */
import { AUDIT_EVIDENCE_DIR, REPORT_DIR, joinPath } from "../src/research/paths.ts";

export type CommittedArtifactFixture = {
  fixture: string;
  target: string;
  label: string;
};

export const COMMITTED_ARTIFACT_FIXTURES: CommittedArtifactFixture[] = [
  {
    fixture: joinPath(REPORT_DIR, "latest.md.fixture"),
    target: joinPath(REPORT_DIR, "latest.md"),
    label: "latest.md",
  },
  {
    fixture: joinPath(REPORT_DIR, "latest.diff.md.fixture"),
    target: joinPath(REPORT_DIR, "latest.diff.md"),
    label: "latest.diff.md",
  },
  {
    fixture: joinPath(AUDIT_EVIDENCE_DIR, "octagonai__kalshi-trading-bot-cli.jsonl.fixture"),
    target: joinPath(AUDIT_EVIDENCE_DIR, "octagonai__kalshi-trading-bot-cli.jsonl"),
    label: "octagonai audit evidence",
  },
];

async function copyIfExists(from: string, to: string): Promise<boolean> {
  const file = Bun.file(from);
  if (!(await file.exists())) return false;
  await Bun.write(to, file);
  return true;
}

export async function restoreCommittedArtifacts(): Promise<string[]> {
  const restored: string[] = [];
  for (const { fixture, target, label } of COMMITTED_ARTIFACT_FIXTURES) {
    if (await copyIfExists(fixture, target)) restored.push(label);
  }
  return restored;
}

if (import.meta.main) {
  const restored = await restoreCommittedArtifacts();
  if (restored.length) {
    console.error(`restored committed artifacts: ${restored.join(", ")}`);
  } else {
    console.error("skip: no committed artifact fixtures found");
  }
}
