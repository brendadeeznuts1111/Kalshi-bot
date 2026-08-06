#!/usr/bin/env bun
/**
 * Partner / account registry status (capacity liquidity, not market depth).
 *
 * Capacity is an (out × skin) matrix — vertical total = sum of active skins'
 * perBetMax across outs. Concentration groups by out, not by skin.
 *
 *   bun run partner:registry -- --seed
 *   bun run partner:registry -- --json
 *   bun run partner:capacity              # alias
 *   bun run partner:capacity -- --json
 */
// @see https://bun.com/docs/runtime/sqlite
import { openEventStore } from "../src/institutions/event-store/open-db.ts";
import { DEFAULT_EVENT_STORE_DB } from "../src/institutions/event-store/paths.ts";
import {
  computeProviderCapacity,
  ensurePartnerRegistrySchema,
  listActiveBettingAccounts,
  listEligibleOutSkinPairs,
  seedFantasy402FromEnv,
  seedFantasySportMappings,
} from "../src/partner/registry.ts";
import { parseOutMeta } from "../src/partner/skins.ts";
import { colorizePartnerText, getPartnerVisual } from "../src/partner/visuals.ts";

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function main(): void {
  const db = openEventStore({ dbPath: DEFAULT_EVENT_STORE_DB });
  ensurePartnerRegistrySchema(db);

  if (hasFlag("seed")) {
    const sportsN = seedFantasySportMappings(db);
    console.error(`seeded ${sportsN} fantasy402 sport mappings`);
    const acc = seedFantasy402FromEnv(db);
    if (!acc) {
      console.error(
        "account seed skipped: set FANTASY402_CUSTOMER_ID (and optional MAX_STAKE/MAX_WIN or SKINS_JSON)",
      );
    } else {
      console.error(
        `seeded out ${acc.id} provider=${acc.provider} maxStake=${acc.maxStake} (see meta.skins for matrix)`,
      );
    }
  }

  const accounts = listActiveBettingAccounts(db);
  const capacity = computeProviderCapacity(accounts);
  const stakeProbe = Number(argValue("stake") ?? "0") || 0;
  const eligible =
    stakeProbe > 0
      ? listEligibleOutSkinPairs(accounts, stakeProbe)
      : [];

  const payload = {
    accounts: accounts.map((a) => {
      const cap = capacity
        .flatMap((c) => c.outs)
        .find((o) => o.outId === a.id);
      return {
        id: a.id,
        partnerId: a.partnerId,
        provider: a.provider,
        maxStake: a.maxStake,
        maxWin: a.maxWin,
        currency: a.currency,
        envPrefix: a.envPrefix,
        skins: cap?.skins ?? [],
        totalPerBetMax: cap?.totalPerBetMax ?? a.maxStake,
        workingBalance: cap?.workingBalance ?? null,
        // no secrets
      };
    }),
    capacityByProvider: capacity.map((c) => ({
      provider: c.provider,
      outCount: c.accountCount,
      skinPairCount: c.skinPairCount,
      totalMaxStake: c.totalMaxStake,
      totalMaxWin: c.totalMaxWin,
      accountIds: c.accountIds,
      outs: c.outs.map((o) => ({
        outId: o.outId,
        totalPerBetMax: o.totalPerBetMax,
        totalMaxWin: o.totalMaxWin,
        workingBalance: o.workingBalance,
        skins: o.skins.map((s) => ({
          name: s.name,
          perBetMax: s.perBetMax,
          maxWin: s.maxWin,
          key: `${o.outId}@${s.name}`,
        })),
      })),
    })),
    ...(stakeProbe > 0
      ? {
          eligibleForStake: {
            stake: stakeProbe,
            pairs: eligible.map((p) => ({
              key: p.key,
              outId: p.outId,
              skin: p.skin,
              perBetMax: p.perBetMax,
              workingBalance: p.workingBalance,
            })),
          },
        }
      : {}),
    notes: [
      "capacity = sum(perBetMax) across active skins of active outs — NOT market tradable",
      "liquidity key = {outId}@{skin}; concentration groups by outId across skins",
      "vault credentials are per-out; skin is login payload + limits only",
      "Kalshi match_liquidity remains the priced-book desk gate",
    ],
  };

  if (hasFlag("json")) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`partner registry: ${accounts.length} active out(s)`);
    for (const c of capacity) {
      console.log(
        `${c.provider}: $${c.totalMaxStake} total capacity  (outs=${c.accountCount} skinPairs=${c.skinPairCount})`,
      );
      for (const o of c.outs) {
        const meta = parseOutMeta(
          accounts.find((a) => a.id === o.outId)?.metaJson ?? "{}",
        );
        const code =
          (typeof meta.partnerCode === "string" && meta.partnerCode) ||
          o.outId.replace(/^out-/, "").split("-")[0] ||
          o.outId;
        const vis = getPartnerVisual(String(code));
        const label = colorizePartnerText(String(code), o.outId);
        const skinBits = o.skins
          .map((s) => `$${s.perBetMax} ${s.name}`)
          .join(" + ");
        console.log(
          `  └── ${label} ${vis.hex}: $${o.totalPerBetMax}${skinBits ? ` (${skinBits})` : ""}`,
        );
      }
    }
    if (stakeProbe > 0) {
      console.log(`eligible for stake=$${stakeProbe}: ${eligible.length} pair(s)`);
      for (const p of eligible.slice(0, 20)) {
        console.log(`  · ${p.key}  perBetMax=$${p.perBetMax}`);
      }
    }
    for (const n of payload.notes) console.log(`  · ${n}`);
  }
}

main();
