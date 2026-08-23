#!/usr/bin/env bun
/**
 * Gate for the destructive schema apply (db:push -> bunx drizzle-kit push).
 *
 * Requires an interactive YES confirm (or --yes / DB_PUSH_YES=1 for scripts),
 * with a 60s timeout that aborts safely (never hangs unattended runs).
 *
 *   bun run db:push                # confirm then apply
 *   bun run db:push -- --yes       # skip the prompt
 *   DB_PUSH_YES=1 bun run db:push
 */
import { confirmYes } from "../src/lib/readline.ts";

const args = Bun.argv.slice(2).filter((a) => a !== "--yes");
const skip = Bun.argv.includes("--yes") || Bun.env.DB_PUSH_YES === "1";

if (!skip) {
  const ok = await confirmYes("Apply schema changes to the database? (db:push)", {
    timeoutMs: 60_000,
  });
  if (!ok) {
    console.error("db:push aborted - no changes applied");
    process.exit(1);
  }
}

const proc = Bun.spawn(["bunx", "drizzle-kit", "push", ...args]);
process.exit(await proc.exited);
