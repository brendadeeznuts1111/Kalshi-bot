/**
 * rate-limit.ts — Bun-native token-bucket rate limiter.
 *
 * Tracks requests per key (IP, user, or node) in an in-memory Map.
 * When the bucket is exhausted, returns 429 Too Many Requests.
 *
 * Usage:
 *   const limiter = createRateLimiter({ windowMs: 60_000, max: 100 });
 *   const response = await limiter(req, () => handler(req));
 */

import { HEADER, HTTP_STATUS, RATE_LIMIT, CONTENT_TYPE } from "../constants";

interface RateLimitEntry {
  tokens: number;
  lastRefill: number;
}

export interface RateLimitOptions {
  windowMs: number;   // refill window in ms
  max: number;        // max tokens per window
  keyGenerator?: (req: Request) => string;
  skipSuccessful?: boolean; // don't count 2xx/3xx responses against limit
}

export function createRateLimiter(options: RateLimitOptions) {
  const store = new Map<string, RateLimitEntry>();
  const { windowMs, max, keyGenerator, skipSuccessful } = options;

  function getKey(req: Request): string {
    if (keyGenerator) return keyGenerator(req);
    // Default: IP from headers or fallback
    const forwarded = req.headers.get(HEADER.X_FORWARDED_FOR);
    if (forwarded) return forwarded.split(",")[0].trim();
    return req.headers.get(HEADER.X_REAL_IP) ?? RATE_LIMIT.FALLBACK_IP;
  }

  function consume(key: string): { allowed: boolean; remaining: number; resetTime: number } {
    const now = Date.now();
    const entry = store.get(key);

    if (!entry) {
      store.set(key, { tokens: max - 1, lastRefill: now });
      return { allowed: true, remaining: max - 1, resetTime: now + windowMs };
    }

    // Refill tokens based on elapsed time
    const elapsed = now - entry.lastRefill;
    const tokensToAdd = Math.floor((elapsed / windowMs) * max);
    entry.tokens = Math.min(max, entry.tokens + tokensToAdd);
    entry.lastRefill = now;

    if (entry.tokens > 0) {
      entry.tokens--;
      return { allowed: true, remaining: entry.tokens, resetTime: now + windowMs };
    }

    return { allowed: false, remaining: 0, resetTime: entry.lastRefill + windowMs };
  }

  return async (
    req: Request,
    next: () => Response | Promise<Response>,
  ): Promise<Response> => {
    const key = getKey(req);
    const result = consume(key);

    if (!result.allowed) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded. Try again later." }),
        {
          status: HTTP_STATUS.TOO_MANY_REQUESTS,
          headers: {
            "Content-Type": CONTENT_TYPE.JSON,
            [HEADER.X_RATE_LIMIT_LIMIT]: String(max),
            [HEADER.X_RATE_LIMIT_REMAINING]: "0",
            [HEADER.X_RATE_LIMIT_RESET]: String(Math.ceil(result.resetTime / 1000)),
            [HEADER.RETRY_AFTER]: String(Math.ceil((result.resetTime - Date.now()) / 1000)),
          },
        },
      );
    }

    const response = await next();

    // Optionally skip counting successful responses
    if (skipSuccessful && response.status < 400) {
      const entry = store.get(key);
      if (entry) entry.tokens++;
    }

    // Attach rate-limit headers to response
    const newResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    newResponse.headers.set(HEADER.X_RATE_LIMIT_LIMIT, String(max));
    newResponse.headers.set(HEADER.X_RATE_LIMIT_REMAINING, String(result.remaining));
    newResponse.headers.set(HEADER.X_RATE_LIMIT_RESET, String(Math.ceil(result.resetTime / 1000)));
    return newResponse;
  };
}
