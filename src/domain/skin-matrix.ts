/**
 * Machine-readable skin matrix derived from SKINS (hosts · products · fingerprints · mapper).
 * Used by `bun run partner:domain -- --skins` and domain tests.
 */

import { getLiveProduct } from './live-products.ts';
import { SKINS, listSkinApexHosts, type SkinId, type SkinMapper } from './skins.ts';

export type SkinMatrixRow = {
  skinId: SkinId;
  displayName: string;
  active: boolean;
  offeredLiveProducts: readonly string[];
  catalogLiveProducts: readonly string[];
  apexHosts: readonly string[];
  mapperKind: SkinMapper['kind'];
  fingerprintEndpointCount: number;
  fingerprintAssetCount: number;
  hasFingerprints: boolean;
};

export function buildSkinMatrixRows(): SkinMatrixRow[] {
  return SKINS.map(skin => {
    const catalogLiveProducts = skin.offeredLiveProducts.map(id => {
      const p = getLiveProduct(id);
      return p?.catalogName ?? id;
    });
    const endpointCount = skin.fingerprints.endpoints.length;
    const assetCount = skin.fingerprints.assets.length;
    return {
      skinId: skin.id,
      displayName: skin.displayName,
      active: skin.active,
      offeredLiveProducts: [...skin.offeredLiveProducts],
      catalogLiveProducts,
      apexHosts: listSkinApexHosts(skin.id),
      mapperKind: skin.mapper.kind,
      fingerprintEndpointCount: endpointCount,
      fingerprintAssetCount: assetCount,
      hasFingerprints: endpointCount + assetCount > 0,
    };
  });
}

/** Compact TTY table for operators / agents. */
export function formatSkinMatrixText(rows: readonly SkinMatrixRow[] = buildSkinMatrixRows()): string {
  const lines: string[] = [
    'Skin matrix (SKINS SSOT)',
    '─'.repeat(72),
  ];
  for (const r of rows) {
    const products =
      r.catalogLiveProducts.length > 0 ? r.catalogLiveProducts.join(', ') : '(none declared)';
    const fp = r.hasFingerprints
      ? `fp endpoints=${r.fingerprintEndpointCount} assets=${r.fingerprintAssetCount}`
      : 'fp empty';
    lines.push(
      `${r.active ? '●' : '○'} ${r.skinId.padEnd(10)} mapper=${r.mapperKind.padEnd(11)} ${fp}`
    );
    lines.push(`    products: ${products}`);
    lines.push(`    hosts:    ${r.apexHosts.join(', ') || '(none)'}`);
  }
  lines.push('─'.repeat(72));
  lines.push(`skins=${rows.length}  active=${rows.filter(r => r.active).length}`);
  return lines.join('\n');
}
