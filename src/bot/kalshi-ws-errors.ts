// @see https://docs.kalshi.com/getting_started/quick_start_websockets#error-handling
import type { KalshiWsWire } from "./kalshi-ws.ts";

/** Official Kalshi WebSocket error codes (docs table; 23–24 not assigned). */
export type KalshiWsErrorCode =
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15
  | 16
  | 17
  | 18
  | 19
  | 20
  | 21
  | 22
  | 25;

export type KalshiWsServerError = {
  code: KalshiWsErrorCode;
  message: string;
  /** false for server-side errors (10, 17, 18) per Kalshi docs. */
  userError: boolean;
};

export const KALSHI_WS_ERROR_LABELS: Record<KalshiWsErrorCode, string> = {
  1: "Unable to process message",
  2: "Params required",
  3: "Channels required",
  4: "Subscription IDs required",
  5: "Unknown command",
  6: "Already subscribed",
  7: "Unknown subscription ID",
  8: "Unknown channel name",
  9: "Authentication required",
  10: "Channel error",
  11: "Invalid parameter",
  12: "Exactly one subscription ID is required",
  13: "Unsupported action",
  14: "Market Ticker required",
  15: "Action required",
  16: "Market not found",
  17: "Internal error",
  18: "Command timeout",
  19: "shard_factor must be > 0",
  20: "shard_factor is required when shard_key is set",
  21: "shard_key must be >= 0 and < shard_factor",
  22: "shard_factor must be <= 100",
  25: "Subscription buffer overflow",
};

const SERVER_SIDE_CODES = new Set<KalshiWsErrorCode>([10, 17, 18]);

const KNOWN_CODES = new Set<number>(Object.keys(KALSHI_WS_ERROR_LABELS).map(Number));

export function isKalshiWsUserError(code: KalshiWsErrorCode): boolean {
  return !SERVER_SIDE_CODES.has(code);
}

/** Kalshi wire errors that should tear down the session and reconnect. */
export function shouldReconnectKalshiWsError(code: KalshiWsErrorCode): boolean {
  return code === 9 || code === 17 || code === 25;
}

function isKalshiWsErrorCode(n: number): n is KalshiWsErrorCode {
  return KNOWN_CODES.has(n);
}

/** Parse `{ type: "error", msg: { code, msg } }` frames; null when not a known server error. */
export function parseKalshiWsErrorWire(wire: KalshiWsWire): KalshiWsServerError | null {
  if (wire.type !== "error") return null;
  const msg = wire.msg;
  if (!msg || typeof msg !== "object") return null;
  const codeRaw = msg.code;
  if (typeof codeRaw !== "number" || !Number.isInteger(codeRaw) || !isKalshiWsErrorCode(codeRaw)) {
    return null;
  }
  const message =
    typeof msg.msg === "string" && msg.msg.length > 0
      ? msg.msg
      : KALSHI_WS_ERROR_LABELS[codeRaw];
  return {
    code: codeRaw,
    message,
    userError: isKalshiWsUserError(codeRaw),
  };
}
