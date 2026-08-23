#!/usr/bin/env bun
/**
 * Live Kalshi auth probe using keychain-sourced credentials ONLY.
 *
 * Proves the full chain end-to-end without touching env or key files:
 *   OS keychain (service) → loadKalshiCredentials({}, { service }) →
 *   signKalshiPss → signed GET /portfolio/balance → live Kalshi API.
 *
 * Usage:
 *   bun run kalshi:live-probe --service com.kalshi-bot-sandbox
 *   bun run kalshi:live-probe --service kalshi-api-test --env demo
 *
 * Flags:
 *   --service <name>  keychain service (default com.kalshi-bot).
 *   --env demo|prod   endpoint environment — DEFAULT demo (safe). prod
 *                     additionally requires KALSHI_PROD_ARMED=1.
 *   --timeout <ms>    request timeout (default 10000).
 *
 * Exit: 0 on HTTP 200/valid auth, 1 on failure. An invalid/throwaway key
 * yields a signature-valid 401 — the chain executed; only the key is bad.
 *
 * @see https://docs.kalshi.com/api-reference
 * @see src/bot/kalshi-auth.ts — signing + probe
 */
import { argValue } from "../src/cli/argv.ts";
import { DEFAULT_SECRET_SERVICE } from "../src/lib/secrets.ts";
import { loadKalshiCredentials, probeKalshiAuth } from "../src/bot/kalshi-auth.ts";
import { OFFICIAL_URLS } from "../src/institutions/official-urls.ts";
import { assertBunAtLeast } from "../src/research/bun-native.ts";

assertBunAtLeast("1.4.0", "kalshi:live-probe");

const service = argValue("service")?.trim() || DEFAULT_SECRET_SERVICE;
const envName = argValue("env") === "prod" ? "prod" : "demo";
const timeoutMs = Number(argValue("timeout") ?? "10000") || 10_000;

if (envName === "prod" && Bun.env.KALSHI_PROD_ARMED !== "1") {
  console.error("prod probe requires KALSHI_PROD_ARMED=1 — refusing");
  process.exit(2);
}

// Empty env: prove the keychain alone supplies credentials (no .env, no key file).
const creds = await loadKalshiCredentials({}, { service });
const base =
  envName === "prod" ? OFFICIAL_URLS.kalshi.tradeApiV2Base : OFFICIAL_URLS.kalshi.tradeApiV2BaseDemo;

console.log("service: " + service);
console.log("keyId: " + creds.keyId);
console.log("key type: " + creds.privateKey.asymmetricKeyType);
console.log("probe: GET /portfolio/balance @ " + base + " (" + envName + ")");

const probe = await probeKalshiAuth(creds, { base, timeoutMs });
console.log(
  "result: " + (probe.ok ? "OK" : "FAILED") + " · HTTP " + probe.status + " · " + probe.endpoint,
);
process.exit(probe.ok ? 0 : 1);
