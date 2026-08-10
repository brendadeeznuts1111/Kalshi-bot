/**
 * Out identity boundary — parse-once view of an out.
 *
 * Host → SkinId (white-label) → offered live products → capacity ⊆ offered
 * → AdapterBinding (adapterId / mapperKind / bookEnvToken).
 *
 * Capacity meta may use `liveProducts` (new) or legacy `skins` (mirror).
 */

import {
  getSkin,
  getSkinByHost,
  isLegacyCapacityLiveProduct,
  isLiveProductId,
  isSkinId,
  normalizeLiveProductName,
  type SkinId,
} from '../domain/index.ts';
import type { OutMeta, OutSkinLimit, OutSkinMapperKind } from './skins.ts';
import { parseOutMeta } from './skins.ts';

export type AdapterId = 'fantasy-ultra' | 'kalshi' | 'unmapped';

export type AdapterBinding = {
  adapterId: AdapterId;
  mapperKind: OutSkinMapperKind;
  /** Env brand token only (FANTASY402) — not SkinId, not PartnerId. */
  bookEnvToken: string;
};

export type LiveProductCapacity = {
  liveProduct: string;
  perBetMax: number;
  maxWin: number;
  active: boolean;
};

export type OutIdentity = {
  outId: string;
  partnerId: string;
  url: string;
  skinId: SkinId;
  adapter: AdapterBinding;
  capacity: LiveProductCapacity[];
  defaultLiveProduct: string;
  workingBalance?: number;
  vaultId?: string;
  partnerCode?: string;
  customerID?: string;
  agentID?: string;
};

export type ParseOutIdentityInput = {
  id: string;
  partnerId: string;
  url: string;
  provider?: string;
  maxStake: number;
  maxWin: number;
  skin: number | null;
  metaJson: string;
  status?: string;
  /**
   * When true (default), require resolvable host or meta.skinId.
   * False for kalshi-style rows with empty url.
   */
  requireHost?: boolean;
};

/** True for numeric Ultra wire ids ("2") that bypass offered-product ⊆. */
export function isLegacyNumericWire(name: string): boolean {
  return /^\d+$/.test(name.trim());
}

export function resolveSkinForAccountUrl(url: string): SkinId {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error('Account url/host is required to resolve skin (add host to SKINS)');
  }
  const skinId = getSkinByHost(trimmed);
  if (!skinId) {
    throw new Error(
      `Unknown account host for url=${trimmed} — add hostname to SKINS[].hosts / HOST_TO_SKIN`
    );
  }
  return skinId;
}

export function assertLiveProductsAllowed(skinId: SkinId, names: readonly string[]): void {
  const skin = getSkin(skinId);
  if (!skin) {
    throw new Error(`Unknown SkinId: ${skinId}`);
  }
  const offered = new Set<string>(skin.offeredLiveProducts);
  const bad: string[] = [];
  for (const raw of names) {
    const name = normalizeLiveProductName(raw);
    if (!name) continue;
    if (isLegacyNumericWire(name)) continue;
    if (isLegacyCapacityLiveProduct(name)) continue;
    if (isLiveProductId(name) && offered.has(name)) continue;
    bad.push(String(raw));
  }
  if (bad.length > 0) {
    throw new Error(
      `Live products not offered by skin=${skinId}: [${bad.join(', ')}] ` +
        `(allowed: ${[...offered].join(', ')}, plus dark / numeric wire)`
    );
  }
}

/** Map white-label mapper + legacy provider column → AdapterBinding. */
export function adapterBindingForSkin(skinId: SkinId, providerHint?: string): AdapterBinding {
  const skin = getSkin(skinId);
  if (!skin) {
    throw new Error(`Unknown SkinId: ${skinId}`);
  }
  const mapperKind = skin.mapper.kind;
  if (mapperKind === 'fantasy402') {
    return {
      adapterId: 'fantasy-ultra',
      mapperKind: 'fantasy402',
      bookEnvToken: 'FANTASY402',
    };
  }
  const hint = (providerHint ?? '').trim().toLowerCase();
  if (hint === 'kalshi') {
    return {
      adapterId: 'kalshi',
      mapperKind: 'unmapped',
      bookEnvToken: 'KALSHI',
    };
  }
  return {
    adapterId: 'unmapped',
    mapperKind: 'unmapped',
    bookEnvToken: hint ? hint.toUpperCase() : '',
  };
}

