#!/usr/bin/env bun
/**
 * Read-only session plane probe — public inventory vs gsid-gated priced path.
 *
 *   bun run inventory:session-probe
 *   bun run inventory:session-probe -- --json
 *   bun run inventory:session-probe -- --gsid=<from-plive-shell>
 *   bun run inventory:session-probe -- --no-shell-gsid   # only test operator gsid
 *   PLIVE_GSID=… bun run inventory:session-probe
 *
 * Default: auto-use shell-minted x-gsid for streamToken when no operator gsid.
 * Never prints full gsid/JWT. Never writes secrets to disk.
 * Pandora frames: partner:pandora-probe.
 */
import {
  formatSessionPlaneProbeReport,
  probeSessionPlanes,
} from '../src/inventory/session-plane-probe.ts';
import { parseArgs } from 'node:util';

const { values: spv } = parseArgs({ args: Bun.argv.slice(2), options: { json: { type: 'boolean' }, gsid: { type: 'string' }, 'no-shell-gsid': { type: 'boolean' } }, strict: false, allowPositionals: true });
function argValue(name: string): string | undefined {
  const v = spv[name];
  return typeof v === 'string' ? v : undefined;
}
function hasFlag(name: string): boolean {
  return spv[name] !== undefined;
}

const json = hasFlag('json');
const gsid = argValue('gsid')?.trim() || Bun.env.PLIVE_GSID?.trim() || undefined;
const useShellGsid = !hasFlag('no-shell-gsid');

const report = await probeSessionPlanes({
  ...(gsid !== undefined ? { gsid } : {}),
  useShellGsid,
});

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(formatSessionPlaneProbeReport(report));
}

process.exit(report.summary.allRequiredOk ? 0 : 1);
