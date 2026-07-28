/**
 * Ensure a scoped Proton Pass PAT session for Kalshi Bot (Projects agent-env pattern).
 *
 * Loads `PROTON_PASS_KALSHI_BOT_TOKEN` from env or `~/Projects/.env.pass-tokens`,
 * isolates session under `/tmp/pass-agent-kalshi-bot`, and runs `pass-cli login`.
 *
 * @see https://protonpass.github.io/pass-cli/commands/login/
 * @see https://protonpass.github.io/pass-cli/commands/personal-access-token/
 * @see docs/PROTONPASS.md
 */
import { join } from "node:path";
import { homedir } from "node:os";
import { createLogger } from "./logger.ts";
import { spawnWithTimeout } from "./timeout.ts";

const log = createLogger({ prefix: "agent-session" });

export const KALSHI_SESSION_DIR = "/tmp/pass-agent-kalshi-bot";
export const KALSHI_TOKEN_ENV = "PROTON_PASS_KALSHI_BOT_TOKEN";
export const PASS_TOKENS_FILE = join(homedir(), "Projects", ".env.pass-tokens");

export type AgentSessionResult = {
  ok: boolean;
  mode: "pat" | "existing" | "missing-token" | "login-failed";
  sessionDir: string;
  detail: string;
};

/** Parse a KEY=value / KEY='value' line from .env.pass-tokens (no shell eval). */
function parseEnvAssignment(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const eq = trimmed.indexOf("=");
  if (eq <= 0) return null;
  const key = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1).trim();
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

export async function loadKalshiBotToken(): Promise<string | undefined> {
  const fromEnv = Bun.env[KALSHI_TOKEN_ENV]?.trim() || Bun.env.PROTON_PASS_PERSONAL_ACCESS_TOKEN?.trim();
  if (fromEnv?.startsWith("pst_")) return fromEnv;

  const file = Bun.file(PASS_TOKENS_FILE);
  if (!(await file.exists())) return undefined;

  const text = await file.text();
  for (const line of text.split("\n")) {
    const parsed = parseEnvAssignment(line);
    if (parsed?.key === KALSHI_TOKEN_ENV && parsed.value.startsWith("pst_")) {
      return parsed.value;
    }
  }
  return undefined;
}

async function passInfoOk(passCli: string): Promise<boolean> {
  const r = await spawnWithTimeout(passCli, ["info"], { timeoutMs: 8_000 });
  if (r.timedOut || r.code !== 0) return false;
  const out = `${r.stdout}\n${r.stderr}`;
  return out.includes("Personal Access Token") || out.includes("Username:") || out.includes("Email:");
}

async function forceResetSession(passCli: string): Promise<void> {
  await spawnWithTimeout(passCli, ["logout", "--force"], { timeoutMs: 8_000 });
  // Clear on-disk session dir — corrupted DB is a common failure mode
  try {
    const { rm } = await import("node:fs/promises");
    await rm(KALSHI_SESSION_DIR, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
  await Bun.write(join(KALSHI_SESSION_DIR, ".keep"), "");
}

/**
 * Apply Projects-style env for Kalshi agent session and login with PAT when available.
 * Falls back to whatever session is already active if no Kalshi PAT is registered yet.
 */
function applySessionEnv(token?: string): void {
  // Child spawns read process.env; keep Bun.env in sync for in-process readers.
  process.env.PROTON_PASS_KEY_PROVIDER = "fs";
  process.env.PROTON_PASS_SESSION_DIR = KALSHI_SESSION_DIR;
  Bun.env.PROTON_PASS_KEY_PROVIDER = "fs";
  Bun.env.PROTON_PASS_SESSION_DIR = KALSHI_SESSION_DIR;
  if (token) {
    process.env.PROTON_PASS_PERSONAL_ACCESS_TOKEN = token;
    Bun.env.PROTON_PASS_PERSONAL_ACCESS_TOKEN = token;
  }
}

export async function ensureKalshiAgentSession(passCli: string): Promise<AgentSessionResult> {
  applySessionEnv();

  const token = await loadKalshiBotToken();
  if (!token) {
    log.warn("No Kalshi Bot PAT — using ambient pass-cli session if any", {
      expect: KALSHI_TOKEN_ENV,
      file: PASS_TOKENS_FILE,
    });
    const ambient = await passInfoOk(passCli);
    return {
      ok: ambient,
      mode: ambient ? "existing" : "missing-token",
      sessionDir: KALSHI_SESSION_DIR,
      detail: ambient
        ? "No PROTON_PASS_KALSHI_BOT_TOKEN; ambient session is active"
        : `Missing ${KALSHI_TOKEN_ENV}. Mint + grant (main account), then add to ${PASS_TOKENS_FILE}`,
    };
  }

  applySessionEnv(token);

  // Warm or repair session
  if (await passInfoOk(passCli)) {
    log.info("Kalshi PAT session already active", { sessionDir: KALSHI_SESSION_DIR });
    return {
      ok: true,
      mode: "pat",
      sessionDir: KALSHI_SESSION_DIR,
      detail: "PAT session active",
    };
  }

  log.info("Logging in with Kalshi Bot PAT", { sessionDir: KALSHI_SESSION_DIR });
  let login = await spawnWithTimeout(passCli, ["login"], {
    timeoutMs: 20_000,
    env: {
      ...Bun.env,
      PROTON_PASS_PERSONAL_ACCESS_TOKEN: token,
      PROTON_PASS_KEY_PROVIDER: "fs",
      PROTON_PASS_SESSION_DIR: KALSHI_SESSION_DIR,
    },
  });

  // Corrupted local DB → force reset + retry once
  const errBlob = `${login.stderr}\n${login.stdout}`;
  if (
    login.code !== 0 &&
    (errBlob.includes("not a database") || errBlob.includes("encryption key"))
  ) {
    log.warn("Session DB corrupt — force logout + retry");
    await forceResetSession(passCli);
    login = await spawnWithTimeout(passCli, ["login"], {
      timeoutMs: 20_000,
      env: {
        ...Bun.env,
        PROTON_PASS_PERSONAL_ACCESS_TOKEN: token,
        PROTON_PASS_KEY_PROVIDER: "fs",
        PROTON_PASS_SESSION_DIR: KALSHI_SESSION_DIR,
      },
    });
  }

  const ok = (await passInfoOk(passCli)) || login.stdout.includes("Successfully logged in");
  if (!ok) {
    log.error("PAT login failed", { stderr: login.stderr.slice(0, 200) });
    return {
      ok: false,
      mode: "login-failed",
      sessionDir: KALSHI_SESSION_DIR,
      detail: login.stderr.trim() || login.stdout.trim() || "pass-cli login failed",
    };
  }

  return {
    ok: true,
    mode: "pat",
    sessionDir: KALSHI_SESSION_DIR,
    detail: "Logged in with PROTON_PASS_KALSHI_BOT_TOKEN",
  };
}
