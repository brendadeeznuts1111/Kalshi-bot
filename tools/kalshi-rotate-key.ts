#!/usr/bin/env bun
// @see https://bun.com/docs/runtime/child-process#spawn-a-process-bun-spawn — Bun.spawn
// @see https://bun.com/docs/runtime/file-io#writing-files-bun-write — Bun.write
/**
 * Kalshi API key rotation helper — one command instead of a multi-file ritual.
 *
 *   bun tools/kalshi-rotate-key.ts --key-id <id> --pem <path-to-new-private-key>
 *   bun tools/kalshi-rotate-key.ts --key-id <id> --pem <path> --dry-run
 *
 * Does (via src/bot/kalshi-rotate.ts — shared with POST /ops/kalshi-rotate-key):
 *   1. Installs the new private key at ~/.config/kalshi/kalshi-bot-tennis-ws.pem (0600)
 *   2. Updates ~/.config/shell/kalshi.sh exports (KALSHI_API_KEY_ID + path)
 *   3. Verifies with the signed pre-flight probe (probeKalshiAuth) and prints
 *      the resulting auth state — the /ops badge picks it up within 5 minutes.
 *
 * Never prints secret material. Key source: https://kalshi.com/account/profile → API Keys
 */
import { kalshiRotatePaths, rotateKalshiKey } from '../src/bot/kalshi-rotate.ts';

function flag(name: string): string | undefined {
  const i = Bun.argv.indexOf(name);
  return i >= 0 ? Bun.argv[i + 1] : undefined;
}

const DRY_RUN = Bun.argv.includes('--dry-run');

async function main(): Promise<void> {
  const keyId = flag('--key-id');
  const pem = flag('--pem');
  if (!keyId || !pem) {
    console.error('Usage: bun tools/kalshi-rotate-key.ts --key-id <id> --pem <path> [--dry-run]');
    process.exit(1);
  }

  const src = Bun.file(pem);
  if (!(await src.exists())) {
    console.error(`pem not found: ${pem}`);
    process.exit(1);
  }
  const pemText = await src.text();
  const { pemDest } = kalshiRotatePaths();

  console.log(`key-id: ${keyId.slice(0, 8)}… (len ${keyId.length})`);
  console.log(`pem:    ${pem} → ${pemDest} (0600)`);

  const result = await rotateKalshiKey({ keyId, pemText, dryRun: DRY_RUN });
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log('dry-run: no files written');
    console.log(`probe: ${result.probe.state} (HTTP ${result.probe.status})`);
    return;
  }

  for (const path of result.written) {
    console.log(`wrote: ${path} (0600)`);
  }

  const state =
    result.probe.state === 'valid'
      ? 'valid ✓'
      : result.probe.state === 'invalid'
        ? 'INVALID ✗'
        : `unreachable (HTTP ${result.probe.status})`;
  console.log(`probe: ${state}`);
  if (result.probe.status !== 200) process.exit(1);
}

if (import.meta.main) {
  await main();
}
