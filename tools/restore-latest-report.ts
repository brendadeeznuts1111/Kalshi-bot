#!/usr/bin/env bun
/** @deprecated Prefer `restore-committed-artifacts.ts` — kept for import compatibility. */
import { REPORT_DIR, joinPath } from "../src/research/paths.ts";
import { restoreCommittedArtifacts } from "./restore-committed-artifacts.ts";

const FIXTURE = joinPath(REPORT_DIR, "latest.md.fixture");
const TARGET = joinPath(REPORT_DIR, "latest.md");

async function restoreLatestReport(): Promise<boolean> {
  const restored = await restoreCommittedArtifacts();
  return restored.includes("latest.md");
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
