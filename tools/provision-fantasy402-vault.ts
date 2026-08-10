#!/usr/bin/env bun
/**
 * Provision Fantasy402 Ultra Live credentials into Proton Pass.
 *
 * Grounded against live pass-cli (not the blog-style invent):
 * - `item create login` has username/password/url only — no --field
 * - multi-field desk secrets → `item create custom --from-template`
 * - runtime load → bare pass:// URIs in .env.protonpass + `pass-cli run`
 * - PAT sessions are viewer-only: create vault/item needs main login
 *
 * Per-out naming (matches config/partners.example.toml):
 *   env_prefix = FANTASY402_SPEN_1_
 *   item title = "Fantasy402 SPEN 1"
 *   pass://Kalshi Bot/Fantasy402 SPEN 1/bearerToken
 *
 * Credentials are read from env (never printed) via resolvePartnerEnv chain:
 *   out prefix → partner prefix → book fallback
 *
 * Usage:
 *   bun run partner:vault:provision -- --out=out-SPEN-1
 *   bun run partner:vault:provision -- --prefix=FANTASY402_SPEN_1_ --title="Fantasy402 SPEN 1"
 *   bun run partner:vault:provision -- --out=out-SPEN-1 --apply
 *   bun run partner:vault:provision -- --out=out-SPEN-1 --update
 *   bun run partner:vault:provision -- --out=out-SPEN-1 --print-uris
 *   bun run partner:vault:provision -- --vault="Kalshi Bot" --title=Fantasy402   # book fallback
 *   bun run partner:vault:provision -- --create-vault --vault=vault-out-ASH-1 --out=out-ASH-1 --apply
 *
 * @see https://protonpass.github.io/pass-cli/commands/contents/secret-references/
 * @see https://protonpass.github.io/pass-cli/commands/contents/run/
 * @see docs/PROTONPASS.md
 * @see docs/SEAT-OPS.md
 */
// @see https://bun.com/docs/api/spawn
// @see https://bun.com/docs/runtime/utils#bun-which
import { requireDefaultUrlForUltraMapper } from "../src/domain/index.ts";
import {
  fantasyVaultItemTitle,
  loadFantasy402ProfileFromPrefix,
} from "../src/partner/account-profile.ts";
import {
  DEFAULT_REQUIRED_ENV_KEYS,
  PARTNER_ENV_KEYS,
  canonicalOutEnvPrefix,
  normalizeEnvPrefix,
  parseOutId,
  resolvePartnerEnv,
} from "../src/partner/toml-config.ts";

const DEFAULT_VAULT = "Kalshi Bot";
const DEFAULT_TITLE = "Fantasy402";
const DEFAULT_DOMAIN = requireDefaultUrlForUltraMapper();

function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function redact(s: string): string {
  if (!s) return "(empty)";
  if (s.length <= 6) return `[len=${s.length}]`;
  return `${s.slice(0, 4)}…[len=${s.length}]`;
}

