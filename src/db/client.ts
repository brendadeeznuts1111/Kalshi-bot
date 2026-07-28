// @see https://orm.drizzle.team/docs/get-started-sqlite#bun-sqlite
/**
 * Drizzle ORM client over the existing bun:sqlite event-store.
 *
 * Lazy — no connection until first query.
 * Backward compatible — raw SQL via `db.getDatabase().query(...)` still works.
 */
import { drizzle } from "drizzle-orm/bun-sqlite";
import { openEventStore } from "../institutions/event-store/open-db.ts";
import * as schema from "./schema.ts";

let _client: ReturnType<typeof drizzle<typeof schema>> | null = null;

/** Get or create the Drizzle client over the default event-store DB. */
export function getDrizzleClient() {
  if (!_client) {
    const sqlite = openEventStore();
    _client = drizzle(sqlite, { schema });
  }
  return _client;
}

/** Reset cached client (for tests that swap DBs). */
export function resetDrizzleClient(): void {
  _client = null;
}

/** Convenience export — direct Drizzle client for the default DB. */
export const db = getDrizzleClient();

// Re-export schema for convenience
export { schema };
