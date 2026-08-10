// @see https://bun.com/docs/runtime/sqlite
/**
 * Partners (financial entities) → Betting accounts (outs) → Providers (adapters).
 *
 * Capacity is an (out × skin) matrix:
 *   - out = account (shared workingBalance + vault credentials)
 *   - skin = live interface (ezlive / dark / "2") with its own perBetMax
 * Vertical capacity = sum of active skins' perBetMax across active outs.
 * That is NOT market tradable until the provider offers a priced line.
 * Secrets stay in env / vault — never persist password or bearer JWT.
 */
import type { Database } from 'bun:sqlite';
import type { BookId, SkinId } from '../domain/index.ts';
import {
  listLiveProductSportBindings,
  liveProductsWithBindings,
  resolveDeskDomainFromEnv,
} from '../domain/index.ts';
import {
  guardAndStampAccountMeta,
  parseOutIdentity,
  type AdapterId,
  type OutIdentity,
} from './out-identity.ts';
import {
  bookIdFromAccount,
  buildOutCapacityMeta,
  mapperFromAccount,
  outCapacityFromAccount,
  parseLiveProductWire,
  skinIdFromAccount,
  type OutCapacity,
  type OutCapacityRow,
  type OutMapperKind,
} from './out-capacity.ts';

export type ProviderId = 'fantasy402' | 'kalshi' | (string & {});

export type PartnerEntity = {
  id: string;
  name: string;
  active: boolean;
  profitSplit: number | null;
  commissionRate: number | null;
  notes: string | null;
};

export type BettingAccountRow = {
  id: string;
  partnerId: string;
  provider: ProviderId;
  url: string;
  status: 'active' | 'inactive' | 'pending';
  /** Env var prefix for secrets, e.g. FANTASY402_ */
  envPrefix: string | null;
  /**
   * Legacy single-row ceiling (max over liveProducts when present;
   * used when capacity meta is empty as the sole perBetMax).
   */
  maxStake: number;
  maxWin: number;
  currency: string;
  /**
   * Legacy SQLite column (nullable). Writers always stamp `null`;
   * capacity lives in meta.liveProducts[]. Still dual-read for old rows.
   */
  skin: number | null;
  /** Non-secret meta only (liveProducts, workingBalance, vaultId, skinId, bookId) */
  metaJson: string;
  /**
   * White-label SkinId from meta_json (stamped on write).
   * Not a DB column — derived for callers.
   */
  skinId?: SkinId;
  /**
   * Desk BookId from meta_json / host (stamped on write).
   * Not a DB column — derived for callers.
   */
  bookId?: BookId;
  /** Mapper kind from meta_json (fantasy402 | unmapped). */
  mapper?: OutMapperKind;
  /** Adapter id from OutIdentity (fantasy-ultra | kalshi | unmapped). */
  adapterId?: AdapterId;
};

export type ProviderCapacity = {
  provider: ProviderId;
  /** Distinct outs (betting_accounts rows) */
  accountCount: number;
  /** Active (out, live-product) pairs contributing capacity */
  capacityPairCount: number;
  /** Sum of perBetMax across all active live products of all outs */
  totalMaxStake: number;
  totalMaxWin: number;
  accountIds: string[];
  /** Per-out breakdown (live products summed) */
  outs: OutCapacity[];
};