async function passCli(
  args: string[],
  opts?: { stdin?: string; allowFail?: boolean },
): Promise<{ code: number; stdout: string; stderr: string }> {
  const bin = Bun.which("pass-cli") ?? "pass-cli";
  const proc = Bun.spawn([bin, ...args], {
    stdin: opts?.stdin != null ? "pipe" : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (opts?.stdin != null && proc.stdin) {
    proc.stdin.write(opts.stdin);
    proc.stdin.end();
  }
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  if (code !== 0 && !opts?.allowFail) {
    const err = (stderr || stdout).trim().slice(0, 400);
    throw new Error(`pass-cli ${args.join(" ")} failed (exit ${code}): ${err}`);
  }
  return { code, stdout, stderr };
}

type DeskCreds = {
  customerID: string;
  agentID: string;
  password: string;
  bearerToken: string;
  domain: string;
  skin: string;
  currency: string;
};

function resolveScope(): {
  outId: string | null;
  envPrefix: string;
  title: string;
} {
  const outId = argValue("out")?.trim() || null;
  const explicitPrefix = argValue("prefix")?.trim();
  const explicitTitle = argValue("title")?.trim();

  if (outId) {
    const parsed = parseOutId(outId);
    if (!parsed) {
      throw new Error(
        `--out must look like out-SPEN-1 (got ${JSON.stringify(outId)})`,
      );
    }
    return {
      outId,
      envPrefix:
        explicitPrefix != null
          ? normalizeEnvPrefix(explicitPrefix)
          : canonicalOutEnvPrefix("fantasy402", outId, parsed.code),
      title: explicitTitle || fantasyVaultItemTitle(outId),
    };
  }

  return {
    outId: null,
    envPrefix: explicitPrefix
      ? normalizeEnvPrefix(explicitPrefix)
      : "FANTASY402_",
    title: explicitTitle || DEFAULT_TITLE,
  };
}

function loadCredsFromEnv(envPrefix: string): DeskCreds | null {
  const profile = loadFantasy402ProfileFromPrefix(envPrefix);
  if (!profile) return null;
  return {
    customerID: profile.meta.customerID,
    agentID: profile.meta.agentID,
    password: profile.meta.password,
    bearerToken: profile.meta.token,
    domain: profile.url || DEFAULT_DOMAIN,
    skin: String(profile.meta.skin),
    currency: profile.meta.currency,
  };
}

function buildCustomTemplate(title: string, creds: DeskCreds) {
  return {
    title,
    note: "Fantasy402 Ultra Live desk — consumed via .env.protonpass + pass-cli run",
    sections: [
      {
        section_name: "Ultra Live",
        fields: [
          { field_name: "customerID", field_type: "text", value: creds.customerID },
          { field_name: "agentID", field_type: "text", value: creds.agentID },
          { field_name: "password", field_type: "hidden", value: creds.password },
          { field_name: "bearerToken", field_type: "hidden", value: creds.bearerToken },
          { field_name: "domain", field_type: "text", value: creds.domain },
          { field_name: "skin", field_type: "text", value: creds.skin },
          { field_name: "currency", field_type: "text", value: creds.currency },
        ],
      },
    ],
  };
}

/** pass:// map keyed by full env var names for the given prefix. */
function uris(
  vault: string,
  title: string,
  envPrefix: string,
): Record<string, string> {
  const base = `pass://${vault}/${title}`;
  const p = normalizeEnvPrefix(envPrefix);
  return {
    [`${p}CUSTOMER_ID`]: `${base}/customerID`,
    [`${p}AGENT_ID`]: `${base}/agentID`,
    [`${p}PASSWORD`]: `${base}/password`,
    [`${p}BEARER_TOKEN`]: `${base}/bearerToken`,
    [`${p}DOMAIN`]: `${base}/domain`,
    [`${p}SKIN`]: `${base}/skin`,
    [`${p}CURRENCY`]: `${base}/currency`,
  };
}

async function itemExists(vault: string, title: string): Promise<boolean> {
  const { code } = await passCli(
    ["item", "view", "--vault-name", vault, "--item-title", title, "--output", "human"],
    { allowFail: true },
  );
  return code === 0;
}

async function main(): Promise<void> {
  const vault = argValue("vault") ?? DEFAULT_VAULT;
  const apply = hasFlag("apply");
  const update = hasFlag("update");
  const printUris = hasFlag("print-uris");
  const createVault = hasFlag("create-vault");
  const dryRun = !apply && !update;

  let scope: ReturnType<typeof resolveScope>;
  try {
    scope = resolveScope();
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  const { outId, envPrefix, title } = scope;
  const map = uris(vault, title, envPrefix);

  if (printUris) {
    console.log(
      JSON.stringify(
        {
          outId,
          envPrefix,
          vault,
          title,
          envUris: map,
        },
        null,
        2,
      ),
    );
    return;
  }

  // Session gate (never print secrets)
  const info = await passCli(["info"], { allowFail: true });
  if (info.code !== 0) {
    console.error("pass-cli session required. Run: pass-cli login");
    process.exit(1);
  }

  const presence = resolvePartnerEnv(envPrefix);
  const missing = DEFAULT_REQUIRED_ENV_KEYS.filter((k) => !presence.values[k]);

  console.log(
    JSON.stringify(
      {
        mode: update ? "update" : apply ? "apply" : "dry-run",
        outId,
        envPrefix,
        vault,
        title,
        createVault,
        keysPresent: PARTNER_ENV_KEYS.filter((k) => Boolean(presence.values[k])),
        keysMissing: missing,
        envUris: map,
        note:
          "partners vault Partner ASH/BIL/… is FactoryWager seat identity — not Ultra Live JWT. " +
          "login create has no --field; custom item template is SSOT for multi-field desk.",
      },
      null,
      2,
    ),
  );

  if (createVault && apply) {
    console.error(`Creating vault ${vault} …`);
    await passCli(["vault", "create", "--name", vault]);
    console.error("vault created");
  } else if (createVault && dryRun) {
    console.error(
      `[dry-run] would: pass-cli vault create --name ${JSON.stringify(vault)}`,
    );
  }

  const creds = loadCredsFromEnv(envPrefix);
  if (!creds) {
    console.error(
      [
        "",
        `Missing env for item body (prefix=${envPrefix}, values never logged):`,
        `  ${envPrefix}CUSTOMER_ID  ${envPrefix}AGENT_ID`,
        `  ${envPrefix}PASSWORD     ${envPrefix}BEARER_TOKEN`,
        "Fallback chain also accepts partner- or book-level keys.",
        "Optional: DESK_DOMAIN (legacy PARTNER_DOMAIN; or per-out *DOMAIN → SKINS host/SkinId) SKIN CURRENCY",
        "",
        "Export them in this shell (or paste from browser DevTools JWT), then re-run with --apply.",
        "Do not commit secrets. Prefer short-lived JWT + renewToken.",
        outId
          ? `Hint: bun run partner:vault:provision -- --out=${outId} --print-uris`
          : "Hint: bun run partner:vault:provision -- --print-uris",
      ].join("\n"),
    );
    if (dryRun) {
      console.error(
        "\n[dry-run] URI map above is ready for .env.protonpass once the item exists.",
      );
      process.exitCode = 0;
      return;
    }
    process.exit(1);
  }

  console.error(
    JSON.stringify(
      {
        credsPresent: {
          customerID: redact(creds.customerID),
          agentID: redact(creds.agentID),
          password: redact(creds.password),
          bearerToken: redact(creds.bearerToken),
          domain: creds.domain,
          skin: creds.skin,
          currency: creds.currency,
        },
      },
      null,
      2,
    ),
  );

  const exists = await itemExists(vault, title);
  console.error(
    `item ${JSON.stringify(title)} in ${JSON.stringify(vault)}: ${exists ? "exists" : "missing"}`,
  );

  if (dryRun) {
    console.error(
      "[dry-run] no write. Re-run with --apply (create) or --update (field patch).",
    );
    console.error(
      "After apply, append env URIs to .env.protonpass and run:\n" +
        `  bun run protonpass:run -- bun run partner:desk-smoke -- --out=${outId ?? "out-SPEN-1"} --login\n` +
        `  bun run protonpass:run -- bun run partner:test-fantasy -- --out=${outId ?? "out-SPEN-1"}\n` +
        "  LIVE_DESKTOP_URL from login(); then partner:ws-ingest -- --capture",
    );
    return;
  }

  if (update || exists) {
    if (!exists) {
      console.error("Cannot --update: item missing. Use --apply first.");
      process.exit(1);
    }
    const fields: Array<[string, string]> = [
      ["customerID", creds.customerID],
      ["agentID", creds.agentID],
      ["password", creds.password],
      ["bearerToken", creds.bearerToken],
      ["domain", creds.domain],
      ["skin", creds.skin],
      ["currency", creds.currency],
    ];
    const args = [
      "item",
      "update",
      "--vault-name",
      vault,
      "--item-title",
      title,
      ...fields.flatMap(([k, v]) => ["--field", `${k}=${v}`]),
    ];
    await passCli(args);
    console.error("updated fields on existing item");
  } else {
    const template = JSON.stringify(buildCustomTemplate(title, creds), null, 2);
    await passCli(
      ["item", "create", "custom", "--vault-name", vault, "--from-template", "-"],
      { stdin: template },
    );
    console.error("created custom item from template");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        outId,
        envPrefix,
        vault,
        title,
        next: [
          "Merge envUris into .env.protonpass",
          `bun run protonpass:run -- bun run partner:desk-smoke -- --out=${outId ?? "out-SPEN-1"} --login`,
          `bun run protonpass:run -- bun run partner:test-fantasy -- --out=${outId ?? "out-SPEN-1"}`,
          "export LIVE_DESKTOP_URL from login() desktop URL",
          "bun run partner:ws-ingest -- --capture --seconds=25",
        ],
        envUris: map,
      },
      null,
      2,
    ),
  );
}

await main();
