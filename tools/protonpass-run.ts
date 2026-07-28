#!/usr/bin/env bun
/**
 * ProtonPass wrapper v2 — Bun-native capabilities:
 *   • Parallel secret fetch (Promise.allSettled)
 *   • Secret caching with TTL (Bun.file + Bun.write)
 *   • Retry with exponential backoff (Bun.sleep)
 *   • Command timeout (Promise.race + proc.kill)
 *   • Structured logging (Bun.inspect)
 *   • Secret health score (Bun.inspect.table)
 *   • SSH temp file (Bun.write + chmod)
 *   • CLI discovery (Bun.which)
 *   • Telemetry timing (Bun.nanoseconds)
 *   • Subprocess execution (Bun.spawn)
 *
 * Usage:
 *   bun tools/protonpass-run.ts -- bun run research
 *   bun tools/protonpass-run.ts --env-check
 *   bun tools/protonpass-run.ts --health-check
 *   bun tools/protonpass-run.ts --cache-ttl=900 -- bun run rate-limit:status
 *
 * @see docs/PROTONPASS.md
 */
import { join } from "node:path";
import { homedir } from "node:os";
import {
  createLogger,
  SecretCacheManager,
  fetchSecretsParallel,
  auditSecretHealth,
  printHealthTable,
  spawnWithTimeout,
  writePemTemp,
  type SecretFetchResult,
} from "../src/protonpass/index.ts";

const DEFAULT_ENV_FILE = ".env.protonpass";
const DEFAULT_CACHE_TTL_MS = 15 * 60_000; // 15 minutes
const PASS_CLI_CANDIDATES = [
  join(homedir(), ".local", "bin", "pass-cli"),
  "/opt/homebrew/bin/pass-cli",
  "/usr/local/bin/pass-cli",
  "pass-cli",
];

const log = createLogger({ prefix: "protonpass", mode: "pretty" });

async function findPassCli(): Promise<string | null> {
  // Bun.which() is native — no subprocess, no PATH parsing
  const whichResult = Bun.which("pass-cli");
  if (whichResult) return whichResult;

  // Fallback: check known installation paths
  for (const candidate of PASS_CLI_CANDIDATES) {
    if (await Bun.file(candidate).exists()) return candidate;
  }
  return null;
}

