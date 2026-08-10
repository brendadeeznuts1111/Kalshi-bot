export type {
  FantasySessionAdapter,
  PartnerAccountStatus,
  PartnerBetGroup,
  PartnerBookedEvent,
  PartnerComponentBet,
  PartnerExecutionResult,
  PartnerId,
  PartnerLimits,
  PartnerLiveEvent,
  PartnerLiveUrlSet,
  PartnerMarket,
  PartnerOrder,
  PartnerOrderAdapter,
  PartnerSportLeague,
} from './types.ts';

export * from './execution/index.ts';

export {
  credentialsFromFantasyProfile,
  fantasyDeskEnvPresence,
  fantasyVaultItemTitle,
  listPartnerAccountsFromEnv,
  loadFantasy402ProfileFromEnv,
  loadFantasy402ProfileFromPrefix,
  profileFromEnvBundle,
  profileWithSkin,
  requireFantasy402ProfileFromEnv,
  requireFantasy402ProfileFromPrefix,
  type PartnerAccountProfile,
} from './account-profile.ts';

export {
  FantasyUltraAdapter,
  type ConnectWebSocketOptions,
  type FantasyUltraAdapterOptions,
} from './fantasy-ultra/adapter.ts';
export { CookieJar } from './fantasy-ultra/cookie-jar.ts';
export {
  executionResultFromBetGroups,
  inspectStreamListCapabilities,
  normalizeClientEventIdCandidates,
  orderIntentFromComponentBet,
  originFromLiveUrl,
  parseBetGroupsResponse,
  parseRenewTokenResponse,
  parseSportsLeagues,
  parseStatscoreBookedEvents,
  parseStreamList,
  parseUltraLiveUrlResponse,
  statscorePayloadHasPrices,
  type StreamListCapabilities,
} from './fantasy-ultra/parse.ts';
export {
  extractBetGroupsWiresFromHar,
  extractPlaceBetMapFromHar,
  listPlaceBetHarCandidates,
  loadHarFile,
  looksLikeBetGroupsWire,
  placeBetMapFromCandidate,
  type PlaceBetBodyEncoding,
  type PlaceBetEndpointMap,
  type PlaceBetHarCandidate,
} from './fantasy-ultra/place-bet-har.ts';
export {
  buildPlaceBetBody,
  defaultPlaceBetFields,
  encodePlaceBetBody,
  resolvePlaceBetUrl,
} from './fantasy-ultra/place-bet-body.ts';
export { FANTASY_ULTRA_DEFAULTS, type FantasyUltraCredentials } from './fantasy-ultra/types.ts';

export {
  formatSyncReport,
  matchBookedClientEventId,
  runPartnerInventorySync,
  type PartnerSyncOptions,
  type PartnerSyncReport,
} from './sync.ts';

export {
  fetchPublicPliveStreamEvents,
  filterLiveEventsBySport,
  formatSkinEventLine,
  listSkinInventoryIds,
  normalizeSkinEventsSports,
  resolveInventoryCompetitionId,
  stampSkinEventsCompetitionIds,
  upsertSkinLiveEvents,
  type SkinEventRow,
  type SkinEventUpsertResult,
} from './skin-events-store.ts';

export {
  adapterBindingForSkin,
  assertLiveProductsAllowed,
  buildSkinMetaFields,
  capacityToOutSkinLimits,
  computeProviderCapacity,
  concentrationByOut,
  ensurePartnerRegistrySchema,
  getBettingAccountById,
  guardAndStampAccountMeta,
  listActiveBettingAccounts,
  listBettingAccountsByProvider,
  listEligibleOutSkinPairs,
  liquidityKey,
  bookIdFromAccount,
  mapperFromAccount,
  outCapacityFromAccount,
  outIdentityFromAccount,
  parseLiveProductsJsonEnv,
  parseOutIdentity,
  parseSkinsJsonEnv,
  pickBestSkinForOut,
  resolveOutSkins,
  resolveSkinForAccountUrl,
  seedFantasy402FromEnv,
  seedFantasySportMappings,
  skinIdFromAccount,
  stampOutMeta,
  upsertBettingAccount,
  upsertPartner,
  type AdapterBinding,
  type AdapterId,
  type BettingAccountRow,
  type LiveProductCapacity,
  type OutCapacity,
  type OutExposureShare,
  type OutIdentity,
  type OutSkinLimit,
  type OutSkinPair,
  type PartnerEntity,
  type ProviderCapacity,
  type ProviderId,
} from './registry.ts';

