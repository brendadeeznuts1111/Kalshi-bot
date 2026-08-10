/**
 * Out × live-product capacity matrix (seat plane).
 *
 * **Not** white-label `SkinId` — that is `src/domain/skins.ts`.
 *
 * - Out = betting account (credentials + working balance)
 * - Capacity row = live product wire (`ezlive`, `plive`, `ultralive`, …)
 * - Desk identity = host → BookId → SkinId (domain)
 *
 * Liquidity key: `{outId}@{liveProduct}` (e.g. `out-SPEN-1@ezlive`).
 */

import { isBookId, resolveBookId, type BookId } from '../domain/books.ts';
import { isSkinId, type SkinId, type SkinMapper } from '../domain/skins.ts';
import { normalizeLiveProductName } from '../domain/live-products.ts';

/** Live-product / wire name (getUltraLiveURL string or numeric wire). */
export type CapacityWireName = string;

/** White-label mapper kind on out meta (from SkinRecord.mapper.kind). */
export type OutMapperKind = SkinMapper['kind'];

/** Normalize capacity / live-product wire names (`ultra` → `ultralive`). */
export function normalizeCapacityWireName(raw: string | number): string {
  return normalizeLiveProductName(raw);
}

/** One active live-product capacity row under an out. */
export type OutCapacityRow = {
  name: CapacityWireName;
  perBetMax: number;
  maxWin: number;
  active: boolean;
};

type MetaCapacityRow = {
  name?: string;
  skin?: string;
  liveProduct?: string;
  perBetMax?: number;
  maxStake?: number;
  maxWin?: number;
  active?: boolean;
};

/** Non-secret meta on betting_accounts.meta_json (seat-capital shape). */
export type OutMeta = {
  vaultId?: string;
  partnerCode?: string;
  /** Shared account balance across live products (out-level). */
  workingBalance?: number;
  /** @deprecated use defaultLiveProduct */
  defaultSkin?: CapacityWireName;
  /** Default live-product / Ultra wire for this out. */
  defaultLiveProduct?: CapacityWireName;
  /** Canonical capacity rows (live products). */
  liveProducts?: MetaCapacityRow[];
  /**
   * Legacy capacity rows (name = live product wire).
   * Read-only dual path — writers stamp `liveProducts` only.
   */
  skins?: MetaCapacityRow[];
  /**
   * White-label SkinId (buckeye / ace / …) — host gateway identity.
   * Distinct from capacity live-product names.
   */
  skinId?: SkinId;
  /**
   * Desk brand BookId (fantasy402 / parlay21 / …) under the skin.
   * Distinct from SkinId and from bookEnvToken (FANTASY402).
   */
  bookId?: string;
  /** How offerings are mapped/probed for this skin (fantasy402 | unmapped). */
  mapper?: OutMapperKind;
  /** Opaque non-secret labels only — never password / token. */
  customerID?: string;
  agentID?: string;
  office?: string;
  [key: string]: unknown;
};

/** Expanded out for capacity / routing. */
export type OutCapacity = {
  outId: string;
  partnerId: string;
  provider: string;
  workingBalance: number | null;
  /** Active live-product capacity rows (not SkinId). */
  liveProducts: OutCapacityRow[];
  /** Sum of active rows' perBetMax (true out stake ceiling if split). */
  totalPerBetMax: number;
  totalMaxWin: number;
};

/** Eligible execution route: out + live product that can take `stake`. */
export type OutCapacityPair = {
  outId: string;
  partnerId: string;
  provider: string;
  /** Live-product wire name (not SkinId). */
  liveProduct: CapacityWireName;
  perBetMax: number;
  maxWin: number;
  workingBalance: number | null;
  /** Internal tracking key */
  key: string;
};

export type OutExposureShare = {
  outId: string;
  exposure: number;
  share: number;
};

/** `out-SPEN-1@ezlive` */
export function liquidityKey(outId: string, liveProduct: CapacityWireName): string {
  return `${outId}@${liveProduct}`;
}

export function parseLiquidityKey(
  key: string
): { outId: string; liveProduct: CapacityWireName } | null {
  const at = key.lastIndexOf('@');
  if (at <= 0 || at === key.length - 1) return null;
  return { outId: key.slice(0, at), liveProduct: key.slice(at + 1) };
}

/** Naming: out-{PARTNER}-{n} */
export function formatOutId(partnerCode: string, number: number | string): string {
  const code = partnerCode.trim().toUpperCase().replace(/^OUT-/, '');
  return `out-${code}-${number}`;
}