/** Legacy provider column mirror from AdapterBinding. */
export function providerMirrorFromAdapter(adapter: AdapterBinding): string {
  if (adapter.adapterId === 'fantasy-ultra') return 'fantasy402';
  if (adapter.adapterId === 'kalshi') return 'kalshi';
  return adapter.bookEnvToken.toLowerCase() || 'unmapped';
}

type RawCapacityRow = {
  name?: string;
  skin?: string;
  liveProduct?: string;
  perBetMax?: number;
  maxStake?: number;
  maxWin?: number;
  active?: boolean;
};

function rowToCapacity(row: RawCapacityRow): LiveProductCapacity | null {
  const raw = String(row.liveProduct ?? row.name ?? row.skin ?? '').trim();
  if (!raw) return null;
  return {
    liveProduct: normalizeLiveProductName(raw),
    perBetMax: Number(row.perBetMax ?? row.maxStake ?? 0) || 0,
    maxWin: Number(row.maxWin ?? 0) || 0,
    active: row.active !== false,
  };
}

/**
 * Parse capacity rows from meta: prefer `liveProducts`, dual-read legacy `skins`.
 * Falls back to column skin + maxStake/maxWin when both arrays empty.
 */
export function parseCapacityFromMeta(input: {
  maxStake: number;
  maxWin: number;
  skin: number | null;
  meta: OutMeta;
  status?: string;
}): LiveProductCapacity[] {
  if (input.status && input.status !== 'active') return [];

  const meta = input.meta;
  const fromLive = Array.isArray(meta.liveProducts) ? (meta.liveProducts as RawCapacityRow[]) : [];
  const fromSkins = Array.isArray(meta.skins) ? (meta.skins as RawCapacityRow[]) : [];
  const source = fromLive.length > 0 ? fromLive : fromSkins;

  const parsed = source.map(rowToCapacity).filter((c): c is LiveProductCapacity => c != null);

  if (parsed.length > 0) {
    return parsed.filter(c => c.active);
  }

  const defaultName =
    (typeof meta.defaultLiveProduct === 'string' && meta.defaultLiveProduct.trim()) ||
    (typeof meta.defaultSkin === 'string' && meta.defaultSkin.trim()) ||
    (input.skin != null && Number.isFinite(input.skin) ? String(input.skin) : '2');

  return [
    {
      liveProduct: normalizeLiveProductName(defaultName),
      perBetMax: Number(input.maxStake) || 0,
      maxWin: Number(input.maxWin) || 0,
      active: true,
    },
  ];
}

/** Convert capacity → legacy OutSkinLimit shape (name = liveProduct). */
export function capacityToOutSkinLimits(capacity: readonly LiveProductCapacity[]): OutSkinLimit[] {
  return capacity.map(c => ({
    name: c.liveProduct,
    perBetMax: c.perBetMax,
    maxWin: c.maxWin,
    active: c.active,
  }));
}

export function liveProductNames(identity: OutIdentity): string[] {
  return identity.capacity.map(c => c.liveProduct);
}

/**
 * Stamp OutIdentity into meta_json.
 * Writes both `liveProducts` (canonical) and `skins` (legacy mirror).
 */
export function stampOutMeta(identity: OutIdentity, baseMeta?: OutMeta): string {
  const meta: OutMeta = {
    ...(baseMeta ?? {}),
    skinId: identity.skinId,
    mapper: identity.adapter.mapperKind,
    defaultLiveProduct: identity.defaultLiveProduct,
    defaultSkin: identity.defaultLiveProduct,
    liveProducts: identity.capacity.map(c => ({
      liveProduct: c.liveProduct,
      name: c.liveProduct,
      perBetMax: c.perBetMax,
      maxWin: c.maxWin,
      active: c.active,
    })),
    skins: identity.capacity.map(c => ({
      name: c.liveProduct,
      perBetMax: c.perBetMax,
      maxWin: c.maxWin,
      active: c.active,
    })),
  };
  if (identity.workingBalance != null) meta.workingBalance = identity.workingBalance;
  if (identity.vaultId) meta.vaultId = identity.vaultId;
  if (identity.partnerCode) meta.partnerCode = identity.partnerCode;
  if (identity.customerID) meta.customerID = identity.customerID;
  if (identity.agentID) meta.agentID = identity.agentID;
  return JSON.stringify(meta);
}

