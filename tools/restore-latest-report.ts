#!/usr/bin/env bun
// @see https://bun.com/docs/runtime/file-io#writing-files-bun-write
/**
 * Restore committed report snapshot after tests that overwrite latest.md.
 * SSOT: research/reports/latest.md.fixture → latest.md (+ optional latest.diff.md.fixture)
 */
import { REPORT_DIR, joinPath } from "../src/research/paths.ts";

const FIXTURE = joinPath(REPORT_DIR, "latest.md.fixture");
const DIFF_FIXTURE = joinPath(REPORT_DIR, "latest.diff.md.fixture");
const TARGET = joinPath(REPORT_DIR, "latest.md");
const DIFF_TARGET = joinPath(REPORT_DIR, "latest.diff.md");

async function copyIfExists(from: string, to: string): Promise<boolean> {
  const file = Bun.file(from);
  if (!(await file.exists())) return false;
  await Bun.write(to, file);
  return true;
}

async function restoreLatestReport(): Promise<boolean> {
  const restored = await copyIfExists(FIXTURE, TARGET);
  await copyIfExists(DIFF_FIXTURE, DIFF_TARGET);
  return restored;
}

if (import.meta.main) {
  const restored = await restoreLatestReport();
  if (restored) {
    console.error(`restored ${TARGET} from fixture`);
  } else {
    console.error(`skip: no fixture at ${FIXTURE}`);
  }
}

export { FIXTURE, TARGET, restoreLatestReport };
