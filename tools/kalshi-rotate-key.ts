#!/usr/bin/env bun
// @see https://bun.com/docs/runtime/child-process#spawn-a-process-bun-spawn — Bun.spawn
// @see https://bun.com/docs/runtime/file-io#writing-files-bun-write — Bun.write
/**
 * Kalshi API key rotation helper — one command instead of a multi-file ritual.
 *
 *   bun tools/kalshi-rotate-key.ts --key-id <id> --pem <path-to-new-private-key>
 *   bun tools/kalshi-rotate-key.ts --key-id <id> --pem <path> --dry-run
 *
 * Does:
 *   1. Installs the new private key at ~/.config/kalshi/kalshi-bot-tennis-ws.pem (0600)
 *   2. Updates ~/.config/shell/kalshi.sh exports (KALSHI_API_KEY_ID + path)
 *   3. Verifies with the signed pre-flight probe (probeKalshiAuth) and prints
 *      the resulting auth state — the /ops badge picks it up within 5 minutes.
 *
 * Never prints secret material. Key source: https://kalshi.com/account/profile → API Keys
 */
import { chmodSync } from 'node:fs';
import { join } from 'node:path';
import { probeKalshiAuth, loadKalshiCredentials } from '../src/bot/kalshi-auth.ts';

const HOME = Bun.env.HOME!;
const PEM_DEST = join(HOME, '.config', 'kalshi', 'kalshi-bot-tennis-ws.pem');
const SHELL_FILE = join(HOME, '.config', 'shell', 'kalshi.sh');

function flag(name: string): string | undefined {
  const i = Bun.argv.indexOf(name);
  return i >= 0 ? Bun.argv[i + 1] : undefined;
}

const DRY_RUN = Bun.argv.includes('--dry-run');

function renderShellFile(keyId: string): string {
  return [
    '# ~/.config/shell/kalshi.sh — Kalshi API credentials (local machine only)',
    '# Key from https://kalshi.com/account/profile → API Keys',
    `export KALSHI_API_KEY_ID=${keyId}`,
    `export KALSHI_PRIVATE_KEY_PATH="$HOME/.config/kalshi/kalshi-bot-tennis-ws.pem"`,
    '',
  ].join('\n');
}

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
  if (!pemText.includes('PRIVATE KEY')) {
    console.error(`${pem} does not look like a PEM private key (no 'PRIVATE KEY' marker)`);
    process.exit(1);
  }

  console.log(`key-id: ${keyId.slice(0, 8)}… (len ${keyId.length})`);
  console.log(`pem:    ${pem} → ${PEM_DEST} (0600)`);

  if (DRY_RUN) {
    console.log('dry-run: no files written');
    return;
  }

  await Bun.write(PEM_DEST, pemText);
  chmodSync(PEM_DEST, 0o600);
  await Bun.write(SHELL_FILE, renderShellFile(keyId));
  chmodSync(SHELL_FILE, 0o600);
  console.log(`wrote: ${PEM_DEST} (0600)`);
  console.log(`wrote: ${SHELL_FILE} (0600)`);

  // Verify against the live API with the NEW material (explicit env, not shell state).
  process.env.KALSHI_API_KEY_ID = keyId;
  process.env.KALSHI_PRIVATE_KEY_PATH = PEM_DEST;
  try {
    const creds = loadKalshiCredentials();
    const probe = await probeKalshiAuth(creds);
    const state = probe.status === 200 ? 'valid ✓' : probe.status === 401 || probe.status === 403 ? 'INVALID ✗' : `unreachable (HTTP ${probe.status})`;
    console.log(`probe: ${state}`);
    if (probe.status !== 200) process.exit(1);
  } catch (err) {
    console.error(`probe failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
