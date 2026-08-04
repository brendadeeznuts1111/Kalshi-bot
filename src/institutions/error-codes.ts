/**
 * error-codes.ts — canonical error registry. Every API/UI error carries an
 * E_* code from this table; messages and tooltips live here, not inline.
 *
 * Kalshi wire errors arrive as { code, message, details, service } — map them
 * via fromKalshiStatus() and keep the upstream code in `upstream`.
 */

export type ErrorEntry = {
  /** HTTP status this API returns. */
  http: number;
  /** User-facing message (UI renders verbatim). */
  message: string;
  /** Longer explanation for tooltips/docs. */
  detail: string;
};

export const ERROR_CODES = {
  // ── Order entry validation (E1xx) ──
  E_TICKER_REQUIRED: { http: 400, message: "ticker is required", detail: "Kalshi market ticker, e.g. KXNBA-26JUL28BOSNYK-BOS." },
  E_SIDE_INVALID: { http: 400, message: "side must be 'yes' or 'no'", detail: "Kalshi contracts are binary: you buy yes or no." },
  E_COUNT_RANGE: { http: 400, message: "count must be an integer 1–10000", detail: "Fractional contracts (count_fp) are not orderable from HQ yet." },
  E_PRICE_RANGE: { http: 400, message: "priceCents must be an integer 1–99", detail: "Binary contract prices live in (0, 100) cents." },
  E_ORDER_ID_REQUIRED: { http: 400, message: "orderId is required", detail: "Cancel target — the exchange order_id, not client_order_id." },
  E_BODY_INVALID: { http: 400, message: "invalid JSON body", detail: "POST body must parse as JSON." },

  // ── Upstream / transport (E2xx) ──
  E_UPSTREAM: { http: 502, message: "Kalshi API request failed", detail: "Upstream returned an error or timed out; see `upstream` for its code." },
  E_NO_CREDS: { http: 503, message: "Kalshi credentials not configured", detail: "See .env.example / docs/PROTONPASS.md, then restart the server." },
  E_RATE_LIMITED: { http: 429, message: "rate limit exceeded", detail: "HQ endpoints allow 100 req/min per client; back off and retry." },

  // ── Compliance (E3xx) ──
  E_STATE_UNSUPPORTED: { http: 400, message: "state code not supported", detail: "Only whitelisted states may place wagers (currently MA, NJ)." },
  E_BET_BLOCKED: { http: 403, message: "wager blocked by compliance", detail: "State regulation cap or prohibition; logged as a violation." },

  // ── Data (E4xx) ──
  E_NOT_FOUND: { http: 404, message: "not found", detail: "Requested run/repo/resource does not exist." },
  E_STALE: { http: 409, message: "data stale", detail: "Section data is older than its cadence; refresh the source pipeline." },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export type CodedError = {
  ok: false;
  code: ErrorCode;
  error: string;
  upstream?: string;
};

export function codedError(code: ErrorCode, upstream?: string): CodedError {
  return { ok: false, code, error: ERROR_CODES[code].message, ...(upstream ? { upstream } : {}) };
}

export function httpStatusFor(code: ErrorCode): number {
  return ERROR_CODES[code].http;
}

/** Extract Kalshi's error code from a thrown client error message, if any. */
export function upstreamCodeFromMessage(message: string): string | undefined {
  const m = message.match(/\b(\d{3})\b/);
  return m ? `HTTP ${m[1]}` : undefined;
}