function arg(name: string): string | undefined {
  return Bun.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function hasFlag(name: string): boolean {
  return Bun.argv.includes(`--${name}`);
}

function argNumber(name: string, fallback: number): number {
  const raw = arg(name);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
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

async function runEnvCheck(passCli: string, envFile: string, cache: SecretCacheManager): Promise<void> {
  log.info("Starting environment check");

  // Session check with timeout
  const sessionResult = await spawnWithTimeout(passCli, ["vault", "list"], { timeoutMs: 10_000 });

  if (sessionResult.timedOut || sessionResult.code !== 0 || sessionResult.stderr.includes("login")) {
    log.error("Session not logged in", { timedOut: sessionResult.timedOut });
    console.log("❌ Session: NOT logged in");
    console.log("   Run: pass-cli login");
  } else {
    const vaults = sessionResult.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("-"));
    log.info("Session active", { vaultCount: vaults.length });
    console.log(`✅ Session: active (${vaults.length} vault(s) accessible)`);
    for (const v of vaults) {
      console.log(`   • ${v}`);
    }
  }

  // Env file check
  const envCheck = await checkEnvFile(envFile);
  if (!envCheck.ok) {
    log.warn("Env file not found", { path: envFile });
    console.log(`\n❌ Env file: ${envFile} not found`);
    console.log(`   Copy template: cp env-protonpass.template ${envFile}`);
  } else {
    log.info("Env file found", { lines: envCheck.lines, uris: envCheck.uris.length });
    console.log(`\n✅ Env file: ${envFile} (${envCheck.lines} lines, ${envCheck.uris.length} pass:// URI(s))`);
    for (const uri of envCheck.uris) {
      console.log(`   • ${uri}`);
    }
  }

  // Cache status
  const { purged, remaining } = await cache.purgeExpired();
  if (purged > 0) {
    log.info("Purged expired cache entries", { purged, remaining });
  }
  console.log(`\n💾 Cache: ${remaining} valid entr${remaining === 1 ? "y" : "ies"} (${purged} expired purged)`);

  // URI resolution test (parallel fetch first secret)
  if (envCheck.uris.length > 0 && sessionResult.code === 0) {
    const firstUri = envCheck.uris[0];
    console.log(`\n🔍 Testing parallel resolution of ${envCheck.uris.length} URI(s)...`);
    const startNs = Bun.nanoseconds();
    const results = await fetchSecretsParallel(envCheck.uris, {
      passCli,
      cache,
      timeoutMs: 15_000,
      retry: { maxAttempts: 2, baseMs: 500, jitter: true },
      logger: log,
    });
    const duration = Math.round((Bun.nanoseconds() - startNs) / 1_000_000);

    const ok = results.filter((r) => r.status === "ok").length;
    const cached = results.filter((r) => r.fromCache).length;

    console.log(`\n✅ Parallel fetch complete in ${duration}ms (${ok}/${results.length} OK, ${cached} from cache)`);

    for (const r of results) {
      const icon = r.status === "ok" ? "✅" : "❌";
      const cacheBadge = r.fromCache ? " [cached]" : "";
      console.log(`   ${icon} ${r.uri}${cacheBadge} (${r.durationMs}ms)`);
      if (r.error) {
        console.log(`      Error: ${r.error.slice(0, 80)}`);
      }
    }
  }

  console.log("\n=== End check ===");
}

async function runHealthCheck(passCli: string, envFile: string, cache: SecretCacheManager): Promise<void> {
  const envCheck = await checkEnvFile(envFile);
  if (!envCheck.ok || envCheck.uris.length === 0) {
    log.error("No env file or URIs found", { path: envFile });
    process.exit(1);
  }

  log.info("Starting health audit", { uriCount: envCheck.uris.length });
  const score = await auditSecretHealth({
    passCli,
    uris: envCheck.uris,
    cache,
  });

  printHealthTable(score);

  process.exit(score.errors > 0 ? 1 : 0);
}

/** Resolve all pass:// URIs from env file, write a resolved .env file, handle PEM temp files. */
async function resolveEnvFile(
  envFile: string,
  passCli: string,
  cache: SecretCacheManager,
): Promise<{ resolvedPath: string; tempPemPaths: string[] }> {
  const envCheck = await checkEnvFile(envFile);
  if (!envCheck.ok) {
    throw new Error(`Env file not found: ${envFile}`);
  }

  log.info("Resolving secrets", { uriCount: envCheck.uris.length });

  const results = await fetchSecretsParallel(envCheck.uris, {
    passCli,
    cache,
    timeoutMs: 15_000,
    retry: { maxAttempts: 2, baseMs: 500, jitter: true },
    logger: log,
  });

  const tempPemPaths: string[] = [];
  const lines: string[] = [];

  // Read original env file to preserve comments and non-secret lines
  const originalText = await Bun.file(envFile).text();
  const uriResults = new Map(results.map((r) => [r.uri, r]));

  for (const line of originalText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      lines.push(line);
      continue;
    }

    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) {
      lines.push(line);
      continue;
    }

    const key = line.slice(0, eqIdx).trim();
    const uri = line.slice(eqIdx + 1).trim();

    if (!uri.startsWith("pass://")) {
      lines.push(line); // non-secret line, preserve as-is
      continue;
    }

    const result = uriResults.get(uri);
    if (!result || result.status !== "ok" || result.value == null) {
      log.error("Failed to resolve secret", { key, uri, error: result?.error });
      lines.push(`# FAILED: ${key}=${uri}`);
      lines.push(`# Error: ${result?.error ?? "unknown"}`);
      continue;
    }

    let value = result.value;

    // Auto-detect PEM and write to temp file for KALSHI_PRIVATE_KEY
    if (key === "KALSHI_PRIVATE_KEY" && value.includes("BEGIN ")) {
      log.info("PEM key detected — writing to secure temp file", { key });
      const temp = await writePemTemp(value, { prefix: "kalshi-bot-key-" });
      value = temp.path;
      tempPemPaths.push(temp.path);
      log.info("PEM temp file created", { path: temp.path });
      // Also set KALSHI_PRIVATE_KEY_PATH
      lines.push(`${key}=${value}`);
      lines.push(`KALSHI_PRIVATE_KEY_PATH=${value}`);
      continue;
    }

    lines.push(`${key}=${value}`);
  }

  // Write resolved env to temp file
  const resolvedPath = join(homedir(), ".cache", "kalshi-bot", `.env.resolved-${Date.now()}`);
  await Bun.write(resolvedPath, lines.join("\n") + "\n");
  log.info("Resolved env written", { path: resolvedPath, secrets: results.filter((r) => r.status === "ok").length });

  return { resolvedPath, tempPemPaths };
}