export function formatVaultName(outId: string): string {
  return `vault-${outId}`;
}

/**
 * Parse live-product wire for Ultra login body.
 * Numeric strings ("2") stay numbers (legacy Fantasy wire id);
 * named products ("ezlive", "dark") stay strings.
 */
export function parseLiveProductWire(
  raw: string | number | null | undefined,
  fallback: string | number = 2
): string | number {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const s = String(raw).trim();
  if (!s) return fallback;
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return n;
  }
  return normalizeCapacityWireName(s);
}

export function parseOutMeta(metaJson: string | null | undefined): OutMeta {
  if (!metaJson?.trim()) return {};
  try {
    const v = JSON.parse(metaJson) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as OutMeta;
  } catch {
    /* ignore */
  }
  return {};
}

/**
 * Resolve active live-product capacity for an account.
 * Prefer meta.liveProducts[]; dual-read legacy meta.skins[]; else column fallback.
 * (Kept here to avoid import cycle with out-identity — same rules as parseCapacityFromMeta.)
 */
export function resolveOutCapacity(input: {
  id: string;
  maxStake: number;
  maxWin: number;
  skin: number | null;
  metaJson: string;
  status?: string;
}): OutCapacityRow[] {
  if (input.status && input.status !== 'active') return [];

  const meta = parseOutMeta(input.metaJson);
  const source =
    meta.liveProducts && meta.liveProducts.length > 0 ? meta.liveProducts : (meta.skins ?? []);

  const fromMeta = source
    .map((row): OutCapacityRow | null => {
      const raw = String(row.liveProduct ?? row.name ?? row.skin ?? '').trim();
      if (!raw) return null;
      const name = normalizeCapacityWireName(raw);
      const perBetMax = Number(row.perBetMax ?? row.maxStake ?? 0) || 0;
      const maxWin = Number(row.maxWin ?? 0) || 0;
      const active = row.active !== false;
      return { name, perBetMax, maxWin, active };
    })
    .filter((s): s is OutCapacityRow => s != null);

  if (fromMeta.length > 0) {
    return fromMeta.filter(s => s.active);
  }

  const defaultName =
    meta.defaultLiveProduct?.trim() ||
    meta.defaultSkin?.trim() ||
    (input.skin != null && Number.isFinite(input.skin) ? String(input.skin) : '2');
  return [
    {
      name: defaultName,
      perBetMax: Number(input.maxStake) || 0,
      maxWin: Number(input.maxWin) || 0,
      active: true,
    },
  ];
}

export function outCapacityFromAccount(input: {
  id: string;
  partnerId: string;
  provider: string;
  maxStake: number;
  maxWin: number;
  skin: number | null;
  metaJson: string;
  status?: string;
}): OutCapacity {
  const liveProducts = resolveOutCapacity(input);
  const meta = parseOutMeta(input.metaJson);
  const workingBalance =
    typeof meta.workingBalance === 'number' && Number.isFinite(meta.workingBalance)
      ? meta.workingBalance
      : null;
  return {
    outId: input.id,
    partnerId: input.partnerId,
    provider: input.provider,
    workingBalance,
    liveProducts,
    totalPerBetMax: liveProducts.reduce((s, x) => s + x.perBetMax, 0),
    totalMaxWin: liveProducts.reduce((s, x) => s + x.maxWin, 0),
  };
}

/**
 * Eligible (out, skin) pairs that can accept `stake`.
 * workingBalance (if set) must also cover stake at out level.
 */
export function listEligibleOutCapacityPairs(
  accounts: Array<{
    id: string;
    partnerId: string;
    provider: string;
    maxStake: number;
    maxWin: number;
    skin: number | null;
    metaJson: string;
    status?: string;
  }>,
  stake: number,
  options?: { provider?: string }
): OutCapacityPair[] {
  const pairs: OutCapacityPair[] = [];
  for (const a of accounts) {
    if (a.status && a.status !== 'active') continue;
    if (options?.provider && a.provider !== options.provider) continue;
    const out = outCapacityFromAccount(a);
    if (out.workingBalance != null && out.workingBalance < stake) {
      continue;
    }
    for (const row of out.liveProducts) {
      if (row.perBetMax < stake) continue;
      pairs.push({
        outId: out.outId,
        partnerId: out.partnerId,
        provider: out.provider,
        liveProduct: row.name,
        perBetMax: row.perBetMax,
        maxWin: row.maxWin,
        workingBalance: out.workingBalance,
        key: liquidityKey(out.outId, row.name),
      });
    }
  }
  return pairs.sort((a, b) => b.perBetMax - a.perBetMax || a.key.localeCompare(b.key));
}

