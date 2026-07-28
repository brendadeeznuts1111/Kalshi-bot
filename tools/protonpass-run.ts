#!/usr/bin/env bun
/**
 * ProtonPass wrapper — inject secrets from vault before running commands.
 *
 * Usage:
 *   bun tools/protonpass-run.ts -- bun run research
 *   bun tools/protonpass-run.ts --env-check
 *   bun tools/protonpass-run.ts --env-file=./env-protonpass.template -- bun run rate-limit:status
 *
 * @see docs/PROTONPASS.md
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";

const DEFAULT_ENV_FILE = ".env.protonpass";
const PASS_CLI_CANDIDATES = [
  join(homedir(), ".local", "bin", "pass-cli"),
  "/opt/homebrew/bin/pass-cli",
  "/usr/local/bin/pass-cli",
  "pass-cli",
];

async function findPassCli(): Promise<string | null> {
  for (const candidate of PASS_CLI_CANDIDATES) {
    if (candidate.startsWith("/") || candidate.startsWith(homedir())) {
      if (await Bun.file(candidate).exists()) return candidate;
      continue;
    }
    try {
      const proc = Bun.spawn(["which", candidate], { stdout: "pipe", stderr: "pipe" });
      const out = await Bun.readableStreamToText(proc.stdout);
      if (proc.exitCode === 0 && out.trim()) return out.trim();
    } catch { /* ignore */ }
  }
  return null;
}

function arg(name: string): string | undefined {
  return Bun.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function hasFlag(name: string): boolean {
  return Bun.argv.includes(`--${name}`);
}

async function checkEnvFile(path: string): Promise<{ ok: boolean; lines: number; uris: string[] }> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return { ok: false, lines: 0, uris: [] };
  }
  const text = await file.text();
  const uris: string[] = [];
  let lines = 0;
  for (const line of text.split("\n")) {
    lines++;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.includes("pass://")) {
      const uri = trimmed.split("=")[1]?.trim();
      if (uri) uris.push(uri);
    }
  }
  return { ok: true, lines, uris };
}

async function runEnvCheck(passCli: string, envFile: string): Promise<void> {
  console.log("=== ProtonPass environment check ===\n");
  console.log(`pass-cli binary: ${passCli}`);

  const sessionProc = Bun.spawn([passCli, "vault", "list"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const sessionOut = await Bun.readableStreamToText(sessionProc.stdout);
  const sessionErr = await Bun.readableStreamToText(sessionProc.stderr);

  if (sessionProc.exitCode !== 0 || sessionErr.includes("login")) {
    console.log("❌ Session: NOT logged in");
    console.log("   Run: pass-cli login");
  } else {
    const vaults = sessionOut
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("-"));
    console.log(`✅ Session: active (${vaults.length} vault(s) accessible)`);
    for (const v of vaults) {
      console.log(`   • ${v}`);
    }
  }

  const envCheck = await checkEnvFile(envFile);
  if (!envCheck.ok) {
    console.log(`\n❌ Env file: ${envFile} not found`);
    console.log(`   Copy template: cp env-protonpass.template ${envFile}`);
  } else {
    console.log(`\n✅ Env file: ${envFile} (${envCheck.lines} lines, ${envCheck.uris.length} pass:// URI(s))`);
    for (const uri of envCheck.uris) {
      console.log(`   • ${uri}`);
    }
  }

  if (envCheck.uris.length > 0 && sessionProc.exitCode === 0) {
    const firstUri = envCheck.uris[0];
    console.log(`\n🔍 Testing resolution: ${firstUri}`);
    const testProc = Bun.spawn([passCli, "item", "view", "--output", "json", firstUri], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const testOut = await Bun.readableStreamToText(testProc.stdout);
    const testErr = await Bun.readableStreamToText(testProc.stderr);
    if (testProc.exitCode === 0 && testOut.trim()) {
      console.log("   ✅ Resolved (value masked in logs)");
    } else {
      console.log(`   ❌ Failed: ${testErr.trim() || "no output"}`);
    }
  }

  console.log("\n=== End check ===");
}

async function main(): Promise<void> {
  const passCli = await findPassCli();
  const envFile = arg("env-file") ?? DEFAULT_ENV_FILE;

  if (hasFlag("env-check")) {
    if (!passCli) {
      console.error("❌ pass-cli not found. Install: curl -fsSL https://proton.me/download/pass-cli/install.sh | bash");
      process.exit(1);
    }
    await runEnvCheck(passCli, envFile);
    return;
  }

  const separatorIndex = Bun.argv.indexOf("--");
  if (separatorIndex === -1 || separatorIndex === Bun.argv.length - 1) {
    console.error(
      "Usage: bun tools/protonpass-run.ts [--env-file=path] [--env-check] -- <command> [args...]",
    );
    console.error("");
    console.error("Examples:");
    console.error("  bun tools/protonpass-run.ts -- bun run rate-limit:status");
    console.error("  bun tools/protonpass-run.ts --env-file=.env.protonpass -- bun run research");
    console.error("  bun tools/protonpass-run.ts --env-check");
    process.exit(1);
  }

  const realCommand = Bun.argv.slice(separatorIndex + 1);
  if (realCommand.length === 0) {
    console.error("Error: no command after --");
    process.exit(1);
  }

  if (!passCli) {
    console.error("❌ pass-cli not found on PATH.");
    console.error("   Install: curl -fsSL https://proton.me/download/pass-cli/install.sh | bash");
    console.error("   Or: brew install protonpass/pass-cli/pass-cli");
    console.error("");
    console.error("   Then authenticate: pass-cli login");
    process.exit(1);
  }

  const envFilePath = await Bun.file(envFile).exists()
    ? envFile
    : await Bun.file("env-protonpass.template").exists()
      ? "env-protonpass.template"
      : null;

  if (!envFilePath) {
    console.error(`❌ No ProtonPass env file found (${envFile}).`);
    console.error("   Copy template: cp env-protonpass.template .env.protonpass");
    process.exit(1);
  }

  const args = ["run", "--env-file", envFilePath, "--", ...realCommand];

  console.log(`🔐 ProtonPass → ${realCommand.join(" ")}`);

  const proc = spawn(passCli, args, {
    stdio: "inherit",
    cwd: process.cwd(),
  });

  proc.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
