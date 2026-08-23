// @see https://docs.kalshi.com/getting_started/quick_start_websockets
// @see https://docs.kalshi.com/api-reference
// @see https://bun.com/docs/runtime/environment-variables
/**
 * Kalshi API key RSA-PSS signing for REST + WebSocket handshake.
 * Env: KALSHI_API_KEY_ID (or KALSHI_ACCESS_KEY) + KALSHI_PRIVATE_KEY_PATH | KALSHI_PRIVATE_KEY.
 */
import {
  constants as cryptoConstants,
  createPrivateKey,
  sign,
  type KeyObject,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { DEFAULT_SECRET_SERVICE, getSecret } from "../lib/secrets.ts";
import { OFFICIAL_URLS } from "../institutions/official-urls.ts";

const KALSHI_WS_URL = new URL(OFFICIAL_URLS.kalshi.tradeApiWsV2);
export const KALSHI_WS_PATH = KALSHI_WS_URL.pathname;

export type KalshiAccessHeaders = {
  "KALSHI-ACCESS-KEY": string;
  "KALSHI-ACCESS-SIGNATURE": string;
  "KALSHI-ACCESS-TIMESTAMP": string;
};

export type KalshiCredentials = {
  keyId: string;
  privateKey: KeyObject;
};

/** OS-keychain credential names under service com.kalshi-bot — see `bun run kalshi:secrets`. */
export const KALSHI_KEY_ID_SECRET = "kalshi-api-key-id";
export const KALSHI_KEY_SECRET = "kalshi-private-key";

/**
 * Load credentials: env/file first (explicit, fresh), then the OS keychain
 * fallback set via `bun run kalshi:secrets store`. Async because Bun.secrets
 * is async-only; the keychain read degrades silently when unavailable.
 *
 * opts.keychain: false (used by per-account resolvers) forces env-only —
 * account-scoped clients must never pick up a machine-global key.
 * opts.service overrides the keychain service namespace (default
 * com.kalshi-bot) — used to verify round-trips against a test service
 * without touching production credentials.
 */
export async function loadKalshiCredentials(
  env: Record<string, string | undefined> = Bun.env as Record<string, string | undefined>,
  opts: { keychain?: boolean; service?: string } = {},
): Promise<KalshiCredentials> {
  const keyId = (env.KALSHI_API_KEY_ID ?? env.KALSHI_ACCESS_KEY)?.trim();
  const pemInline = env.KALSHI_PRIVATE_KEY?.trim();
  const pemPath = env.KALSHI_PRIVATE_KEY_PATH?.trim();
  let pem: string | null = null;
  if (pemInline) {
    pem = pemInline.includes("\\n") ? pemInline.replace(/\\n/g, "\n") : pemInline;
  } else if (pemPath) {
    pem = readFileSync(pemPath, "utf8");
  }
  if (keyId && pem) {
    return { keyId, privateKey: createPrivateKey(pem) };
  }
  if (opts.keychain !== false) {
    const service = opts.service ?? DEFAULT_SECRET_SERVICE;
    const vaultKeyId = await getSecret({
      service,
      name: KALSHI_KEY_ID_SECRET,
    });
    const vaultPem = await getSecret({
      service,
      name: KALSHI_KEY_SECRET,
    });
    if (vaultKeyId && vaultPem) {
      return { keyId: vaultKeyId, privateKey: createPrivateKey(vaultPem) };
    }
  }
  if (!keyId) {
    throw new Error("Missing KALSHI_API_KEY_ID (or KALSHI_ACCESS_KEY)");
  }
  throw new Error("Missing KALSHI_PRIVATE_KEY_PATH or KALSHI_PRIVATE_KEY");
}

/** RSA-PSS SHA-256, salt = digest length — Kalshi API key signing. */
export function signKalshiPss(privateKey: KeyObject, message: string): string {
  const sig = sign("sha256", Buffer.from(message, "utf8"), {
    key: privateKey,
    padding: cryptoConstants.RSA_PKCS1_PSS_PADDING,
    saltLength: cryptoConstants.RSA_PSS_SALTLEN_DIGEST,
  });
  return sig.toString("base64");
}

/**
 * Build access headers for method+path (path without query).
 * WebSocket handshake: method GET, path from OFFICIAL_URLS.kalshi.tradeApiWsV2.
 */
export function kalshiAccessHeaders(
  creds: KalshiCredentials,
  method: string,
  path: string,
  nowMs: number = Date.now(),
): KalshiAccessHeaders {
  const timestamp = String(nowMs);
  const pathOnly = path.split("?")[0] ?? path;
  const payload = `${timestamp}${method.toUpperCase()}${pathOnly}`;
  return {
    "KALSHI-ACCESS-KEY": creds.keyId,
    "KALSHI-ACCESS-TIMESTAMP": timestamp,
    "KALSHI-ACCESS-SIGNATURE": signKalshiPss(creds.privateKey, payload),
  };
}

export function kalshiWsAccessHeaders(
  creds: KalshiCredentials,
  nowMs: number = Date.now(),
): KalshiAccessHeaders {
  return kalshiAccessHeaders(creds, "GET", KALSHI_WS_PATH, nowMs);
}

export type KalshiAuthProbe = {
  ok: boolean;
  status: number;
  endpoint: string;
};

/**
 * Pre-flight auth probe — signed GET to an authenticated REST endpoint
 * (portfolio/balance) before opening a WebSocket. Lets callers classify a
 * bad key as E_AUTH immediately instead of burning WS retries that surface
 * only as "Expected 101 status code" (E_HANDSHAKE/E_NET).
 */
export async function probeKalshiAuth(
  creds: KalshiCredentials,
  opts?: { base?: string; timeoutMs?: number },
): Promise<KalshiAuthProbe> {
  const env = Bun.env as Record<string, string | undefined>;
  const base = (
    opts?.base?.trim() ||
    env.KALSHI_API_BASE?.trim() ||
    (env.KALSHI_ENV === "demo"
      ? OFFICIAL_URLS.kalshi.tradeApiV2BaseDemo
      : OFFICIAL_URLS.kalshi.tradeApiV2Base)
  ).replace(/\/$/, "");
  const path = "/portfolio/balance";
  const endpoint = `${base}${path}`;
  // Kalshi signs the full request path (host excluded).
  const signPath = `${new URL(endpoint).pathname}`;
  const headers = kalshiAccessHeaders(creds, "GET", signPath);
  const res = await fetch(endpoint, {
    headers: { ...headers, accept: "application/json" },
    signal: AbortSignal.timeout(opts?.timeoutMs ?? 3000),
  });
  return { ok: res.ok, status: res.status, endpoint };
}
