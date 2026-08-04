// @see https://bun.com/docs/runtime/sqlite
/**
 * Partners (financial entities) → Betting accounts (outs) → Providers (adapters).
 *
 * Capacity liquidity = sum of account maxStake for a provider.
 * That is NOT market tradable until the provider offers a priced line.
 * Secrets stay in env / vault — never persist password or bearer JWT.
 */
import type { Database } from "bun:sqlite";

export type ProviderId = "fantasy402" | "kalshi" | (string & {});

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
  status: "active" | "inactive" | "pending";
  /** Env var prefix for secrets, e.g. FANTASY402_ */
  envPrefix: string | null;
  maxStake: number;
  maxWin: number;
  currency: string;
  skin: number | null;
  /** Non-secret meta only (office, labels) */
  metaJson: string;
};

export type ProviderCapacity = {
  provider: ProviderId;
  accountCount: number;
  totalMaxStake: number;
  totalMaxWin: number;
  accountIds: string[];
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
    `CREATE INDEX IF NOT EXISTS idx_betting_accounts_partner ON betting_accounts (partner_id)`,
  );
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_betting_accounts_provider ON betting_accounts (provider)`,
  );
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_betting_accounts_status ON betting_accounts (status)`,
  );
}

export function upsertPartner(
  db: Database,
  partner: Omit<PartnerEntity, "active"> & { active?: boolean },
  nowMs = Date.now(),
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
       updated_at = excluded.updated_at`,
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
  nowMs = Date.now(),
): void {
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
       updated_at = excluded.updated_at`,
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
    $meta_json: account.metaJson,
    $now: nowMs,
  });
}

export function listActiveBettingAccounts(db: Database): BettingAccountRow[] {
  const rows = db
    .query(
      `SELECT id, partner_id AS partnerId, provider, url, status, env_prefix AS envPrefix,
              max_stake AS maxStake, max_win AS maxWin, currency, skin, meta_json AS metaJson
       FROM betting_accounts WHERE status = 'active'`,
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map(mapAccountRow);
}

export function listBettingAccountsByProvider(
  db: Database,
  provider: string,
): BettingAccountRow[] {
  const rows = db
    .query(
      `SELECT id, partner_id AS partnerId, provider, url, status, env_prefix AS envPrefix,
              max_stake AS maxStake, max_win AS maxWin, currency, skin, meta_json AS metaJson
       FROM betting_accounts WHERE provider = $p AND status = 'active'`,
    )
    .all({ $p: provider }) as Array<Record<string, unknown>>;
  return rows.map(mapAccountRow);
}

function mapAccountRow(r: Record<string, unknown>): BettingAccountRow {
  return {
    id: String(r.id),
    partnerId: String(r.partnerId),
    provider: String(r.provider) as ProviderId,
    url: String(r.url ?? ""),
    status: (String(r.status ?? "active") as BettingAccountRow["status"]),
    envPrefix: r.envPrefix != null ? String(r.envPrefix) : null,
    maxStake: Number(r.maxStake) || 0,
    maxWin: Number(r.maxWin) || 0,
    currency: String(r.currency ?? "USD"),
    skin: r.skin == null ? null : Number(r.skin),
    metaJson: String(r.metaJson ?? "{}"),
  };
}

/**
 * Capacity liquidity by provider = sum of maxStake across active accounts.
 * This is stake capacity, not market depth.
 */
export function computeProviderCapacity(
  accounts: BettingAccountRow[],
): ProviderCapacity[] {
  const by = new Map<string, ProviderCapacity>();
  for (const a of accounts) {
    if (a.status !== "active") continue;
    let row = by.get(a.provider);
    if (!row) {
      row = {
        provider: a.provider,
        accountCount: 0,
        totalMaxStake: 0,
        totalMaxWin: 0,
        accountIds: [],
      };
      by.set(a.provider, row);
    }
    row.accountCount++;
    row.totalMaxStake += a.maxStake;
    row.totalMaxWin += a.maxWin;
    row.accountIds.push(a.id);
  }
  return [...by.values()].sort((a, b) =>
    a.provider.localeCompare(b.provider),
  );
}

/**
 * Seed registry from Fantasy402 env (non-secret fields + env_prefix pointer).
 * Does not store password/token.
 */
export function seedFantasy402FromEnv(
  db: Database,
  envMap: Record<string, string | undefined> = process.env,
  nowMs = Date.now(),
): BettingAccountRow | null {
  ensurePartnerRegistrySchema(db);
  const customerID = envMap.FANTASY402_CUSTOMER_ID?.trim();
  if (!customerID) return null;

  const partnerId =
    envMap.FANTASY402_PARTNER_ID?.trim() || "partner-default";
  const partnerName =
    envMap.FANTASY402_PARTNER_NAME?.trim() || "Default Partner";
  upsertPartner(
    db,
    {
      id: partnerId,
      name: partnerName,
      active: true,
      profitSplit: null,
      commissionRate: null,
      notes: "Seeded from FANTASY402_* env (blueprint)",
    },
    nowMs,
  );

  const maxStake = Number(envMap.FANTASY402_MAX_STAKE ?? "1000") || 0;
  const maxWin = Number(envMap.FANTASY402_MAX_WIN ?? "5000") || 0;
  const skinRaw = envMap.FANTASY402_SKIN?.trim();
  const skin = skinRaw ? Number(skinRaw) : 2;
  const currency = envMap.FANTASY402_CURRENCY?.trim() || "USD";
  const url =
    envMap.FANTASY402_DOMAIN?.trim() || "https://fantasy402.com";
  const accountId =
    envMap.FANTASY402_ACCOUNT_ID?.trim() || customerID;

  const account: BettingAccountRow = {
    id: accountId,
    partnerId,
    provider: "fantasy402",
    url,
    status: "active",
    envPrefix: "FANTASY402_",
    maxStake,
    maxWin,
    currency,
    skin: Number.isFinite(skin) ? skin : 2,
    metaJson: JSON.stringify({
      customerID,
      agentID: envMap.FANTASY402_AGENT_ID?.trim() || null,
      // secrets: use env FANTASY402_PASSWORD / FANTASY402_BEARER_TOKEN
    }),
  };
  upsertBettingAccount(db, account, nowMs);
  return account;
}
