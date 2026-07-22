// @see https://bun.com/docs/runtime/networking/dns
// @see https://bun.com/docs/runtime/networking/fetch#preconnect-to-a-host
/**
 * One-time DNS + TLS warmup before a burst of Kalshi public API traffic
 * (milestones + live_data + markets). Mirrors github-network.ts — no npm.
 */
import { dns } from "bun";
import { OFFICIAL_URLS } from "../institutions/official-urls.ts";

function resolveKalshiOrigin(): { host: string; origin: string } {
  const base =
    Bun.env.KALSHI_API_BASE?.trim().replace(/\/$/, "") ||
    OFFICIAL_URLS.kalshi.tradeApiV2Base;
  try {
    const u = new URL(base.includes("://") ? base : `https://${base}`);
    return { host: u.hostname, origin: u.origin };
  } catch {
    return { host: "external-api.kalshi.com", origin: "https://external-api.kalshi.com" };
  }
}

let networkWarmed = false;

/** Prefetch DNS + preconnect TLS for Kalshi trade-api (optional / best-effort). */
export function warmKalshiApiNetwork(): void {
  if (networkWarmed) return;
  networkWarmed = true;
  const { host, origin } = resolveKalshiOrigin();
  try {
    dns.prefetch(host);
  } catch {
    /* optional */
  }
  try {
    fetch.preconnect(origin);
  } catch {
    /* optional — not available on all platforms */
  }
}

/** Reset for tests. */
export function resetKalshiNetworkWarmup(): void {
  networkWarmed = false;
}

export function kalshiNetworkWarmed(): boolean {
  return networkWarmed;
}