/**
 * After concentration picks an out, choose skin within that out.
 * Default: highest perBetMax that covers stake.
 */
export function pickBestCapacityForOut(
  rows: OutCapacityRow[],
  stake: number,
  prefer: 'maxCapacity' | 'first' = 'maxCapacity'
): OutCapacityRow | null {
  const ok = rows.filter(s => s.active && s.perBetMax >= stake);
  if (ok.length === 0) return null;
  if (prefer === 'first') return ok[0] ?? null;
  return (
    [...ok].sort((a, b) => b.perBetMax - a.perBetMax || a.name.localeCompare(b.name))[0] ?? null
  );
}

/**
 * Concentration by out (sum exposure across skins of the same out).
 * Share = exposure / total (or sum of exposures if total omitted).
 */
export function concentrationByOut(
  legs: Array<{ outId: string; amount: number }>,
  totalBook?: number
): OutExposureShare[] {
  const by = new Map<string, number>();
  for (const leg of legs) {
    by.set(leg.outId, (by.get(leg.outId) ?? 0) + Math.max(0, leg.amount));
  }
  const sum = [...by.values()].reduce((a, b) => a + b, 0);
  const denom = totalBook != null && totalBook > 0 ? totalBook : sum || 1;
  return [...by.entries()]
    .map(([outId, exposure]) => ({
      outId,
      exposure,
      share: exposure / denom,
    }))
    .sort((a, b) => b.share - a.share || a.outId.localeCompare(b.outId));
}

/** Build meta_json capacity (writes liveProducts only; readers dual-read legacy skins). */
export function buildOutCapacityMeta(input: {
  liveProducts: OutCapacityRow[];
  workingBalance?: number;
  vaultId?: string;
  partnerCode?: string;
  customerID?: string;
  agentID?: string;
  defaultLiveProduct?: CapacityWireName;
  /** White-label desk id (host gateway). */
  skinId?: SkinId;
  /** Desk brand under the skin (host-derived BookId). */
  bookId?: BookId | string;
  /** Mapper kind for this skin. */
  mapper?: OutMapperKind;
  extra?: Record<string, unknown>;
}): string {
  const capacity = input.liveProducts;
  const defaultLive = input.defaultLiveProduct ?? capacity[0]?.name;
  const rows = capacity.map(s => ({
    liveProduct: s.name,
    name: s.name,
    perBetMax: s.perBetMax,
    maxWin: s.maxWin,
    active: s.active,
  }));
  const meta: OutMeta = {
    ...(input.extra ?? {}),
    liveProducts: rows,
  };
  // Never re-emit legacy capacity keys when building fresh meta
  delete meta.skins;
  delete meta.defaultSkin;
  if (input.workingBalance != null) meta.workingBalance = input.workingBalance;
  if (input.vaultId) meta.vaultId = input.vaultId;
  if (input.partnerCode) meta.partnerCode = input.partnerCode;
  if (input.customerID) meta.customerID = input.customerID;
  if (input.agentID) meta.agentID = input.agentID;
  if (defaultLive) meta.defaultLiveProduct = defaultLive;
  if (input.skinId) meta.skinId = input.skinId;
  if (input.bookId) {
    const book = resolveBookId(String(input.bookId));
    if (book) meta.bookId = book;
  }
  if (input.mapper) meta.mapper = input.mapper;
  return JSON.stringify(meta);
}


/** Read white-label skinId from an account's meta_json (if stamped). */
export function skinIdFromAccount(input: { metaJson: string }): SkinId | undefined {
  const meta = parseOutMeta(input.metaJson);
  const raw = typeof meta.skinId === 'string' ? meta.skinId.trim() : '';
  return raw && isSkinId(raw) ? raw : undefined;
}

/** Read desk BookId from an account's meta_json (if stamped). */
export function bookIdFromAccount(input: { metaJson: string }): BookId | undefined {
  const meta = parseOutMeta(input.metaJson);
  const raw = typeof meta.bookId === 'string' ? meta.bookId.trim() : '';
  if (!raw) return undefined;
  if (isBookId(raw)) return raw;
  return resolveBookId(raw);
}

/** Read mapper kind from meta_json. */
export function mapperFromAccount(input: { metaJson: string }): OutMapperKind | undefined {
  const meta = parseOutMeta(input.metaJson);
  const m = meta.mapper;
  if (m === 'fantasy402' || m === 'unmapped') return m;
  return undefined;
}