export {
  buildSkinsMeta,
  formatOutId,
  formatVaultName,
  normalizeSkinName,
  parseLiquidityKey,
  parseOutMeta,
  parseSkinWire,
  type OutMeta,
  type OutSkinMapperKind,
  type SkinName,
} from './skins.ts';

export {
  DEFAULT_HOST_DISCOVER_ARTIFACT_DIR,
  HOST_DISCOVER_BASELINES,
  HOST_FINGERPRINT_RULES,
  adapterIdForMappedSkin,
  collectHtmlUrls,
  discoverHost,
  extractAbsoluteUrls,
  extractUrlsFromHar,
  formatHostDiscoverText,
  listMappedDiscoverHosts,
  listPublicFingerprintRules,
  listSkinBrandFingerprintRules,
  persistHostDiscoverUrls,
  scoreHostDiscovery,
  type HostDiscoverEvidence,
  type HostDiscoverReport,
  type HostDiscoverTarget,
  type HostDiscoverWeigh,
  type SuggestedSkinId,
} from './host-discover.ts';

export {
  CATEGORY_CAPS,
  buildHostObservations,
  decisionForScore,
  scoreFromEvidence,
  scoreHostAgainstSkins,
  scoreSkinObservations,
  type EvidenceCategory,
  type HostDiscoverDecision,
  type HostObservations,
  type SkinWeightedScore,
  type WeightedEvidenceItem,
} from './host-weighted-score.ts';

export {
  BINDING_STATUSES,
  BOOKS,
  BOOK_IDS,
  DEFAULT_COVERAGE_LIVE_PRODUCT,
  DEFAULT_COVERAGE_SKIN,
  HOST_TO_BOOK,
  HOST_TO_SKIN,
  LEGACY_CAPACITY_LIVE_PRODUCTS,
  LIVE_PRODUCT_IDS,
  LIVE_PRODUCTS,
  LIVE_PRODUCT_SPORT_BINDINGS,
  PARTNER_DOMAIN_ENV,
  RETIRED_BARE_BOOK_DOMAIN_ENVS,
  SKIN_IDS,
  SKIN_SPORT_BINDINGS,
  SKINS,
  SPORTS,
  SPORT_CATEGORIES,
  bookOffersLiveProduct,
  bookOffersSkin,
  buildBookMatrixRows,
  formatBooksMatrixText,
  getBook,
  getBookByHost,
  getLiveProduct,
  getSkin,
  getSkinByHost,
  getSport,
  getSportsByCategory,
  isBookId,
  isLegacyCapacityLiveProduct,
  isLiveProductId,
  isRetiredBareBookDomainEnv,
  isSkinId,
  isSportId,
  listBookIdsForSkin,
  listBooks,
  listBooksForSkin,
  listLiveProductSportBindings,
  listLiveProducts,
  listSkinSportBindings,
  listSkins,
  listSports,
  liveProductHasSportCoverage,
  liveProductOwnsCoverage,
  liveProductsWithBindings,
  normalizeHost,
  normalizeLiveProductName,
  resolveBookId,
  resolveSkinId,
  resolveSport,
  skinHasSportCoverage,
  skinIdForBook,
  skinOfferedCatalogNames,
  skinOffersLiveProduct,
  skinsWithBindings,
  type BindingStatus,
  type BookId,
  type BookMatrixRow,
  type BookRecord,
  type LegacyCapacityLiveProduct,
  type LiveProductId,
  type LiveProductRecord,
  type LiveProductSportBinding,
  type ResolveSportQuery,
  type ResolvedSport,
  type SkinId,
  type SkinMapper,
  type SkinRecord,
  type SkinSportBinding,
  type SportCategory,
  type SportId,
  type SportRecord,
} from '../domain/index.ts';

export {
  FANTASY_SPORT_MAPPINGS,
  FANTASY_WIDGET_CONFIG,
  WIDGET_FAVORITES_SPORT_ID,
  WIDGET_SPORT_ORDER,
  fantasySportByApiId,
  fantasySportByCanonical,
  fantasySportByStreamBucket,
  fantasySportByWidgetId,
  mappedStreamBuckets,
  primaryFantasySports,
  type FantasySportMapping,
} from './fantasy-ultra/widget-config.ts';

export {
  fetchStreamSportsInventory,
  inventoryFromStreamList,
  staticSportMapSummary,
  type StreamSportInventoryRow,
  type StreamSportLeagueRow,
  type StreamSportsInventory,
} from './sports-inventory.ts';

export {
  PARTNER_DOMAIN_LAYERS,
  PARTNER_NAMING,
  buildDomainStatusReport,
  formatDomainStatusText,
  type DomainComponent,
  type DomainLayer,
  type DomainLayerId,
  type DomainMaturity,
  type DomainStatusReport,
} from './domain.ts';

