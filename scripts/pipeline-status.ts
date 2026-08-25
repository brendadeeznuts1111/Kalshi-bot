#!/usr/bin/env bun
/**
 * ops:pipelines — one-page pipeline health status (terminal view).
 * Collection lives in src/lib/pipeline-status.ts (shared with the server);
 * this CLI prints the table and exits 1 when any gate fails.
 */
import { collectPipelineStatus, renderPipelineStatus } from "../src/lib/pipeline-status.ts";

const rows = await collectPipelineStatus();
console.log(renderPipelineStatus(rows));
process.exit(rows.some((r) => r.ok === false) ? 1 : 0);
