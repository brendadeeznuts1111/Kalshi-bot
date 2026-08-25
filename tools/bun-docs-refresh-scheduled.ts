#!/usr/bin/env bun
// @see https://bun.com/docs/runtime/cron#the-scheduled-handler
/**
 * OS-level cron worker — refresh the Bun docs cache + maps.toml triple-lock
 * weekly. Self-healing: on a Bun bump the lock hash fails, the indexer
 * re-runs against the new runtime ref, maps.toml is regenerated, and
 * INDEX.json mapsHash is updated — so docs always track the runtime.
 *
 * Register: bun run docs:refresh:register
 * Manual:   bun run docs:refresh
 *
 * Env:
 *   BUN_DOCS_REFRESH_SKIP_NETWORK=1 — check-only (offline gate; a lock
 *     mismatch throws so the cron job surfaces it)
 */
import { syncDocsLock } from "../src/lib/maps-lock.ts";

process.on("unhandledRejection", (err) => {
  console.error("[docs-refresh] unhandled rejection:", err);
});

process.on("uncaughtException", (err) => {
  console.error("[docs-refresh] uncaught exception:", err);
});

export default {
  async scheduled(controller: Bun.CronController) {
    const when = new Date(controller.scheduledTime).toISOString();
    console.error(`[docs-refresh] fire ${controller.cron} @ ${when}`);

    const skipNetwork = Bun.env.BUN_DOCS_REFRESH_SKIP_NETWORK === "1";
    try {
      const r = await syncDocsLock({ skipNetwork });
      if (!r.ok) {
        throw new Error("maps-lock mismatch (check-only mode): " + r.reasons.join("; "));
      }
      const lockState = r.regenerated ? "REGENERATED" : r.lockOk ? "ok" : "healed";
      console.error(`[docs-refresh] ok · maps-lock ${lockState} ${r.hash} · Bun ${r.bunVersion} · ${r.pages} pages${skipNetwork ? " (check-only)" : ""}`);
    } catch (err) {
      console.error("[docs-refresh] failed:", err);
      throw err;
    }
  },
};
