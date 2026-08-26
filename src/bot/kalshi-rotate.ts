// @see https://bun.com/docs/runtime/file-io#writing-files-bun-write — Bun.write
/**
 * Shared Kalshi API key rotation — used by tools/kalshi-rotate-key.ts (CLI)
 * and POST /ops/kalshi-rotate-key (dashboard).
 *
 * Installs the pem at ~/.config/kalshi/kalshi-bot-tennis-ws.pem (0600), rewrites
 * ~/.config/shell/kalshi.sh (0600), updates process env, and verifies the NEW
 * material with the signed pre-flight probe.
 *
 * Never logs or returns secret material — the only pem inspection is the
 * 'PRIVATE KEY' marker check.
 */
import { chmodSync } from "node:fs";
import { createPrivateKey } from "node:crypto";
import { join } from "node:path";
import { probeKalshiAuth, type KalshiCredentials } from "./kalshi-auth.ts";

export type KalshiRotateResult = {
  ok: boolean;
  /** Paths actually written (empty on dry-run / validation failure). */
  written: string[];
  /** Paths that would be written (always populated after validation). */
  planned: string[];
  probe: { status: number; state: "valid" | "invalid" | "unreachable" };
  error?: string;
};

export type KalshiRotateOptions = {
  keyId: string;
  pemText: string;
  dryRun?: boolean;
  /** Root for pem + shell file (default $KALSHI_ROTATE_HOME ?? $HOME) — tests override. */
  home?: string;
  /** Probe base override (tests point at a stub server). */
  probeBase?: string;
  probeTimeoutMs?: number;
};

export function kalshiRotatePaths(home?: string): { pemDest: string; shellFile: string } {
  const root = home ?? Bun.env.KALSHI_ROTATE_HOME ?? Bun.env.HOME!;
  return {
    pemDest: join(root, ".config", "kalshi", "kalshi-bot-tennis-ws.pem"),
    shellFile: join(root, ".config", "shell", "kalshi.sh"),
  };
}

export function renderKalshiShellFile(keyId: string): string {
  return [
    "# ~/.config/shell/kalshi.sh — Kalshi API credentials (local machine only)",
    "# Key from https://kalshi.com/account/profile → API Keys",
    `export KALSHI_API_KEY_ID=${keyId}`,
    `export KALSHI_PRIVATE_KEY_PATH="$HOME/.config/kalshi/kalshi-bot-tennis-ws.pem"`,
    "",
  ].join("\n");
}

function probeState(status: number): "valid" | "invalid" | "unreachable" {
  if (status === 200) return "valid";
  if (status === 401 || status === 403) return "invalid";
  return "unreachable";
}

export async function rotateKalshiKey(opts: KalshiRotateOptions): Promise<KalshiRotateResult> {
  const keyId = opts.keyId.trim();
  const dryRun = opts.dryRun === true;
  const { pemDest, shellFile } = kalshiRotatePaths(opts.home);
  const planned = [pemDest, shellFile];

  if (!keyId) {
    return { ok: false, written: [], planned, probe: { status: 0, state: "unreachable" }, error: "keyId is required" };
  }
  if (!opts.pemText.includes("PRIVATE KEY")) {
    return {
      ok: false,
      written: [],
      planned,
      probe: { status: 0, state: "unreachable" },
      error: "pem does not look like a private key (no 'PRIVATE KEY' marker)",
    };
  }

  // Probe with the NEW material (never via ambient env).
  const creds: KalshiCredentials = { keyId, privateKey: createPrivateKey(opts.pemText) };
  let probe: KalshiRotateResult["probe"];
  try {
    const res = await probeKalshiAuth(creds, {
      ...(opts.probeBase !== undefined ? { base: opts.probeBase } : {}),
      ...(opts.probeTimeoutMs !== undefined ? { timeoutMs: opts.probeTimeoutMs } : {}),
    });
    probe = { status: res.status, state: probeState(res.status) };
  } catch {
    probe = { status: 0, state: "unreachable" };
  }

  if (dryRun) {
    return { ok: probe.state === "valid", written: [], planned, probe };
  }

  await Bun.write(pemDest, opts.pemText);
  chmodSync(pemDest, 0o600);
  await Bun.write(shellFile, renderKalshiShellFile(keyId));
  chmodSync(shellFile, 0o600);

  // In-process env now matches disk — the /ops badge re-probe (after cache
  // reset) sees the new key without a server restart.
  process.env.KALSHI_API_KEY_ID = keyId;
  process.env.KALSHI_PRIVATE_KEY_PATH = pemDest;
  delete process.env.KALSHI_PRIVATE_KEY;

  return { ok: probe.state === "valid", written: planned, planned, probe };
}
