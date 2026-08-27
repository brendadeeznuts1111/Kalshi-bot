/**
 * validate.ts — odds-registry validation: the >=34 capacity floor gate + shape.
 *
 * 34 is the MINIMUM capacity (floor), not a cap: the config and adapters are
 * N-generic; the gate only refuses a config that cannot meet the floor.
 */
import type { OddsRegistryConfig } from "./types.ts";

export interface OddsRegistryValidation {
  ok: boolean;
  errors: string[];
  bookmakerCount: number;
  sports: string[];
  feeds: string[];
}

const KNOWN_FEEDS = new Set(["odds-api-v3", "fonbet-ws", "bun-xml"]);

export function validateOddsRegistry(cfg: OddsRegistryConfig): OddsRegistryValidation {
  const errors: string[] = [];
  const keys = new Set<string>();
  const sports = new Set<string>();
  const feeds = new Set<string>();

  // Capacity floor gate: >= 34 bookmakers (minimum capacity).
  if (cfg.bookmakers.length < cfg.capacityFloor) {
    errors.push(`capacity floor ${cfg.capacityFloor}: found ${cfg.bookmakers.length} bookmakers`);
  }

  for (const bk of cfg.bookmakers) {
    if (!bk.key || !bk.name) errors.push(`bookmaker missing key/name: ${bk.key || "(blank)"}`);
    if (keys.has(bk.key)) errors.push(`duplicate bookmaker key: ${bk.key}`);
    keys.add(bk.key);
    if (!KNOWN_FEEDS.has(bk.feed)) errors.push(`unknown feed "${bk.feed}" on ${bk.key}`);
    feeds.add(bk.feed);
    if (bk.sports.length === 0) errors.push(`bookmaker ${bk.key} declares no sports`);
    for (const s of bk.sports) sports.add(s);
    if (bk.feed === "bun-xml" && !bk.endpoint) errors.push(`bun-xml bookmaker ${bk.key} needs endpoint`);
  }

  return { ok: errors.length === 0, errors, bookmakerCount: cfg.bookmakers.length, sports: [...sports], feeds: [...feeds] };
}