async function main(): Promise<void> {
  const passCli = await findPassCli();
  const envFile = arg("env-file") ?? DEFAULT_ENV_FILE;
  const cacheTtlMs = argNumber("cache-ttl", DEFAULT_CACHE_TTL_MS);
  const cache = new SecretCacheManager({ defaultTtlMs: cacheTtlMs });

  // --env-check
  if (hasFlag("env-check")) {
    if (!passCli) {
      log.error("pass-cli not found");
      console.error("❌ pass-cli not found. Install: curl -fsSL https://proton.me/download/pass-cli/install.sh | bash");
      process.exit(1);
    }
    await runEnvCheck(passCli, envFile, cache);
    return;
  }

  // --health-check
  if (hasFlag("health-check")) {
    if (!passCli) {
      log.error("pass-cli not found");
      process.exit(1);
    }
    await runHealthCheck(passCli, envFile, cache);
    return;
  }

  // Normal mode: find -- separator, resolve secrets, run command
  const separatorIndex = Bun.argv.indexOf("--");
  if (separatorIndex === -1 || separatorIndex === Bun.argv.length - 1) {
    console.error("Usage: bun tools/protonpass-run.ts [options] -- <command> [args...]");
    console.error("");
    console.error("Options:");
    console.error("  --env-file=PATH      Env file with pass:// URIs (default: .env.protonpass)");
    console.error("  --cache-ttl=SECONDS  Cache TTL in seconds (default: 900 = 15min)");
    console.error("  --env-check          Verify session, env file, and resolve all URIs");
    console.error("  --health-check       Audit all secrets for accessibility and speed");
    console.error("");
    console.error("Examples:");
    console.error("  bun tools/protonpass-run.ts -- bun run rate-limit:status");
    console.error("  bun tools/protonpass-run.ts --cache-ttl=3600 -- bun run research");
    console.error("  bun tools/protonpass-run.ts --env-check");
    console.error("  bun tools/protonpass-run.ts --health-check");
    process.exit(1);
  }

  const realCommand = Bun.argv.slice(separatorIndex + 1);
  if (realCommand.length === 0) {
    console.error("Error: no command after --");
    process.exit(1);
  }

  if (!passCli) {
    log.error("pass-cli not found on PATH");
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
    log.error("No env file found", { searched: envFile });
    console.error(`❌ No ProtonPass env file found (${envFile}).`);
    console.error("   Copy template: cp env-protonpass.template .env.protonpass");
    process.exit(1);
  }

  // Resolve secrets (parallel fetch + cache + retry + PEM temp files)
  const { resolvedPath, tempPemPaths } = await resolveEnvFile(envFilePath, passCli, cache);

  log.info("Running command with resolved secrets", { command: realCommand.join(" ") });
  console.log(`🔐 ProtonPass → ${realCommand.join(" ")}`);

  const proc = Bun.spawn([passCli, "run", "--env-file", resolvedPath, "--", ...realCommand], {
    stdio: "inherit",
    cwd: process.cwd(),
  });

  const code = await proc.exited;

  // Cleanup temp PEM files
  for (const pemPath of tempPemPaths) {
    try {
      await Bun.file(pemPath).delete();
      log.debug("Cleaned up temp PEM", { path: pemPath });
    } catch {
      // Best effort
    }
  }
  process.exit(code);
}

main().catch((err) => {
  log.error("Fatal error", { message: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
