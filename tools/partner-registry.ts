#!/usr/bin/env bun
/**
 * Partner / account registry status (capacity liquidity, not market depth).
 *
 *   bun run partner:registry -- --seed   # seed Fantasy402 out from env
 *   bun run partner:registry -- --json
 */
// @see https://bun.com/docs/runtime/sqlite
import { openEventStore } from "../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../src/institutions/event-store/paths.ts";
import {
  computeProviderCapacity,
  ensurePartnerRegistrySchema,
  listActiveBettingAccounts,
  seedFantasy402FromEnv,
} from "../src/partner/registry.ts";

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function main(): void {
  const db = openEventStore({ dbPath: DEFAULT_EVENT_STORE_DB });
  ensurePartnerRegistrySchema(db);

  if (hasFlag("seed")) {
    const acc = seedFantasy402FromEnv(db);
    if (!acc) {
      console.error(
        "seed failed: set FANTASY402_CUSTOMER_ID (and optional MAX_STAKE/MAX_WIN)",
      );
      process.exit(1);
    }
    console.error(`seeded account ${acc.id} provider=${acc.provider} maxStake=${acc.maxStake}`);
  }

  const accounts = listActiveBettingAccounts(db);
  const capacity = computeProviderCapacity(accounts);
  const payload = {
    accounts: accounts.map((a) => ({
      id: a.id,
      partnerId: a.partnerId,
      provider: a.provider,
      maxStake: a.maxStake,
      maxWin: a.maxWin,
      currency: a.currency,
      envPrefix: a.envPrefix,
      // no secrets
    })),
    capacityByProvider: capacity,
    notes: [
      "capacity = sum(maxStake) per provider — NOT market tradable",
      "Kalshi match_liquidity remains the priced-book desk gate",
      "Partner markets merge only after a real odds wire exists",
    ],
  };

  if (hasFlag("json")) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(
      `partner registry: ${accounts.length} active account(s)`,
    );
    for (const c of capacity) {
      console.log(
        `  ${c.provider}: accounts=${c.accountCount} capacity=${c.totalMaxStake} maxWinSum=${c.totalMaxWin} [${c.accountIds.join(", ")}]`,
      );
    }
    for (const n of payload.notes) console.log(`  · ${n}`);
  }
}

main();