/** Ensure partners + betting_accounts tables exist. */
export function ensurePartnerRegistrySchema(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS partners (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    profit_split REAL,
    commission_rate REAL,
    notes TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS betting_accounts (
    id TEXT PRIMARY KEY,
    partner_id TEXT NOT NULL REFERENCES partners(id),
    provider TEXT NOT NULL,
    url TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    env_prefix TEXT,
    max_stake REAL NOT NULL DEFAULT 0,
    max_win REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'USD',
    skin INTEGER,
    meta_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_betting_accounts_partner ON betting_accounts (partner_id)`
  );
  db.run(`CREATE INDEX IF NOT EXISTS idx_betting_accounts_provider ON betting_accounts (provider)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_betting_accounts_status ON betting_accounts (status)`);
  db.run(`CREATE TABLE IF NOT EXISTS provider_sport_mappings (
    provider TEXT NOT NULL,
    canonical TEXT NOT NULL,
    stream_bucket TEXT,
    api_sport_id INTEGER,
    widget_sport_id INTEGER,
    label TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (provider, canonical)
  )`);
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_provider_sport_api ON provider_sport_mappings (provider, api_sport_id)`
  );
}

/**
 * Seed sport id maps from domain live-product bindings.
 * Primary keys = live products with bindings (plive, ezlive, …).
 * Optional legacy dual-write under `fantasy402` (not the sport owner).
 */
export function seedFantasySportMappings(
  db: Database,
  options?: { includeLegacyFantasy402?: boolean }
): number {
  ensurePartnerRegistrySchema(db);
  const upsert = db.query(`
    INSERT INTO provider_sport_mappings (
      provider, canonical, stream_bucket, api_sport_id, widget_sport_id, label
    ) VALUES ($provider, $canonical, $stream, $api, $widget, $label)
    ON CONFLICT(provider, canonical) DO UPDATE SET
      stream_bucket = excluded.stream_bucket,
      api_sport_id = excluded.api_sport_id,
      widget_sport_id = excluded.widget_sport_id,
      label = excluded.label
  `);
  let n = 0;
  // Live-product keys are primary; fantasy402 dual-write is legacy-only.
  const includeLegacy = options?.includeLegacyFantasy402 !== false;
  const providerKeys = [
    ...liveProductsWithBindings(),
    ...(includeLegacy ? (['fantasy402'] as const) : []),
  ];
  const bindings = listLiveProductSportBindings('plive');
  for (const provider of providerKeys) {
    for (const m of bindings) {
      upsert.run({
        $provider: provider,
        $canonical: m.sportId,
        $stream: m.inventoryBucket,
        $api: m.apiSportId,
        $widget: m.widgetSportId,
        $label: m.label,
      });
      n++;
    }
  }
  return n;
}

export function upsertPartner(
  db: Database,
  partner: Omit<PartnerEntity, 'active'> & { active?: boolean },
  nowMs = Date.now()
): void {
  db.query(
    `INSERT INTO partners (id, name, active, profit_split, commission_rate, notes, created_at, updated_at)
     VALUES ($id, $name, $active, $ps, $cr, $notes, $now, $now)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       active = excluded.active,
       profit_split = excluded.profit_split,
       commission_rate = excluded.commission_rate,
       notes = excluded.notes,
       updated_at = excluded.updated_at`
  ).run({
    $id: partner.id,
    $name: partner.name,
    $active: partner.active === false ? 0 : 1,
    $ps: partner.profitSplit,
    $cr: partner.commissionRate,
    $notes: partner.notes,
    $now: nowMs,
  });
}

export function upsertBettingAccount(
  db: Database,
  account: BettingAccountRow,
  nowMs = Date.now()
): void {
  const requireHost = Boolean(account.url.trim()) || account.provider === 'fantasy402';
  const guarded = guardAndStampAccountMeta({
    id: account.id,
    partnerId: account.partnerId,
    url: account.url,
    provider: account.provider,
    maxStake: account.maxStake,
    maxWin: account.maxWin,
    skin: account.skin,
    metaJson: account.metaJson,
    status: account.status,
    requireHost,
  });
  const metaJson = guarded.metaJson;

  db.query(
    `INSERT INTO betting_accounts (
       id, partner_id, provider, url, status, env_prefix,
       max_stake, max_win, currency, skin, meta_json, created_at, updated_at
     ) VALUES (
       $id, $partner_id, $provider, $url, $status, $env_prefix,
       $max_stake, $max_win, $currency, $skin, $meta_json, $now, $now
     )
     ON CONFLICT(id) DO UPDATE SET
       partner_id = excluded.partner_id,
       provider = excluded.provider,
       url = excluded.url,
       status = excluded.status,
       env_prefix = excluded.env_prefix,
       max_stake = excluded.max_stake,
       max_win = excluded.max_win,
       currency = excluded.currency,
       skin = excluded.skin,
       meta_json = excluded.meta_json,
       updated_at = excluded.updated_at`
  ).run({
    $id: account.id,
    $partner_id: account.partnerId,
    $provider: account.provider,
    $url: account.url,
    $status: account.status,
    $env_prefix: account.envPrefix,
    $max_stake: account.maxStake,
    $max_win: account.maxWin,
    $currency: account.currency,
    $skin: account.skin,
    $meta_json: metaJson,
    $now: nowMs,
  });
}

export function listActiveBettingAccounts(db: Database): BettingAccountRow[] {
  const rows = db
    .query(
      `SELECT id, partner_id AS partnerId, provider, url, status, env_prefix AS envPrefix,
              max_stake AS maxStake, max_win AS maxWin, currency, skin, meta_json AS metaJson
       FROM betting_accounts WHERE status = 'active'`
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map(mapAccountRow);
}

/** Lookup one out by id (active or not). */
export function getBettingAccountById(db: Database, id: string): BettingAccountRow | null {
  const row = db
    .query(
      `SELECT id, partner_id AS partnerId, provider, url, status, env_prefix AS envPrefix,
              max_stake AS maxStake, max_win AS maxWin, currency, skin, meta_json AS metaJson
       FROM betting_accounts WHERE id = $id`
    )
    .get({ $id: id }) as Record<string, unknown> | null;
  return row ? mapAccountRow(row) : null;
}

export function listBettingAccountsByProvider(db: Database, provider: string): BettingAccountRow[] {
  const rows = db
    .query(
      `SELECT id, partner_id AS partnerId, provider, url, status, env_prefix AS envPrefix,
              max_stake AS maxStake, max_win AS maxWin, currency, skin, meta_json AS metaJson
       FROM betting_accounts WHERE provider = $p AND status = 'active'`
    )
    .all({ $p: provider }) as Array<Record<string, unknown>>;
  return rows.map(mapAccountRow);
}

function mapAccountRow(r: Record<string, unknown>): BettingAccountRow {
  const metaJson = String(r.metaJson ?? '{}');
  const base = {
    id: String(r.id),
    partnerId: String(r.partnerId),
    provider: String(r.provider) as ProviderId,
    url: String(r.url ?? ''),
    status: String(r.status ?? 'active') as BettingAccountRow['status'],
    envPrefix: r.envPrefix != null ? String(r.envPrefix) : null,
    maxStake: Number(r.maxStake) || 0,
    maxWin: Number(r.maxWin) || 0,
    currency: String(r.currency ?? 'USD'),
    skin: r.skin == null ? null : Number(r.skin),
    metaJson,
    skinId: skinIdFromAccount({ metaJson }),
    bookId: bookIdFromAccount({ metaJson }),
    mapper: mapperFromAccount({ metaJson }),
  };
  // Soft parse for derived adapter fields (kalshi empty-url may be null).
  try {
    const identity = parseOutIdentity({
      id: base.id,
      partnerId: base.partnerId,
      url: base.url,
      provider: base.provider,
      maxStake: base.maxStake,
      maxWin: base.maxWin,
      skin: base.skin,
      metaJson,
      status: base.status,
      requireHost: false,
    });
    if (identity) {
      return {
        ...base,
        skinId: identity.skinId,
        bookId: identity.bookId ?? base.bookId,
        mapper: identity.adapter.mapperKind,
        adapterId: identity.adapter.adapterId,
      };
    }
  } catch {
    /* leave meta-derived skinId/bookId/mapper */
  }
  return base;
}

/** Parse-once OutIdentity for a stored row (throws on invalid host/capacity when requireHost). */
export function outIdentityFromAccount(
  account: BettingAccountRow,
  options?: { requireHost?: boolean }
): OutIdentity | null {
  return parseOutIdentity({
    id: account.id,
    partnerId: account.partnerId,
    url: account.url,
    provider: account.provider,
    maxStake: account.maxStake,
    maxWin: account.maxWin,
    skin: account.skin,
    metaJson: account.metaJson,
    status: account.status,
    requireHost: options?.requireHost,
  });
}

/**
 * Capacity by provider = sum of **active live-product perBetMax** across outs.
 * When capacity meta is absent, falls back to account maxStake as a single row.
 * This is stake capacity, not market depth.
 */
export function computeProviderCapacity(accounts: BettingAccountRow[]): ProviderCapacity[] {
  const by = new Map<string, ProviderCapacity>();
  for (const a of accounts) {
    if (a.status !== 'active') continue;
    const out = outCapacityFromAccount(a);
    let row = by.get(a.provider);
    if (!row) {
      row = {
        provider: a.provider,
        accountCount: 0,
        capacityPairCount: 0,
        totalMaxStake: 0,
        totalMaxWin: 0,
        accountIds: [],
        outs: [],
      };
      by.set(a.provider, row);
    }
    row.accountCount++;
    row.capacityPairCount += out.liveProducts.length;
    row.totalMaxStake += out.totalPerBetMax;
    row.totalMaxWin += out.totalMaxWin;
    row.accountIds.push(a.id);
    row.outs.push(out);
  }
  for (const row of by.values()) {
    row.outs.sort((x, y) => y.totalPerBetMax - x.totalPerBetMax || x.outId.localeCompare(y.outId));
  }
  return [...by.values()].sort((a, b) => a.provider.localeCompare(b.provider));
}

/**
 * Parse FANTASY402_LIVE_PRODUCTS_JSON → OutCapacityRow[].
 * Accepts `{ name | liveProduct | skin, perBetMax, maxWin }`.
 */
export function parseLiveProductsJsonEnv(raw: string | undefined): OutCapacityRow[] {
  if (!raw?.trim()) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v
      .map((row): OutCapacityRow | null => {
        if (!row || typeof row !== 'object') return null;
        const r = row as Record<string, unknown>;
        const name = String(r.liveProduct ?? r.name ?? r.skin ?? '').trim();
        if (!name) return null;
        return {
          name,
          perBetMax: Number(r.perBetMax ?? r.maxStake ?? 0) || 0,
          maxWin: Number(r.maxWin ?? 0) || 0,
          active: r.active !== false,
        };
      })
      .filter((s): s is OutCapacityRow => s != null);
  } catch {
    return [];
  }
}

/**
 * Seed registry from Fantasy402 env (non-secret fields + env_prefix pointer).
 * Does not store password/token.
 *
 * Multi-product (preferred):
 *   FANTASY402_LIVE_PRODUCTS_JSON='[{"name":"ezlive","perBetMax":500,"maxWin":2500},{"name":"dark","perBetMax":1000,"maxWin":5000}]'
 * Single-product fallback: FANTASY402_LIVE_PRODUCT + MAX_STAKE + MAX_WIN
 * Optional: FANTASY402_WORKING_BALANCE, FANTASY402_VAULT_ID, FANTASY402_ACCOUNT_ID=out-SPEN-1
 *
 * `betting_accounts.skin` column is always null on write — capacity is meta only.
 */
export function seedFantasy402FromEnv(
  db: Database,
  envMap: Record<string, string | undefined> = process.env,
  nowMs = Date.now()
): BettingAccountRow | null {
  ensurePartnerRegistrySchema(db);
  const customerID = envMap.FANTASY402_CUSTOMER_ID?.trim();
  if (!customerID) return null;

  const partnerCode = envMap.FANTASY402_PARTNER_CODE?.trim()?.toUpperCase() || null;
  const partnerId =
    envMap.FANTASY402_PARTNER_ID?.trim() ||
    (partnerCode ? `partner-${partnerCode.toLowerCase()}` : 'partner-default');
  const partnerName =
    envMap.FANTASY402_PARTNER_NAME?.trim() ||
    (partnerCode ? `Partner ${partnerCode}` : 'Default Partner');
  upsertPartner(
    db,
    {
      id: partnerId,
      name: partnerName,
      active: true,
      profitSplit: null,
      commissionRate: null,
      notes: 'Seeded from FANTASY402_* env (blueprint)',
    },
    nowMs
  );

  const productsFromJson = parseLiveProductsJsonEnv(envMap.FANTASY402_LIVE_PRODUCTS_JSON);
  const maxStakeEnv = Number(envMap.FANTASY402_MAX_STAKE ?? '1000') || 0;
  const maxWinEnv = Number(envMap.FANTASY402_MAX_WIN ?? '5000') || 0;
  const productWire = parseLiveProductWire(envMap.FANTASY402_LIVE_PRODUCT, 2);
  const liveProducts: OutCapacityRow[] =
    productsFromJson.length > 0
      ? productsFromJson
      : [
          {
            name: String(productWire),
            perBetMax: maxStakeEnv,
            maxWin: maxWinEnv,
            active: true,
          },
        ];

  const maxStake = Math.max(...liveProducts.map(s => s.perBetMax), 0);
  const maxWin = Math.max(...liveProducts.map(s => s.maxWin), 0);
  const currency = envMap.FANTASY402_CURRENCY?.trim() || 'USD';
  const url = resolveDeskDomainFromEnv(envMap);
  const accountId =
    envMap.FANTASY402_ACCOUNT_ID?.trim() || (partnerCode ? `out-${partnerCode}-1` : customerID);

  const workingBalanceRaw = envMap.FANTASY402_WORKING_BALANCE?.trim();
  const workingBalance = workingBalanceRaw ? Number(workingBalanceRaw) : undefined;
  const vaultId =
    envMap.FANTASY402_VAULT_ID?.trim() ||
    (accountId.startsWith('out-') ? `vault-${accountId}` : undefined);

  // Host → SkinId + ⊆ check + stamp via OutIdentity inside upsertBettingAccount.
  // Column `skin` is legacy schema — always null on write (capacity in meta only).
  const account: BettingAccountRow = {
    id: accountId,
    partnerId,
    provider: 'fantasy402',
    url,
    status: 'active',
    envPrefix: 'FANTASY402_',
    maxStake,
    maxWin,
    currency,
    skin: null,
    metaJson: buildOutCapacityMeta({
      liveProducts,
      workingBalance:
        workingBalance != null && Number.isFinite(workingBalance) ? workingBalance : undefined,
      vaultId,
      partnerCode: partnerCode ?? undefined,
      customerID,
      agentID: envMap.FANTASY402_AGENT_ID?.trim() || undefined,
      defaultLiveProduct: String(liveProducts[0]?.name ?? productWire),
    }),
  };
  upsertBettingAccount(db, account, nowMs);
  const stored = getBettingAccountById(db, accountId);
  return stored ?? account;
}

export {
  adapterBindingForSkin,
  assertLiveProductsAllowed,
  buildSkinMetaFields,
  capacityToOutCapacityRows,
  guardAndStampAccountMeta,
  parseOutIdentity,
  providerMirrorFromAdapter,
  resolveSkinForAccountUrl,
  stampOutMeta,
  type AdapterBinding,
  type AdapterId,
  type LiveProductCapacity,
  type OutIdentity,
} from './out-identity.ts';
export { bookIdFromAccount, mapperFromAccount, skinIdFromAccount } from './out-capacity.ts';

/** Re-export out capacity helpers for registry consumers. */
export {
  concentrationByOut,
  listEligibleOutCapacityPairs,
  liquidityKey,
  outCapacityFromAccount,
  pickBestCapacityForOut,
  resolveOutCapacity,
} from './out-capacity.ts';
export type {
  OutCapacity,
  OutCapacityPair,
  OutCapacityRow,
  OutExposureShare,
} from './out-capacity.ts';
