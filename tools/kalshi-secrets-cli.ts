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
 *   --key-id <id>     store key id non-interactively (else env KALSHI_API_KEY_ID).
 *   --key-secret <pem>  store the PEM directly — throwaway test keys only: it is
 *                     visible in the process list; prefer --key-file or env.
 *   --key-file <path> read the PEM from a file (avoids process-list exposure).
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
 * @see https://bun.com/docs/runtime/secrets (Bun 1.4 secrets manager)
 * @see src/bot/kalshi-auth.ts — runtime credential loading (env/file first, keychain fallback)
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
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
  keyId: string | null;
  keySecret: string | null;
  keyFile: string | null;
};

/**
 * Parse `--flag` / `--flag=value` / `--flag value`; command = first positional.
 * `--key-secret` is for throwaway test keys only — it is visible in the
 * process list; prefer `--key-file` or env for real credentials.
 */
export function parseCliArgs(argv: string[]): CliArgs {
  // Bun-recommended util.parseArgs (S207); command = first positional.
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      force: { type: 'boolean' },
      unrestricted: { type: 'boolean' },
      verbose: { type: 'boolean' },
      service: { type: 'string' },
      'key-id': { type: 'string' },
      'key-secret': { type: 'string' },
      'key-file': { type: 'string' },
    },
    strict: false,
    allowPositionals: true,
  });
  const str = (v: unknown): string | null => {
    if (typeof v !== 'string') return null;
    const t = v.trim();
    return t ? t : null;
  };
  return {
    command: positionals[0] ?? null,
    service: str(values.service) ?? DEFAULT_SECRET_SERVICE,
    force: values.force === true,
    unrestricted: values.unrestricted === true,
    verbose: values.verbose === true,
    keyId: str(values['key-id']),
    keySecret: str(values['key-secret']),
    keyFile: str(values['key-file']),
  };
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
  const env = Bun.env;
  // S218: --key-secret puts the PEM on the command line (visible in ps).
  // Refuse unless the explicit escape hatch is set - the registry policy
  // for kalshi-private-key allows vault+env ONLY (never argv).
  if (args.keySecret && Bun.env.KALSHI_SECRETS_ALLOW_ARGV !== "1") {
    console.error(
      "Refusing --key-secret: the PEM would be visible in the process list (ps). " +
        "Use --key-file, KALSHI_PRIVATE_KEY, or KALSHI_PRIVATE_KEY_PATH instead. " +
        "To override for throwaway test keys only, set KALSHI_SECRETS_ALLOW_ARGV=1.",
    );
    return 2;
  }
  const keyId = (args.keyId ?? env.KALSHI_API_KEY_ID ?? env.KALSHI_ACCESS_KEY)?.trim();
  if (!keyId) {
    console.error("Missing key id — pass --key-id or set KALSHI_API_KEY_ID (or KALSHI_ACCESS_KEY)");
    return 1;
  }
  const pemInline = env.KALSHI_PRIVATE_KEY?.trim();
  const pemPath = env.KALSHI_PRIVATE_KEY_PATH?.trim();
  // Precedence: --key-secret > --key-file > env inline > env path.
  let pem: string | null = null;
  if (args.keySecret) {
    pem = args.keySecret.includes("\\n") ? args.keySecret.replace(/\\n/g, "\n") : args.keySecret;
  } else if (args.keyFile) {
    pem = readFileSync(args.keyFile, "utf8");
  } else if (pemInline) {
    pem = pemInline.includes("\\n") ? pemInline.replace(/\\n/g, "\n") : pemInline;
  } else if (pemPath) {
    pem = readFileSync(pemPath, "utf8");
  }
  if (!pem) {
    console.error("Missing private key — pass --key-secret, --key-file, KALSHI_PRIVATE_KEY, or KALSHI_PRIVATE_KEY_PATH");
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
