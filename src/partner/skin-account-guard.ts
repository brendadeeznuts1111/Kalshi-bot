/**
 * Write-path guard — thin facade over out-identity boundary.
 * Prefer importing from `./out-identity.ts` for new code.
 */

export {
  assertLiveProductsAllowed,
  buildSkinMetaFields,
  guardAndStampAccountMeta,
  isLegacyNumericWire,
  resolveSkinForAccountUrl,
} from './out-identity.ts';
