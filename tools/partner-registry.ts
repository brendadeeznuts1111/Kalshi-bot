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
import { argValue, hasFlag } from '../src/cli/argv.ts';
// @see https://bun.com/docs/runtime/sqlite
import { openEventStore } from '../src/institutions/event-store/open-db.ts';
import { DEFAULT_EVENT_STORE_DB } from '../src/institutions/event-store/paths.ts';
import {
  computeProviderCapacity,
  ensurePartnerRegistrySchema,
  listActiveBettingAccounts,
  listEligibleOutCapacityPairs,
  seedFantasy402FromEnv,
  seedFantasySportMappings,
} from '../src/partner/registry.ts';
import { parseOutMeta } from '../src/partner/out-capacity.ts';
import { colorizePartnerText, getPartnerVisual } from '../src/partner/visuals.ts';



function main(): void {
  const db = openEventStore({ dbPath: DEFAULT_EVENT_STORE_DB });
  ensurePartnerRegistrySchema(db);

  if (hasFlag('seed')) {
    const sportsN = seedFantasySportMappings(db);
    console.error(`seeded ${sportsN} fantasy402 sport mappings`);
    const acc = seedFantasy402FromEnv(db);
    if (!acc) {
      console.error(
        'account seed skipped: set FANTASY402_CUSTOMER_ID (and optional MAX_STAKE/MAX_WIN or LIVE_PRODUCTS_JSON)'
      );
    } else {
      console.error(
        `seeded out ${acc.id} provider=${acc.provider} maxStake=${acc.maxStake} (see meta.liveProducts for matrix)`
      );
    }
  }

  const accounts = listActiveBettingAccounts(db);
  const capacity = computeProviderCapacity(accounts);
  const stakeProbe = Number(argValue('stake') ?? '0') || 0;
  const eligible = stakeProbe > 0 ? listEligibleOutCapacityPairs(accounts, stakeProbe) : [];

  const payload = {
    accounts: accounts.map(a => {
      const cap = capacity.flatMap(c => c.outs).find(o => o.outId === a.id);
      return {
        id: a.id,
        partnerId: a.partnerId,
        provider: a.provider,
        skinId: a.skinId ?? null,
        bookId: a.bookId ?? null,
        maxStake: a.maxStake,
        maxWin: a.maxWin,
        currency: a.currency,
        envPrefix: a.envPrefix,
        liveProducts: cap?.liveProducts ?? [],
        totalPerBetMax: cap?.totalPerBetMax ?? a.maxStake,
        workingBalance: cap?.workingBalance ?? null,
        // no secrets
      };
    }),
    capacityByProvider: capacity.map(c => ({
      provider: c.provider,
      outCount: c.accountCount,
      capacityPairCount: c.capacityPairCount,
      totalMaxStake: c.totalMaxStake,
      totalMaxWin: c.totalMaxWin,
      accountIds: c.accountIds,
      outs: c.outs.map(o => ({
        outId: o.outId,
        totalPerBetMax: o.totalPerBetMax,
        totalMaxWin: o.totalMaxWin,
        workingBalance: o.workingBalance,
        liveProducts: o.liveProducts.map(s => ({
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
            pairs: eligible.map(p => ({
              key: p.key,
              outId: p.outId,
              liveProduct: p.liveProduct,
              perBetMax: p.perBetMax,
              workingBalance: p.workingBalance,
            })),
          },
        }
      : {}),
    notes: [
      'capacity = sum(perBetMax) across active live products of active outs — NOT market tradable',
      'liquidity key = {outId}@{liveProduct}; concentration groups by outId across live products',
      'vault credentials are per-out; live product is login payload + limits only',
      'Kalshi match_liquidity remains the priced-book desk gate',
    ],
  };

  if (hasFlag('json')) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`partner registry: ${accounts.length} active out(s)`);
    for (const c of capacity) {
      console.log(
        `${c.provider}: $${c.totalMaxStake} total capacity  (outs=${c.accountCount} capacityPairs=${c.capacityPairCount})`
      );
      for (const o of c.outs) {
        const acc = accounts.find(a => a.id === o.outId);
        const meta = parseOutMeta(acc?.metaJson ?? '{}');
        const code =
          (typeof meta.partnerCode === 'string' && meta.partnerCode) ||
          o.outId.replace(/^out-/, '').split('-')[0] ||
          o.outId;
        const vis = getPartnerVisual(String(code));
        const label = colorizePartnerText(String(code), o.outId);
        const skinBits = o.liveProducts.map(s => `$${s.perBetMax} ${s.name}`).join(' + ');
        const bookBit = acc?.bookId ? ` book=${acc.bookId}` : '';
        console.log(
          `  └── ${label} ${vis.hex}: $${o.totalPerBetMax}${skinBits ? ` (${skinBits})` : ''}${bookBit}`
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
