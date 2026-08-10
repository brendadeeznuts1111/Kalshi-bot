/**
 * Machine-readable skin matrix derived from SKINS (hosts · products · fingerprints · mapper).
 * Used by `bun run partner:domain -- --skins` and domain tests.
 */

import { getLiveProduct } from './live-products.ts';
import { SKINS, listSkinApexHosts, type SkinId, type SkinMapper } from './skins.ts';

export type SkinMatrixGap =
  | 'missing_fingerprints'
  | 'missing_live_products'
  | 'mapper_unmapped';

/**
 * Active skins allowed to ship without fingerprints while Batches 2–5 fill them.
 * Remove an id from this list when that skin's fingerprints land.
 */
export const FINGERPRINT_PENDING_SKINS = ['1bv', 'lvaction', 'magnum'] as const satisfies readonly SkinId[];

const FINGERPRINT_PENDING = new Set<string>(FINGERPRINT_PENDING_SKINS);

export type SkinMatrixRow = {
  skinId: SkinId;
  displayName: string;
  active: boolean;
  offeredLiveProducts: readonly string[];
  catalogLiveProducts: readonly string[];
  apexHosts: readonly string[];
  mapperKind: SkinMapper['kind'];
  mapperNote: string;
  fingerprintEndpointCount: number;
  fingerprintAssetCount: number;
  hasFingerprints: boolean;
  fingerprintPending: boolean;
  gaps: readonly SkinMatrixGap[];
};

export function gapsForSkin(input: {
  hasFingerprints: boolean;
  offeredLiveProducts: readonly string[];
  mapperKind: SkinMapper['kind'];
}): SkinMatrixGap[] {
  const gaps: SkinMatrixGap[] = [];
  if (!input.hasFingerprints) gaps.push('missing_fingerprints');
  if (input.offeredLiveProducts.length === 0) gaps.push('missing_live_products');
  if (input.mapperKind === 'unmapped') gaps.push('mapper_unmapped');
  return gaps;
}

export function buildSkinMatrixRows(): SkinMatrixRow[] {
  return SKINS.map(skin => {
    const catalogLiveProducts = skin.offeredLiveProducts.map(id => {
      const p = getLiveProduct(id);
      return p?.catalogName ?? id;
    });
    const endpointCount = skin.fingerprints.endpoints.length;
    const assetCount = skin.fingerprints.assets.length;
    const hasFingerprints = endpointCount + assetCount > 0;
    const offered = [...skin.offeredLiveProducts];
    return {
      skinId: skin.id,
      displayName: skin.displayName,
      active: skin.active,
      offeredLiveProducts: offered,
      catalogLiveProducts,
      apexHosts: listSkinApexHosts(skin.id),
      mapperKind: skin.mapper.kind,
      mapperNote: skin.mapper.note,
      fingerprintEndpointCount: endpointCount,
      fingerprintAssetCount: assetCount,
      hasFingerprints,
      fingerprintPending: FINGERPRINT_PENDING.has(skin.id),
      gaps: gapsForSkin({
        hasFingerprints,
        offeredLiveProducts: offered,
        mapperKind: skin.mapper.kind,
      }),
    };
  });
}

/** Compact TTY table for operators / agents. */
export function formatSkinMatrixText(rows: readonly SkinMatrixRow[] = buildSkinMatrixRows()): string {
  const lines: string[] = ['Skin matrix (SKINS SSOT)', '─'.repeat(72)];
  for (const r of rows) {
    const products =
      r.catalogLiveProducts.length > 0 ? r.catalogLiveProducts.join(', ') : '(none declared)';
    const fp = r.hasFingerprints
      ? `fp endpoints=${r.fingerprintEndpointCount} assets=${r.fingerprintAssetCount}`
      : r.fingerprintPending
        ? 'fp pending'
        : 'fp empty';
    const gapLabel = r.gaps.length > 0 ? ` gaps=[${r.gaps.join(',')}]` : ' gaps=[]';
    lines.push(
      `${r.active ? '●' : '○'} ${r.skinId.padEnd(10)} mapper=${r.mapperKind.padEnd(11)} ${fp}${gapLabel}`
    );
    lines.push(`    products: ${products}`);
    lines.push(`    hosts:    ${r.apexHosts.join(', ') || '(none)'}`);
  }
  lines.push('─'.repeat(72));
  const withGaps = rows.filter(r => r.gaps.length > 0).length;
  lines.push(
    `skins=${rows.length}  active=${rows.filter(r => r.active).length}  withGaps=${withGaps}`
  );
  return lines.join('\n');
}

/** Markdown skin table for README (keeps docs from hand-drifting). */
export function formatSkinMatrixMarkdownTable(
  rows: readonly SkinMatrixRow[] = buildSkinMatrixRows()
): string {
  const header =
    '| Skin         | Active | Live products              | Hosts                       | Mapper / gaps |\n' +
    '| ------------ | ------ | -------------------------- | --------------------------- | ------------- |';
  const body = rows
    .map(r => {
      const products =
        r.catalogLiveProducts.length > 0 ? r.catalogLiveProducts.join(', ') : '(none)';
      const hosts = r.apexHosts.map(h => h.replace(/^www\./, '')).join(', ') || '(none)';
      const hostShort =
        hosts.length > 40 ? `${hosts.slice(0, 37)}…` : hosts;
      const mapper =
        r.gaps.length === 0
          ? `**${r.mapperKind}**`
          : `${r.mapperKind} (${r.gaps.join(', ')})`;
      return `| **${r.skinId}** | ${r.active ? 'yes' : 'no'} | ${products} | ${hostShort} | ${mapper} |`;
    })
    .join('\n');
  return `${header}\n${body}`;
}

/**
 * Active skins must have fingerprints, or be explicitly fingerprint-pending.
 * Throws with offending skin ids.
 */
export function assertFingerprintCoverage(rows: readonly SkinMatrixRow[] = buildSkinMatrixRows()): void {
  const bad = rows
    .filter(r => r.active && !r.hasFingerprints && !r.fingerprintPending)
    .map(r => r.skinId);
  if (bad.length > 0) {
    throw new Error(
      `Active skins missing fingerprints (not in FINGERPRINT_PENDING_SKINS): [${bad.join(', ')}]`
    );
  }
  const stale = rows
    .filter(r => r.fingerprintPending && r.hasFingerprints)
    .map(r => r.skinId);
  if (stale.length > 0) {
    throw new Error(
      `Skins still listed in FINGERPRINT_PENDING_SKINS but have fingerprints — remove: [${stale.join(', ')}]`
    );
  }
}