export {
  classifyTicketStatus,
  ensurePartnerLedgerSchema,
  insertPartnerLedgerRow,
  listLedgerFreshness,
  sumTicketTotalsForDay,
  writeDeskSnapshot,
  writeOddsBookSnapshot,
  writeTicketFromBetGroup,
  writeTicketFromExecution,
  type LedgerFreshness,
  type PartnerLedgerKind,
  type PartnerLedgerRow,
  type TicketDayTotals,
  type TicketLedgerStatus,
  type TicketOutDayTotals,
  type TicketWriteAction,
  type TicketWriteResult,
} from './ledger.ts';

export {
  applyRiskThreshold,
  evaluateRiskHealth,
  filterFindingsByThreshold,
  formatRiskHealthTelegram,
  formatRiskHealthText,
  parseRiskThreshold,
  riskHealthFingerprint,
  riskOkUnderThreshold,
  toRiskHealthJsonSnapshot,
  type RiskFinding,
  type RiskHealthJsonSnapshot,
  type RiskHealthOptions,
  type RiskHealthReport,
  type RiskSeverity,
  type RiskThreshold,
} from './risk-health.ts';

export {
  capturePandoraViaWebView,
  type WebViewCaptureOptions,
  type WebViewCaptureResult,
} from './webview-ws-capture.ts';

export {
  findLatestWebViewCapture,
  ingestWebViewWsFrames,
  ingestWebViewWsJsonl,
  type WebViewIngestReport,
  type WebViewWsFrame,
} from './webview-ws-ingest.ts';

export {
  runWebViewWsPipeline,
  type WebViewPipelineOptions,
  type WebViewPipelineResult,
} from './webview-ws-pipeline.ts';

export {
  formatFinanceCronReportText,
  notifyTelegramFinance,
  runFinanceCron,
  type FinanceCronOptions,
  type FinanceCronOutRow,
  type FinanceCronPartnerGroup,
  type FinanceCronReport,
} from './finance-cron.ts';

export {
  PARTNER_OPERATOR_COMMANDS,
  buildPartnerDashboardSnapshot,
  renderPartnerDashboardHtml,
  type PartnerDashboardSnapshot,
} from './dashboard-data.ts';

export {
  DEFAULT_PARTNERS_TOML,
  DEFAULT_REQUIRED_ENV_KEYS,
  EXAMPLE_PARTNERS_TOML,
  PARTNER_ENV_KEYS,
  buildPartnersTomlFromRows,
  canonicalOutEnvPrefix,
  canonicalPartnerEnvPrefix,
  canonicalVaultId,
  checkPartnersEnvPresence,
  diffPartnersTomlVsDb,
  envPrefixFallbackChain,
  formatEnvPresenceText,
  formatPartnerAssetIssues,
  formatPartnersDiffText,
  isBareBookEnvPrefix,
  isOutScopedEnvPrefix,
  isPartnerScopedEnvPrefix,
  loadPartnersTomlFile,
  loadRegistrySnapshot,
  materializePartnersToml,
  normalizeEnvPrefix,
  parseOutId,
  parsePartnersToml,
  partnerEnvPresence,
  partnersTomlDocSchema,
  resolveDeskDomainFromEnv,
  resolvePartnerEnv,
  seedRegistryFromPartnersToml,
  stringifyPartnersToml,
  validatePartnerAssetPrefixes,
  type DiffEntry,
  type EnvPresenceReport,
  type PartnerAssetIssue,
  type PartnerEnvBundle,
  type PartnerEnvKey,
  type PartnerEnvSource,
  type PartnersTomlDiff,
  type PartnersTomlDoc,
  type PartnersTomlLoadResult,
  type PartnersTomlOut,
  type PartnersTomlPartner,
  type PartnersTomlSkin,
  type RegistrySnapshot,
} from './toml-config.ts';

export {
  colorizePartnerText,
  contrastTextColorForRgb,
  formatPartnerVisualLine,
  getContrastTextColor,
  getPartnerVisual,
  partnerAvatarSvg,
  partnerCssVars,
  partnerHsl,
  partnerHue,
  partnerInitials,
  relativeLuminanceFromRgb,
  writePartnerAvatarPng,
  type PartnerVisual,
  type RgbaArray,
  type RgbaObject,
  type RgbArray,
  type RgbObject,
} from './visuals.ts';

export {
  americanToDecimal,
  decimalToAmerican,
  normalizeOdds,
  roundUsOddsDown,
  truncateDecimal,
  type DualOdds,
  type OddsFormat,
} from './odds-format.ts';