/**
 * Parse-once out identity. Throws when host/skin/capacity invalid (requireHost).
 * When requireHost is false and no skin can be resolved, returns null.
 */
export function parseOutIdentity(input: ParseOutIdentityInput): OutIdentity | null {
  const requireHost = input.requireHost !== false;
  const meta = parseOutMeta(input.metaJson);

  let skinId: SkinId | undefined;
  if (input.url.trim()) {
    skinId = resolveSkinForAccountUrl(input.url);
  } else if (typeof meta.skinId === 'string' && isSkinId(meta.skinId)) {
    skinId = meta.skinId;
  } else if (requireHost) {
    throw new Error(`Account ${input.id}: url/host required to resolve skin (or set meta.skinId)`);
  } else {
    return null;
  }

  const capacity = parseCapacityFromMeta({
    maxStake: input.maxStake,
    maxWin: input.maxWin,
    skin: input.skin,
    meta,
    status: input.status,
  });
  assertLiveProductsAllowed(
    skinId,
    capacity.map(c => c.liveProduct)
  );

  const adapter = adapterBindingForSkin(skinId, input.provider);
  const defaultLiveProduct =
    (typeof meta.defaultLiveProduct === 'string' && meta.defaultLiveProduct.trim()) ||
    (typeof meta.defaultSkin === 'string' && meta.defaultSkin.trim()) ||
    capacity[0]?.liveProduct ||
    '2';

  return {
    outId: input.id,
    partnerId: input.partnerId,
    url: input.url,
    skinId,
    adapter,
    capacity,
    defaultLiveProduct: normalizeLiveProductName(defaultLiveProduct),
    workingBalance:
      typeof meta.workingBalance === 'number' && Number.isFinite(meta.workingBalance)
        ? meta.workingBalance
        : undefined,
    vaultId: typeof meta.vaultId === 'string' ? meta.vaultId : undefined,
    partnerCode: typeof meta.partnerCode === 'string' ? meta.partnerCode : undefined,
    customerID: typeof meta.customerID === 'string' ? meta.customerID : undefined,
    agentID: typeof meta.agentID === 'string' ? meta.agentID : undefined,
  };
}

/**
 * Validate + stamp meta for registry write.
 * Returns stamped metaJson; when soft (no host required and unresolved), returns input unchanged.
 */
export function guardAndStampAccountMeta(input: {
  id: string;
  partnerId?: string;
  url: string;
  provider?: string;
  maxStake: number;
  maxWin: number;
  skin: number | null;
  metaJson: string;
  status?: string;
  requireHost?: boolean;
}): {
  skinId?: SkinId;
  mapper?: OutSkinMapperKind;
  adapterId?: AdapterId;
  metaJson: string;
  identity?: OutIdentity;
} {
  const identity = parseOutIdentity({
    id: input.id,
    partnerId: input.partnerId ?? '',
    url: input.url,
    provider: input.provider,
    maxStake: input.maxStake,
    maxWin: input.maxWin,
    skin: input.skin,
    metaJson: input.metaJson,
    status: input.status,
    requireHost: input.requireHost,
  });

  if (!identity) {
    return { metaJson: input.metaJson };
  }

  const base = parseOutMeta(input.metaJson);
  return {
    skinId: identity.skinId,
    mapper: identity.adapter.mapperKind,
    adapterId: identity.adapter.adapterId,
    metaJson: stampOutMeta(identity, base),
    identity,
  };
}

export function buildSkinMetaFields(skinId: SkinId): {
  skinId: SkinId;
  mapper: OutSkinMapperKind;
} {
  const skin = getSkin(skinId);
  if (!skin) throw new Error(`Unknown SkinId: ${skinId}`);
  return { skinId: skin.id, mapper: skin.mapper.kind };
}
