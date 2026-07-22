// @see https://docs.kalshi.com/getting_started/quick_start_websockets
// @see https://docs.kalshi.com/api-reference
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

export const KALSHI_WS_PATH = "/trade-api/ws/v2";

export type KalshiAccessHeaders = {
  "KALSHI-ACCESS-KEY": string;
  "KALSHI-ACCESS-SIGNATURE": string;
  "KALSHI-ACCESS-TIMESTAMP": string;
};

export type KalshiCredentials = {
  keyId: string;
  privateKey: KeyObject;
};

/** Load credentials from env. Throws with a clear message when missing. */
export function loadKalshiCredentials(
  env: Record<string, string | undefined> = Bun.env as Record<string, string | undefined>,
): KalshiCredentials {
  const keyId = (env.KALSHI_API_KEY_ID ?? env.KALSHI_ACCESS_KEY)?.trim();
  if (!keyId) {
    throw new Error("Missing KALSHI_API_KEY_ID (or KALSHI_ACCESS_KEY)");
  }
  const pemInline = env.KALSHI_PRIVATE_KEY?.trim();
  const pemPath = env.KALSHI_PRIVATE_KEY_PATH?.trim();
  let pem: string;
  if (pemInline) {
    pem = pemInline.includes("\\n") ? pemInline.replace(/\\n/g, "\n") : pemInline;
  } else if (pemPath) {
    pem = readFileSync(pemPath, "utf8");
  } else {
    throw new Error("Missing KALSHI_PRIVATE_KEY_PATH or KALSHI_PRIVATE_KEY");
  }
  return { keyId, privateKey: createPrivateKey(pem) };
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
 * WebSocket handshake: method GET, path `/trade-api/ws/v2`.
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
