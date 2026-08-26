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

function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
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
