#!/usr/bin/env bun
/**
 * `bun run kalshi:secrets` — move Kalshi credentials into the OS keychain.
 *
 *   store  — read KALSHI_API_KEY_ID (or KALSHI_ACCESS_KEY) and the RSA-PSS
 *            private key (KALSHI_PRIVATE_KEY inline, or the file at
 *            KALSHI_PRIVATE_KEY_PATH) from the environment and store both in
 *            the OS credential vault via Bun.secrets under service
 *            "com.kalshi-bot".
 *   get    — report whether the credentials are stored. The key id is shown;
 *            key material is never printed (count only).
 *   delete — remove both entries from the vault.
 *
 * This is the migration step for moving the plaintext `.env.kalshi-key.pem` /
 * `.env` credential values into the OS vault. `loadKalshiCredentials` is now
 * async and falls back to this vault when env/file is absent (env stays
 * authoritative when both are present).
 *
 * @see https://bun.com/docs/runtime/bun-secrets (Bun 1.4 secrets manager)
 * @see src/bot/kalshi-auth.ts — runtime credential loading (env/file first, keychain fallback)
 */
import { readFileSync } from "node:fs";
import {
  DEFAULT_SECRET_SERVICE,
  deleteSecret,
  getSecret,
  setSecret,
} from "../src/lib/secrets.ts";
import { KALSHI_KEY_ID_SECRET, KALSHI_KEY_SECRET } from "../src/bot/kalshi-auth.ts";

const SERVICE = DEFAULT_SECRET_SERVICE;
const KEY_ID_NAME = KALSHI_KEY_ID_SECRET;
const KEY_NAME = KALSHI_KEY_SECRET;

async function store(): Promise<number> {
  const env = Bun.env as Record<string, string | undefined>;
  const keyId = (env.KALSHI_API_KEY_ID ?? env.KALSHI_ACCESS_KEY)?.trim();
  if (!keyId) {
    console.error("Missing KALSHI_API_KEY_ID (or KALSHI_ACCESS_KEY)");
    return 1;
  }
  const pemInline = env.KALSHI_PRIVATE_KEY?.trim();
  const pemPath = env.KALSHI_PRIVATE_KEY_PATH?.trim();
  let pem: string;
  if (pemInline) {
    pem = pemInline.includes("\\n") ? pemInline.replace(/\\n/g, "\n") : pemInline;
  } else if (pemPath) {
    pem = readFileSync(pemPath, "utf8");
  } else {
    console.error("Missing KALSHI_PRIVATE_KEY_PATH or KALSHI_PRIVATE_KEY");
    return 1;
  }
  await setSecret({ service: SERVICE, name: KEY_ID_NAME, value: keyId });
  await setSecret({ service: SERVICE, name: KEY_NAME, value: pem });
  console.log("stored " + KEY_ID_NAME + " + " + KEY_NAME + " in OS keychain (service " + SERVICE + ")");
  return 0;
}

async function get(): Promise<number> {
  const keyId = await getSecret({ service: SERVICE, name: KEY_ID_NAME });
  const pem = await getSecret({ service: SERVICE, name: KEY_NAME });
  if (!keyId || !pem) {
    console.log(
      "no Kalshi credentials in OS keychain yet — run `bun run kalshi:secrets store`",
    );
    return 1;
  }
  console.log("keyId: " + keyId);
  console.log("private key: stored (" + pem.length + " chars)");
  return 0;
}

async function del(): Promise<number> {
  await deleteSecret({ service: SERVICE, name: KEY_ID_NAME });
  await deleteSecret({ service: SERVICE, name: KEY_NAME });
  console.log("deleted Kalshi credentials from OS keychain (service " + SERVICE + ")");
  return 0;
}

const commands: Record<string, () => Promise<number>> = { store, get, delete: del };
const [cmd] = process.argv.slice(2);
const run = commands[cmd];
if (!run) {
  console.error("usage: bun run kalshi:secrets <store|get|delete>");
  process.exit(2);
}
process.exit(await run());
