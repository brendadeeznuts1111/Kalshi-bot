#!/usr/bin/env bun
/**
 * `bun run kalshi:secrets` — move Kalshi credentials into the OS keychain.
 *
 *   store   — read KALSHI_API_KEY_ID (or KALSHI_ACCESS_KEY) and the RSA-PSS
 *             private key (KALSHI_PRIVATE_KEY inline, or the file at
 *             KALSHI_PRIVATE_KEY_PATH) from the environment and store both in
 *             the OS credential vault via Bun.secrets.
 *   get     — report whether the credentials are stored. The key id is shown;
 *             key material is never printed (count only).
 *   inspect — print the resolved service/name, existence, and a masked
 *             fingerprint per entry — never the secret itself.
 *   delete  — remove both entries from the vault (prompts unless --force).
 *
 * Flags:
 *   --service <name>  service namespace (default com.kalshi-bot). Use a
 *                     dedicated name (e.g. kalshi-api-test) to verify
 *                     round-trips without touching production credentials.
 *   --force           overwrite on store / proceed on delete without prompting
 *                     (CI, non-interactive).
 *   --unrestricted    macOS only: allow all apps to read the item without a
 *                     keychain prompt (CI use; reduces security).
 *   --verbose         log the exact Bun.secrets.set call shape (value length
 *                     only — never the secret itself).
 *
 * Safety: store prompts before overwriting an existing credential and delete
 * prompts before removing, unless --force is passed. Prompts read stdin; when
 * stdin is closed (CI) they default to "no".
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
import { confirmYes } from "../src/lib/readline.ts";

const KEY_ID_NAME = KALSHI_KEY_ID_SECRET;
const KEY_NAME = KALSHI_KEY_SECRET;

export type CliArgs = {
  command: string | null;
  service: string;
  force: boolean;
  unrestricted: boolean;
  verbose: boolean;
};

/** Parse `--flag` / `--flag=value` / `--flag value`; command = first positional. */
export function parseCliArgs(argv: string[]): CliArgs {
  let command: string | null = null;
  let service = DEFAULT_SECRET_SERVICE;
  let force = false;
  let unrestricted = false;
  let verbose = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "--force") force = true;
    else if (a === "--unrestricted") unrestricted = true;
    else if (a === "--verbose") verbose = true;
    else if (a === "--service") {
      const next = argv[i + 1]?.trim();
      if (next) { service = next; i++; }
    } else if (a.startsWith("--service=")) {
      const v = a.slice("--service=".length).trim();
      if (v) service = v;
    } else if (!a.startsWith("--") && command === null) {
      command = a;
    }
  }
  return { command, service, force, unrestricted, verbose };
}

/** Masked fingerprint (first 8 hex of sha256) — proves identity without leaking the value. */
export function fingerprint(value: string): string {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex").slice(0, 8);
}

/** Prompt decision: only when the entry exists and --force was not passed. */
export function needsPrompt(exists: boolean, force: boolean): boolean {
  return exists && !force;
}

function logSetCall(service: string, name: string, valueLen: number, unrestricted: boolean): void {
  console.log(
    "set({ service: " + service + ", name: " + name + ", value: <" + valueLen +
      " chars>, allowUnrestrictedAccess: " + unrestricted + " })",
  );
}

async function store(args: CliArgs): Promise<number> {
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
  for (const name of [KEY_ID_NAME, KEY_NAME]) {
    const exists = (await getSecret({ service: args.service, name })) != null;
    if (needsPrompt(exists, args.force)) {
      const ok = await confirmYes("Credential " + args.service + "/" + name + " already exists — overwrite?");
      if (!ok) {
        console.log("aborted — nothing overwritten");
        return 1;
      }
    }
  }
  if (args.verbose) {
    logSetCall(args.service, KEY_ID_NAME, keyId.length, args.unrestricted);
    logSetCall(args.service, KEY_NAME, pem.length, args.unrestricted);
  }
  await setSecret({ service: args.service, name: KEY_ID_NAME, value: keyId, allowUnrestrictedAccess: args.unrestricted });
  await setSecret({ service: args.service, name: KEY_NAME, value: pem, allowUnrestrictedAccess: args.unrestricted });
  console.log("stored " + KEY_ID_NAME + " + " + KEY_NAME + " in OS keychain (service " + args.service + ")");
  return 0;
}

async function get(args: CliArgs): Promise<number> {
  const keyId = await getSecret({ service: args.service, name: KEY_ID_NAME });
  const pem = await getSecret({ service: args.service, name: KEY_NAME });
  if (!keyId || !pem) {
    console.log(
      "no Kalshi credentials in OS keychain (service " + args.service + ") — run `bun run kalshi:secrets store --service " + args.service + "`",
    );
    return 1;
  }
  console.log("service: " + args.service);
  console.log("keyId: " + keyId);
  console.log("private key: stored (" + pem.length + " chars)");
  return 0;
}

async function inspect(args: CliArgs): Promise<number> {
  console.log("service: " + args.service);
  let any = false;
  for (const name of [KEY_ID_NAME, KEY_NAME]) {
    const value = await getSecret({ service: args.service, name });
    if (value != null) {
      any = true;
      console.log("  " + name + ": Found · fp:" + fingerprint(value));
    } else {
      console.log("  " + name + ": Not found");
    }
  }
  return any ? 0 : 1;
}

async function del(args: CliArgs): Promise<number> {
  const existing: string[] = [];
  for (const name of [KEY_ID_NAME, KEY_NAME]) {
    if ((await getSecret({ service: args.service, name })) != null) existing.push(name);
  }
  if (existing.length === 0) {
    console.log("no credentials for service " + args.service + " — nothing to delete");
    return 0;
  }
  if (needsPrompt(true, args.force)) {
    const ok = await confirmYes(
      "Delete " + args.service + " credentials (" + existing.join(", ") + ") from the OS keychain?",
    );
    if (!ok) {
      console.log("aborted");
      return 1;
    }
  }
  for (const name of [KEY_ID_NAME, KEY_NAME]) {
    await deleteSecret({ service: args.service, name });
  }
  console.log("deleted " + KEY_ID_NAME + " + " + KEY_NAME + " from OS keychain (service " + args.service + ")");
  return 0;
}

const commands: Record<string, (args: CliArgs) => Promise<number>> = {
  store,
  get,
  inspect,
  delete: del,
};

if (import.meta.main) {
  const args = parseCliArgs(process.argv.slice(2));
  const run = args.command != null ? commands[args.command] : undefined;
  if (!run) {
    console.error(
      "usage: bun run kalshi:secrets <store|get|inspect|delete> [--service <name>] [--force] [--unrestricted] [--verbose]",
    );
    process.exit(2);
  }
  process.exit(await run(args));
}
