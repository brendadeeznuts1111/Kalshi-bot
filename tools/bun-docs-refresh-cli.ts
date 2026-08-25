#!/usr/bin/env bun
/**
 * docs:refresh — refresh + gate the local Bun docs cache AND the maps.toml
 * triple-lock (maps.toml + bun-types + Bun.version + docs tag ref) in one
 * command. Self-healing: when the lock hash fails (e.g. Bun bumped), the
 * indexer is re-run against the actual runtime ref, maps.toml is regenerated
 * from the indexed surface, and INDEX.json mapsHash is updated.
 *
 *   bun run docs:refresh                          # index --scope all, gate, lock
 *   BUN_DOCS_REFRESH_SKIP_NETWORK=1 bun run docs:refresh  # offline: gate + lock check only
 *
 * Exits 1 when the index/gate fails, or when a check-only run finds a lock
 * mismatch (safe to call from scripts/CI; the network run self-heals).
 */
import { syncDocsLock } from "../src/lib/maps-lock.ts";

const skipNetwork = Bun.env.BUN_DOCS_REFRESH_SKIP_NETWORK === "1";

const r = await syncDocsLock({ skipNetwork });
if (!r.ok) {
  console.error("[docs:refresh] maps-lock mismatch in check-only mode - run without BUN_DOCS_REFRESH_SKIP_NETWORK to self-heal");
  process.exit(1);
}
const lockState = r.regenerated ? "REGENERATED" : r.lockOk ? "ok" : "healed";
console.log(`[docs:refresh] ok · maps-lock ${lockState} ${r.hash} · Bun ${r.bunVersion} · ${r.pages} pages${skipNetwork ? " (check-only)" : ""}`);