export {
  PandoraSocket,
  PANDORA_DEFAULT_SESSION,
  buildPliveSubscribeSequence,
  defaultPandoraSocketUrl,
  encodeSocketIoEmit,
  parseEngineOpen,
  parseSocketIoEvent,
  EIO,
  SIO,
  type PandoraLiveSessionIds,
  type PandoraOpenInfo,
  type PandoraSocketHandlers,
  type PandoraSocketOptions,
} from './fantasy-ultra/pandora-socket.ts';

export {
  applyCoefficientDiff,
  decodePandoraAttachment,
  eventIdFromCoefficientRoom,
  extractCoefficientLines,
  parseBinaryEventHeader,
  type CoefficientEnvelope,
  type CoefficientLine,
  type PandoraTi,
} from './fantasy-ultra/coefficients.ts';

export {
  CoefficientStore,
  sharedCoefficientStore,
  type CoefficientIngest,
} from './fantasy-ultra/coefficient-store.ts';

import type { PartnerAccountProfile } from './account-profile.ts';
import { credentialsFromFantasyProfile } from './account-profile.ts';
import { FantasyUltraAdapter } from './fantasy-ultra/adapter.ts';
import { getSkinByHost, isSkinId, type SkinId } from '../domain/index.ts';
import { adapterBindingForSkin, type AdapterId } from './out-identity.ts';
import type { FantasySessionAdapter, PartnerOrderAdapter } from './types.ts';

/**
 * Resolve white-label skin: explicit skinId → host (HOST_TO_SKIN) → canonical SkinId.
 * Never forges SkinId from mapper/provider labels (`fantasy402` is an alias, not identity).
 */
export function resolveProfileSkinId(account: PartnerAccountProfile): SkinId | undefined {
  if (account.skinId) return account.skinId;
  const fromHost = account.url ? getSkinByHost(account.url) : undefined;
  if (fromHost) return fromHost;
  // partner field may carry a canonical SkinId only — not mapper aliases
  const partner = String(account.partner ?? '')
    .trim()
    .toLowerCase();
  if (isSkinId(partner)) return partner;
  return undefined;
}

/** Resolve adapterId from profile skin mapper (HOST_TO_SKIN / SkinId), not fantasy402 brand. */
export function resolveProfileAdapterId(account: PartnerAccountProfile): AdapterId {
  if (account.adapterId) return account.adapterId;
  const skinId = resolveProfileSkinId(account);
  if (skinId) return adapterBindingForSkin(skinId).adapterId;
  if (account.partner === 'kalshi') return 'kalshi';
  return 'unmapped';
}

/** @deprecated use resolveProfileAdapterId === 'fantasy-ultra' */
export function profileUsesFantasy402Mapper(account: PartnerAccountProfile): boolean {
  return resolveProfileAdapterId(account) === 'fantasy-ultra';
}

/** Instantiate adapter for a registry profile (optional execution live product). */
export function getPartnerAdapter(
  account: PartnerAccountProfile,
  options: {
    fetchImpl?: typeof fetch;
    warmSession?: boolean;
    /** Override out default live-product wire for this session (ezlive / dark / 2). */
    skin?: string | number;
    liveProduct?: string | number;
  } = {}
): PartnerOrderAdapter {
  const adapterId = resolveProfileAdapterId(account);
  if (adapterId === 'fantasy-ultra') {
    return new FantasyUltraAdapter({
      credentials: credentialsFromFantasyProfile(account, {
        skin: options.skin,
        liveProduct: options.liveProduct,
      }),
      fetchImpl: options.fetchImpl,
      warmSession: options.warmSession,
    });
  }
  throw new Error(
    `No adapter for adapterId=${adapterId} partner=${account.partner} skinId=${account.skinId ?? resolveProfileSkinId(account) ?? '?'}`
  );
}

/** Typed Fantasy session adapter (renew / sports / warm). */
export function getFantasySessionAdapter(
  account: PartnerAccountProfile,
  options: {
    fetchImpl?: typeof fetch;
    warmSession?: boolean;
    skin?: string | number;
    liveProduct?: string | number;
  } = {}
): FantasySessionAdapter {
  if (resolveProfileAdapterId(account) !== 'fantasy-ultra') {
    throw new Error(
      `Not a fantasy-ultra account: adapterId=${resolveProfileAdapterId(account)} skinId=${account.skinId ?? '?'}`
    );
  }
  return new FantasyUltraAdapter({
    credentials: credentialsFromFantasyProfile(account, {
      skin: options.skin,
      liveProduct: options.liveProduct,
    }),
    fetchImpl: options.fetchImpl,
    warmSession: options.warmSession,
  });
}
