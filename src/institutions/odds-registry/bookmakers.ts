/**
 * bookmakers.ts — the bookmaker profile store.
 *
 * Venues quoting an odds feed are BOOKMAKERS, not events: they carry their
 * own identity (display name, feed, region, book URL, logo). Profiles come
 * from the registry config (config/odds-registry.xml, parsed with Bun.XML by
 * load.ts) — `url` / `logo` ride in the per-book <meta> blob:
 *
 *   <bookmaker key="bet365" name="Bet365" feed="odds-api-v3">
 *     <meta><url>https://www.bet365.com</url><logo>/assets/bet365.png</logo></meta>
 *   </bookmaker>
 *
 * A venue in the wire that the registry does not declare resolves to an
 * UNREGISTERED profile (key + wire title only) instead of being dropped or
 * masquerading as a registered book — feeds quoting unknown books stay
 * visible in reports with provenance honest.
 */
import type { OddsEvent } from "../../alpha/odds-types.ts";
import type { OddsFeedType, OddsRegistryConfig } from "./types.ts";

export type BookmakerProfile = {
  /** Slug key (registry key, or wire venue slug when unregistered). */
  key: string;
  /** Display name (registry name, or wire title when unregistered). */
  name: string;
  feed?: OddsFeedType;
  region?: string;
  /** Book homepage URL — registry <meta><url>. */
  url?: string;
  /** Logo asset URL/path — registry <meta><logo>. */
  logo?: string;
  /** False when the venue quoted the wire without a registry declaration. */
  registered: boolean;
};

const REGISTRY_META_KEYS = {
  url: ["url", "book-url", "homepage"],
  logo: ["logo", "logo-url"],
} as const;

function firstMeta(meta: Record<string, string>, keys: readonly string[]): string | undefined {
  for (const k of keys) {
    const v = meta[k];
    if (typeof v === "string" && v.trim() !== "") return v;
  }
  return undefined;
}

/**
 * Resolve one bookmaker profile from the registry. Never undefined: an
 * unregistered wire venue returns a minimal profile with `registered: false`.
 */
export function bookmakerProfile(
  config: Pick<OddsRegistryConfig, "bookmakers">,
  key: string,
  wireTitle?: string,
): BookmakerProfile {
  const declared = config.bookmakers.find((b) => b.key === key);
  if (declared) {
    const url = firstMeta(declared.meta, REGISTRY_META_KEYS.url);
    const logo = firstMeta(declared.meta, REGISTRY_META_KEYS.logo);
    return {
      key: declared.key,
      name: declared.name,
      feed: declared.feed,
      ...(declared.region !== undefined ? { region: declared.region } : {}),
      ...(url !== undefined ? { url } : {}),
      ...(logo !== undefined ? { logo } : {}),
      registered: true,
    };
  }
  return { key, name: wireTitle && wireTitle.trim() !== "" ? wireTitle : key, registered: false };
}

/**
 * Profiles for every bookmaker quoting the given events, in first-seen wire
 * order, deduped by key. Unregistered venues resolve via bookmakerProfile.
 */
export function booksQuoting(
  config: Pick<OddsRegistryConfig, "bookmakers">,
  events: OddsEvent[],
): BookmakerProfile[] {
  const seen = new Map<string, BookmakerProfile>();
  for (const ev of events) {
    for (const bk of ev.bookmakers) {
      if (!seen.has(bk.key)) {
        seen.set(bk.key, bookmakerProfile(config, bk.key, bk.title));
      }
    }
  }
  return [...seen.values()];
}
