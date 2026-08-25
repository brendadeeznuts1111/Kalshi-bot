#!/usr/bin/env bun
/**
 * code-search:prime — warm the global code-search cache (global_code_cache)
 * for a dimension ahead of `bun run research`. Paced (9/min token bucket,
 * §128) so a full prime is ~3-4 min; once primed, research runs cost ZERO
 * code_search calls for the fetch (attribution is local, §129).
 *
 *   bun run code-search:prime                     # default dimension
 *   bun run code-search:prime -- --dimension=sports-nba
 */
import { loadConfig } from "../src/research/discover.ts";
import { asDimensionId, DEFAULT_DIMENSION } from "../src/research/dimensions.ts";
import { primeGlobalCodeSearch, GLOBAL_CODE_CACHE_TTL_MS } from "../src/research/global-code-search.ts";
import { countGlobalCodeCache } from "../src/research/cache.ts";
import { readGitHubRateLimit } from "../src/research/github-rate-limit.ts";

const dimensionArg = Bun.argv.find((a) => a.startsWith("--dimension="))?.split("=")[1];
const dimension = dimensionArg ? asDimensionId(dimensionArg) : DEFAULT_DIMENSION;
const config = await loadConfig();
const queries = [...new Set([...config.keywords.authCodeSearch, ...config.keywords.orderCodeSearch])];

console.log("code-search:prime — dimension=" + dimension + " · " + queries.length + " global keywords · TTL " + Math.round(GLOBAL_CODE_CACHE_TTL_MS / 3_600_000) + "h");
const before = countGlobalCodeCache();
const res = await primeGlobalCodeSearch(queries);
const budget = await readGitHubRateLimit("code_search");
console.log(`primed: ${res.primed}/${res.total} keywords on disk (was ${before}) · ${(res.elapsedMs / 1000).toFixed(0)}s`);
console.log(`code_search budget: ${budget?.remaining ?? "?"}/${budget?.limit ?? "?"} remaining`);
console.log("next: bun run research -- --dimension=" + dimension + " (zero code_search for the global fetch)");
process.exit(res.primed >= queries.length ? 0 : 2);
